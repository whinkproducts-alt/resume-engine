// ============================================================================
// RESUME ENGINE — PIPELINE WORKER (PHASE 1 / STAGE 2)
// File: src/workers/run.worker.ts
// Owner: Whink Apps — Victor Igboekwe
// ----------------------------------------------------------------------------
// Responsibilities:
//   - BullMQ worker processing the 8-stage pipeline
//   - Stages 0..5 implemented here (6..7 in follow-up package)
//   - Persists RunLog row for EVERY step + EVERY LLM call
//   - Endpoints: POST /runs, GET /runs/:id, POST /runs/:id/confirm-company
//
// Authoritative clarifications (Victor sign-off):
//   R2  close variant: 70% token overlap, stop-words stripped
//   R9  LLM-judged: emit `warn` ValidationFlag, NON-blocking
//   R10 duplicate verb: per-resume, warn only
//   R18 filename regex: ^[a-zA-Z0-9\s\-_]+_[a-zA-Z0-9\s\-_]+_[a-zA-Z0-9\s\-_]+\.docx$
//   2FA enroll: POST /admin/2fa/enroll
//   Bootstrap token: X-Bootstrap-Token header
// ============================================================================

import { Worker, Job, Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient, RunStatus, ValidationSeverity } from "@prisma/client";
import { z } from "zod";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { parse as parseHtml } from "node-html-parser";
import axios from "axios";
import OpenAI from "openai";

// ---------------------------------------------------------------------------
// Infrastructure singletons
// ---------------------------------------------------------------------------
export const redis = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const prisma = new PrismaClient();

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  baseURL: process.env.OPENAI_BASE_URL, // optional for Azure/proxy
});

export const runQueue = new Queue<RunJobData>("resume.run", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 3600, count: 1_000 },
    removeOnFail: { age: 86_400, count: 5_000 },
  },
});

export const runQueueEvents = new QueueEvents("resume.run", { connection: redis });

// ---------------------------------------------------------------------------
// Job payload contract
// ---------------------------------------------------------------------------
export interface RunJobData {
  runId: string;
  userId: string;
  isAdmin: boolean;
  input: {
    kind: "paste" | "file" | "url";
    pasteText?: string;
    fileBufferB64?: string;
    filename?: string;
    mimeType?: string;
    url?: string;
  };
  overrides?: {
    contactLocationOverride?: string | null;
  };
}

// ---------------------------------------------------------------------------
// LLM JSON schema (Stage 2 — Analyze)
// ---------------------------------------------------------------------------
export const ANALYSIS_SCHEMA = {
  name: "resume_analysis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "company",
      "companyInferred",
      "confidence",
      "roleTitle",
      "seniority",
      "industry",
      "targetLocations",
      "primarySkills",
      "yearsExperience",
    ],
    properties: {
      company: { type: "string" },
      companyInferred: { type: "boolean" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      roleTitle: { type: "string" },
      seniority: {
        type: "string",
        enum: ["intern", "junior", "mid", "senior", "lead", "principal", "director", "vp", "c-level", "unknown"],
      },
      industry: { type: "string" },
      targetLocations: { type: "array", items: { type: "string" } },
      primarySkills: { type: "array", items: { type: "string" } },
      yearsExperience: { type: "number", minimum: 0 },
    },
  },
} as const;

const AnalysisResult = z.object({
  company: z.string().min(1),
  companyInferred: z.boolean(),
  confidence: z.number().min(0).max(1),
  roleTitle: z.string().min(1),
  seniority: z.enum([
    "intern", "junior", "mid", "senior", "lead",
    "principal", "director", "vp", "c-level", "unknown",
  ]),
  industry: z.string(),
  targetLocations: z.array(z.string()),
  primarySkills: z.array(z.string()),
  yearsExperience: z.number().min(0),
});

const REWRITE_HEADLINE_SCHEMA = {
  name: "rewrite_headline",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["headline"],
    properties: { headline: { type: "string", minLength: 20, maxLength: 220 } },
  },
} as const;

const REWRITE_SUMMARY_SCHEMA = {
  name: "rewrite_summary",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary"],
    properties: { summary: { type: "string", minLength: 120, maxLength: 900 } },
  },
} as const;

const REWRITE_COMPETENCIES_SCHEMA = {
  name: "rewrite_competencies",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["competencies"],
    properties: {
      competencies: {
        type: "array",
        minItems: 6,
        maxItems: 16,
        items: { type: "string", minLength: 2, maxLength: 80 },
      },
    },
  },
} as const;

const REWRITE_ROLES_SCHEMA = {
  name: "rewrite_roles",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["roles"],
    properties: {
      roles: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["company", "title", "startDate", "endDate", "bullets"],
          properties: {
            company: { type: "string" },
            title: { type: "string" },
            startDate: { type: "string" },   // locked, echoes input
            endDate: { type: "string" },     // locked, echoes input
            bullets: {
              type: "array",
              minItems: 2,
              maxItems: 8,
              items: { type: "string", minLength: 20, maxLength: 320 },
            },
          },
        },
      },
    },
  },
} as const;

const REWRITE_KEYWORDS_SCHEMA = {
  name: "rewrite_keywords",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["keywords"],
    properties: {
      keywords: {
        type: "array",
        minItems: 10,
        maxItems: 40,
        items: { type: "string", minLength: 2, maxLength: 40 },
      },
    },
  },
} as const;

const REWRITE_TARGETS_SCHEMA = {
  name: "rewrite_targets",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["targets"],
    properties: {
      targets: {
        type: "array",
        minItems: 2,
        maxItems: 6,
        items: { type: "string", minLength: 10, maxLength: 200 },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MIN_INGEST_CHARS = 200;
const CONFIRM_CONFIDENCE_THRESHOLD = 0.75;
const FILENAME_REGEX = /^[a-zA-Z0-9\s\-_]+_[a-zA-Z0-9\s\-_]+_[a-zA-Z0-9\s\-_]+\.docx$/;

const STOP_WORDS = new Set([
  "senior", "sr", "lead", "principal", "staff", "junior", "jr", "mid",
  "the", "a", "an", "of", "and", "or", "for", "at", "to", "in", "on",
]);

// ============================================================================
// UTILITIES — RunLog, ValidationFlag, Progress
// ============================================================================

async function logStep(
  runId: string,
  stage: string,
  message: string,
  meta?: Record<string, unknown>,
) {
  await prisma.runLog.create({
    data: {
      runId,
      stage,
      level: "info",
      message,
      meta: meta ?? {},
    },
  });
}

async function logError(
  runId: string,
  stage: string,
  message: string,
  err: unknown,
) {
  await prisma.runLog.create({
    data: {
      runId,
      stage,
      level: "error",
      message,
      meta: {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
    },
  });
}

async function logLlmCall(
  runId: string,
  stage: string,
  model: string,
  promptName: string,
  latencyMs: number,
  tokensIn: number,
  tokensOut: number,
  ok: boolean,
) {
  await prisma.runLog.create({
    data: {
      runId,
      stage,
      level: ok ? "info" : "error",
      message: `LLM call: ${promptName}`,
      meta: { model, latencyMs, tokensIn, tokensOut, ok },
    },
  });
}

async function addValidationFlag(
  runId: string,
  code: string,
  severity: ValidationSeverity,
  message: string,
  stage: string,
  detail?: Record<string, unknown>,
) {
  await prisma.validationFlag.create({
    data: { runId, code, severity, message, stage, detail: detail ?? {} },
  });
}

async function setProgress(runId: string, progress: number) {
  const clamped = Math.max(0, Math.min(1, progress));
  await prisma.run.update({
    where: { id: runId },
    data: { progress: clamped },
  });
}

async function setStatus(runId: string, status: RunStatus, extra?: Record<string, unknown>) {
  await prisma.run.update({
    where: { id: runId },
    data: { status, ...(extra ?? {}) },
  });
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
}

function tokenOverlapPct(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hits = 0;
  for (const t of ta) if (tb.has(t)) hits++;
  return hits / Math.min(ta.size, tb.size);
}

// ============================================================================
// STAGE 0 — QUOTA GATE (admin bypass)
// ============================================================================
async function stage0_quotaGate(job: Job<RunJobData>): Promise<void> {
  const { runId, userId, isAdmin } = job.data;

  await setStatus(runId, "QUOTA_CHECK" as RunStatus);
  await logStep(runId, "stage0", "quota_gate:enter", { isAdmin });

  if (isAdmin) {
    await logStep(runId, "stage0", "quota_gate:admin_bypass");
    await setProgress(runId, 0.02);
    return;
  }

  const quota = await prisma.quota.findUnique({ where: { userId } });
  if (!quota) {
    await addValidationFlag(
      runId, "QUOTA_MISSING", "error",
      "No quota record for user.", "stage0",
    );
    throw new Error("QUOTA_MISSING");
  }

  const periodStart = quota.periodStart ?? new Date(0);
  const used = await prisma.run.count({
    where: {
      userId,
      createdAt: { gte: periodStart },
      status: { notIn: ["FAILED", "CANCELLED"] },
    },
  });

  if (used >= quota.runsPerPeriod) {
    await addValidationFlag(
      runId, "QUOTA_EXCEEDED", "error",
      `Quota exceeded: ${used}/${quota.runsPerPeriod}.`, "stage0",
      { used, limit: quota.runsPerPeriod },
    );
    await setStatus(runId, "FAILED" as RunStatus);
    throw new Error("QUOTA_EXCEEDED");
  }

  await logStep(runId, "stage0", "quota_gate:pass", { used, limit: quota.runsPerPeriod });
  await setProgress(runId, 0.02);
}

// ============================================================================
// STAGE 1 — INGEST
// ============================================================================
async function stage1_ingest(job: Job<RunJobData>): Promise<string> {
  const { runId, input } = job.data;
  await setStatus(runId, "INGESTING" as RunStatus);
  await logStep(runId, "stage1", "ingest:enter", { kind: input.kind });

  let text = "";

  try {
    if (input.kind === "paste") {
      text = (input.pasteText ?? "").trim();
    } else if (input.kind === "file") {
      if (!input.fileBufferB64) throw new Error("INGEST_MISSING_FILE");
      const buf = Buffer.from(input.fileBufferB64, "base64");
      const mime = (input.mimeType ?? "").toLowerCase();
      const name = (input.filename ?? "").toLowerCase();

      if (mime.includes("pdf") || name.endsWith(".pdf")) {
        const parsed = await pdfParse(buf);
        text = (parsed.text ?? "").trim();
      } else if (mime.includes("word") || name.endsWith(".docx")) {
        // R18 — filename rule only enforced for .docx uploads
        if (!FILENAME_REGEX.test(input.filename ?? "")) {
          await addValidationFlag(
            runId, "R18_FILENAME", "warn",
            `Filename does not match required pattern: ${input.filename}`, "stage1",
          );
        }
        const parsed = await mammoth.extractRawText({ buffer: buf });
        text = (parsed.value ?? "").trim();
      } else {
        throw new Error(`INGEST_UNSUPPORTED_FILE:${mime || name}`);
      }
    } else if (input.kind === "url") {
      if (!input.url) throw new Error("INGEST_MISSING_URL");
      const res = await axios.get<string>(input.url, {
        timeout: 15_000,
        responseType: "text",
        maxRedirects: 3,
      });
      const root = parseHtml(res.data);
      root.querySelectorAll("script,style,noscript,nav,footer,header").forEach((n) => n.remove());
      text = (root.textContent ?? "").replace(/\s+\n/g, "\n").trim();
    } else {
      throw new Error(`INGEST_UNKNOWN_KIND:${(input as any).kind}`);
    }
  } catch (err) {
    await logError(runId, "stage1", "ingest:error", err);
    await addValidationFlag(
      runId, "INGEST_FAILED", "error",
      "Failed to extract text from input.", "stage1",
      { error: err instanceof Error ? err.message : String(err) },
    );
    await setStatus(runId, "FAILED" as RunStatus);
    throw err;
  }

  const len = text.length;
  await logStep(runId, "stage1", "ingest:extracted", { chars: len });

  if (len < MIN_INGEST_CHARS) {
    await addValidationFlag(
      runId, "INGEST_TOO_SHORT", "error",
      `Extracted text only ${len} chars (< ${MIN_INGEST_CHARS}).`, "stage1",
      { chars: len },
    );
    await setStatus(runId, "FAILED" as RunStatus);
    throw new Error("INGEST_TOO_SHORT");
  }

  await prisma.run.update({
    where: { id: runId },
    data: { sourceText: text },
  });

  await setProgress(runId, 0.10);
  return text;
}

// ============================================================================
// STAGE 2 — ANALYZE (LLM JSON-schema call)
// ============================================================================
interface AnalysisOutput {
  company: string;
  companyInferred: boolean;
  confidence: number;
  roleTitle: string;
  seniority: string;
  industry: string;
  targetLocations: string[];
  primarySkills: string[];
  yearsExperience: number;
}

async function stage2_analyze(job: Job<RunJobData>, sourceText: string): Promise<AnalysisOutput> {
  const { runId } = job.data;
  await setStatus(runId, "ANALYZING" as RunStatus);
  await logStep(runId, "stage2", "analyze:enter", { chars: sourceText.length });

  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const truncated = sourceText.slice(0, 28_000); // hard cap

  const systemPrompt = [
    "You are a resume analysis engine. Return ONLY JSON matching the schema.",
    "RULES:",
    "1. companyInferred=true if the company name is not explicitly stated in the resume.",
    "2. confidence in [0,1] reflects how confident you are in the company inference.",
    "3. If the resume mentions multiple companies, choose the MOST RECENT one.",
    "4. roleTitle is the candidate's target/most-recent role, not a previous one.",
    "5. seniority must be one of the allowed enum values.",
    "6. targetLocations: prefer explicit candidate location; else [].",
    "7. primarySkills: max 20, deduped, normalized casing.",
  ].join("\n");

  const userPrompt = `RESUME_TEXT:\n"""\n${truncated}\n"""\n\nReturn the JSON object now.`;

  const t0 = Date.now();
  let raw: string | undefined;
  try {
    const resp = await openai.chat.completions.create({
      model,
      temperature: 0.1,
      response_format: { type: "json_schema", json_schema: ANALYSIS_SCHEMA },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    raw = resp.choices[0]?.message?.content ?? "";
    await logLlmCall(
      runId, "stage2", model, "resume.analyze",
      Date.now() - t0,
      resp.usage?.prompt_tokens ?? 0,
      resp.usage?.completion_tokens ?? 0,
      true,
    );
  } catch (err) {
    await logLlmCall(
      runId, "stage2", model, "resume.analyze",
      Date.now() - t0, 0, 0, false,
    );
    await logError(runId, "stage2", "analyze:llm_error", err);
    await addValidationFlag(
      runId, "ANALYZE_LLM_FAILED", "error",
      "Stage 2 LLM call failed.", "stage2",
      { error: err instanceof Error ? err.message : String(err) },
    );
    await setStatus(runId, "FAILED" as RunStatus);
    throw err;
  }

  let parsed: AnalysisOutput;
  try {
    parsed = AnalysisResult.parse(JSON.parse(raw));
  } catch (err) {
    await logError(runId, "stage2", "analyze:schema_mismatch", err);
    await addValidationFlag(
      runId, "ANALYZE_SCHEMA_MISMATCH", "error",
      "Stage 2 output did not match expected schema.", "stage2",
      { raw },
    );
    await setStatus(runId, "FAILED" as RunStatus);
    throw err;
  }

  // R9 — LLM-judged concern surfaces as warn, non-blocking
  if (parsed.confidence < CONFIRM_CONFIDENCE_THRESHOLD) {
    await addValidationFlag(
      runId, "R9_LOW_CONFIDENCE", "warn",
      `Analysis confidence ${parsed.confidence} is below ${CONFIRM_CONFIDENCE_THRESHOLD}.`, "stage2",
      { confidence: parsed.confidence },
    );
  }

  await prisma.run.update({
    where: { id: runId },
    data: {
      analysis: parsed as any,
    },
  });

  await logStep(runId, "stage2", "analyze:ok", {
    company: parsed.company,
    companyInferred: parsed.companyInferred,
    confidence: parsed.confidence,
  });

  await setProgress(runId, 0.25);
  return parsed;
}

// ============================================================================
// STAGE 3 — CONFIRM (pause pipeline if needed)
// ============================================================================
async function stage3_confirm(
  job: Job<RunJobData>,
  analysis: AnalysisOutput,
): Promise<"continue" | "awaiting"> {
  const { runId } = job.data;
  await logStep(runId, "stage3", "confirm:enter", {
    companyInferred: analysis.companyInferred,
    confidence: analysis.confidence,
  });

  const needsConfirm =
    analysis.companyInferred || analysis.confidence < CONFIRM_CONFIDENCE_THRESHOLD;

  if (!needsConfirm) {
    await logStep(runId, "stage3", "confirm:auto_pass");
    await setProgress(runId, 0.30);
    return "continue";
  }

  await setStatus(runId, "AWAITING_COMPANY_CONFIRM" as RunStatus, {
    pendingCompany: analysis.company,
  } as any);

  await logStep(runId, "stage3", "confirm:awaiting_user", {
    pendingCompany: analysis.company,
  });

  return "awaiting";
}

// ============================================================================
// STAGE 4 — REWRITE (staged LLM calls, progressive progress)
// ============================================================================
interface RewriteSections {
  headline: string;
  summary: string;
  competencies: string[];
  roles: Array<{
    company: string;
    title: string;
    startDate: string;
    endDate: string;
    bullets: string[];
  }>;
  keywords: string[];
  targets: string[];
}

async function callJsonLLM<T>(
  runId: string,
  stage: string,
  promptName: string,
  model: string,
  schema: any,
  systemPrompt: string,
  userPrompt: string,
  validator: (raw: string) => T,
): Promise<T> {
  const t0 = Date.now();
  try {
    const resp = await openai.chat.completions.create({
      model,
      temperature: 0.4,
      response_format: { type: "json_schema", json_schema: schema },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    const raw = resp.choices[0]?.message?.content ?? "";
    await logLlmCall(
      runId, stage, model, promptName, Date.now() - t0,
      resp.usage?.prompt_tokens ?? 0, resp.usage?.completion_tokens ?? 0, true,
    );
    return validator(raw);
  } catch (err) {
    await logLlmCall(runId, stage, model, promptName, Date.now() - t0, 0, 0, false);
    throw err;
  }
}

async function stage4_rewrite(
  job: Job<RunJobData>,
  sourceText: string,
  analysis: AnalysisOutput,
  confirmedCompany: string,
): Promise<RewriteSections> {
  const { runId } = job.data;
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  await setStatus(runId, "REWRITING" as RunStatus);
  await logStep(runId, "stage4", "rewrite:enter", { model });

  const ctx = [
    `Company: ${confirmedCompany}`,
    `Role: ${analysis.roleTitle}`,
    `Seniority: ${analysis.seniority}`,
    `Industry: ${analysis.industry}`,
    `Skills: ${analysis.primarySkills.join(", ")}`,
    `Years: ${analysis.yearsExperience}`,
    `Locations: ${analysis.targetLocations.join(", ") || "n/a"}`,
    `Confidence: ${analysis.confidence}`,
  ].join("\n");

  const basePrompt = `CONTEXT:\n${ctx}\n\nRESUME:\n"""\n${sourceText.slice(0, 24_000)}\n"""`;

  const steps: Array<{ name: string; progress: number; run: () => Promise<void> }> = [];
  const out: Partial<RewriteSections> = {};

  steps.push({
    name: "headline", progress: 0.36,
    run: async () => {
      out.headline = await callJsonLLM(
        runId, "stage4", "rewrite.headline", model, REWRITE_HEADLINE_SCHEMA,
        "You rewrite resume headlines. Return ONLY JSON per schema. No superlatives. Match seniority. ~140 chars max.",
        basePrompt,
        (raw) => (JSON.parse(raw) as { headline: string }).headline,
      );
    },
  });

  steps.push({
    name: "summary", progress: 0.45,
    run: async () => {
      out.summary = await callJsonLLM(
        runId, "stage4", "rewrite.summary", model, REWRITE_SUMMARY_SCHEMA,
        "You rewrite resume summaries. Return ONLY JSON per schema. 3-4 sentences. First-person implied (no 'I').",
        basePrompt,
        (raw) => (JSON.parse(raw) as { summary: string }).summary,
      );
    },
  });

  steps.push({
    name: "competencies", progress: 0.54,
    run: async () => {
      out.competencies = await callJsonLLM(
        runId, "stage4", "rewrite.competencies", model, REWRITE_COMPETENCIES_SCHEMA,
        "You extract core competencies. Return ONLY JSON per schema. Dedupe. Title-case where sensible.",
        basePrompt,
        (raw) => (JSON.parse(raw) as { competencies: string[] }).competencies,
      );
    },
  });

  steps.push({
    name: "roles", progress: 0.66,
    run: async () => {
      // LOCK HEADERS / DATES — echo them back, do NOT let LLM change them.
      const locked = analysis as any;
      const lockedDates = (locked.rawRoles ?? []) as Array<{ company: string; title: string; startDate: string; endDate: string }>;

      const rolesPrompt =
        `${basePrompt}\n\nLOCKED_ROLE_HEADERS_DATES (must be echoed VERBATIM):\n` +
        JSON.stringify(lockedDates, null, 2) +
        `\n\nRewrite ONLY the bullet points. Keep every company/title/startDate/endDate exactly as given.`;

      out.roles = await callJsonLLM(
        runId, "stage4", "rewrite.roles", model, REWRITE_ROLES_SCHEMA,
        "You rewrite resume role bullets ONLY. Return ONLY JSON per schema. Headers and dates are LOCKED — echo them verbatim. 3-6 bullets, action-verb, quantified where possible.",
        rolesPrompt,
        (raw) => (JSON.parse(raw) as { roles: RewriteSections["roles"] }).roles,
      );

      // R10 — duplicate verb check, per-resume, warn only
      for (const role of out.roles ?? []) {
        const firstWords = role.bullets
          .map((b) => (b.trim().split(/\s+/)[0] ?? "").toLowerCase())
          .filter(Boolean);
        const seen = new Set<string>();
        const dupes = new Set<string>();
        for (const w of firstWords) (seen.has(w) ? dupes.add(w) : seen.add(w));
        if (dupes.size > 0) {
          await addValidationFlag(
            runId, "R10_DUP_VERB", "warn",
            `Duplicate bullet-start verbs in role ${role.company}: ${[...dupes].join(", ")}`,
            "stage4",
            { company: role.company, duplicates: [...dupes] },
          );
        }
      }
    },
  });

  steps.push({
    name: "keywords", progress: 0.76,
    run: async () => {
      out.keywords = await callJsonLLM(
        runId, "stage4", "rewrite.keywords", model, REWRITE_KEYWORDS_SCHEMA,
        "You extract ATS keywords. Return ONLY JSON per schema. Lower-case canonical forms, deduped.",
        basePrompt,
        (raw) => (JSON.parse(raw) as { keywords: string[] }).keywords,
      );
    },
  });

  steps.push({
    name: "targets", progress: 0.84,
    run: async () => {
      out.targets = await callJsonLLM(
        runId, "stage4", "rewrite.targets", model, REWRITE_TARGETS_SCHEMA,
        "You produce 2-6 'Target' statements (career aims/next roles). Return ONLY JSON per schema.",
        basePrompt,
        (raw) => (JSON.parse(raw) as { targets: string[] }).targets,
      );
    },
  });

  for (const step of steps) {
    await logStep(runId, "stage4", `rewrite:${step.name}:start`);
    try {
      await step.run();
    } catch (err) {
      await logError(runId, "stage4", `rewrite:${step.name}:error`, err);
      await addValidationFlag(
        runId, `REWRITE_${step.name.toUpperCase()}_FAILED`, "error",
        `Rewrite step '${step.name}' failed.`, "stage4",
        { error: err instanceof Error ? err.message : String(err) },
      );
      await setStatus(runId, "FAILED" as RunStatus);
      throw err;
    }
    await setProgress(runId, step.progress);
    await logStep(runId, "stage4", `rewrite:${step.name}:ok`);
  }

  if (!out.headline || !out.summary || !out.competencies || !out.roles || !out.keywords || !out.targets) {
    throw new Error("REWRITE_INCOMPLETE");
  }

  const sections: RewriteSections = {
    headline: out.headline,
    summary: out.summary,
    competencies: out.competencies,
    roles: out.roles,
    keywords: out.keywords,
    targets: out.targets,
  };

  await prisma.run.update({
    where: { id: runId },
    data: { rewrite: sections as any },
  });

  await setProgress(runId, 0.88);
  return sections;
}

// ============================================================================
// STAGE 5 — ASSEMBLE (merge sections, lock headers/dates, overrides)
// ============================================================================
interface AssembledResume {
  header: { company: string; roleTitle: string; headline: string };
  summary: string;
  competencies: string[];
  roles: RewriteSections["roles"];
  keywords: string[];
  targets: string[];
  contactLocation: string;
}

async function stage5_assemble(
  job: Job<RunJobData>,
  analysis: AnalysisOutput,
  sections: RewriteSections,
  confirmedCompany: string,
): Promise<AssembledResume> {
  const { runId, overrides } = job.data;
  await setStatus(runId, "ASSEMBLING" as RunStatus);
  await logStep(runId, "stage5", "assemble:enter");

  // Lock headers/dates — enforce NO mutation from LLM output
  const lockedRoles = sections.roles.map((r, i) => {
    const source = (analysis as any).rawRoles?.[i];
    if (!source) return r; // fallback: trust LLM echo (already constrained)
    if (
      r.company !== source.company ||
      r.title !== source.title ||
      r.startDate !== source.startDate ||
      r.endDate !== source.endDate
    ) {
      // Should never happen due to schema constraint, but belt-and-braces:
      throw new Error(`ASSEMBLE_LOCKED_FIELD_MUTATED:${r.company}`);
    }
    return r;
  });

  // contactLocationOverride precedence: explicit override > analysis targetLocations[0] > ""
  const contactLocation =
    overrides?.contactLocationOverride?.trim() ||
    analysis.targetLocations?.[0]?.trim() ||
    "";

  const assembled: AssembledResume = {
    header: {
      company: confirmedCompany,
      roleTitle: analysis.roleTitle,
      headline: sections.headline,
    },
    summary: sections.summary,
    competencies: sections.competencies,
    roles: lockedRoles,
    keywords: sections.keywords,
    targets: sections.targets,
    contactLocation,
  };

  await prisma.run.update({
    where: { id: runId },
    data: { assembled: assembled as any },
  });

  await logStep(runId, "stage5", "assemble:ok", {
    company: confirmedCompany,
    roleCount: lockedRoles.length,
    contactLocationOverrideApplied: !!overrides?.contactLocationOverride,
  });

  await setProgress(runId, 0.95);
  return assembled;
}

// ============================================================================
// PIPELINE RUNNER (Stages 0..5 — 6..7 in follow-up)
// ============================================================================
async function runPipeline(job: Job<RunJobData>): Promise<{ runId: string; status: string }> {
  const { runId } = job.data;
  await logStep(runId, "pipeline", "start", { jobId: job.id });

  try {
    // Stage 0
    await stage0_quotaGate(job);

    // Stage 1
    const sourceText = await stage1_ingest(job);

    // Stage 2
    const analysis = await stage2_analyze(job, sourceText);

    // Stage 3 — may pause
    const gate = await stage3_confirm(job, analysis);
    if (gate === "awaiting") {
      await logStep(runId, "pipeline", "paused:awaiting_company_confirm");
      return { runId, status: "AWAITING_COMPANY_CONFIRM" };
    }

    // From here we need a confirmed company.
    // (If stage3 passed, analysis.company is authoritative.)
    const confirmedCompany = analysis.company;

    // Stage 4
    const sections = await stage4_rewrite(job, sourceText, analysis, confirmedCompany);

    // Stage 5
    await stage5_assemble(job, analysis, sections, confirmedCompany);

    // Stub for Stage 6..7 (next package)
    await setProgress(runId, 1.0);
    await setStatus(runId, "COMPLETED" as RunStatus);
    await logStep(runId, "pipeline", "completed");

    return { runId, status: "COMPLETED" };
  } catch (err) {
    // Ensure the run doesn't stay stuck if an unexpected error escapes
    const run = await prisma.run.findUnique({ where: { id: runId } });
    if (run && run.status !== "FAILED" && run.status !== "AWAITING_COMPANY_CONFIRM") {
      await setStatus(runId, "FAILED" as RunStatus);
    }
    await logError(runId, "pipeline", "unhandled_error", err);
    throw err;
  }
}

// ============================================================================
// BULLMQ WORKER
// ============================================================================
export const runWorker = new Worker<RunJobData>(
  "resume.run",
  async (job) => {
    if (job.name === "pipeline.resume") {
      return runPipeline(job);
    }
    if (job.name === "pipeline.resume.resume") {
      // Re-entry after company confirmation
      return runPipeline(job);
    }
    throw new Error(`UNKNOWN_JOB_NAME:${job.name}`);
  },
  {
    connection: redis,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
    limiter: { max: 20, duration: 1_000 },
    lockDuration: 60_000,
    stalledInterval: 30_000,
    maxStalledCount: 2,
  },
);

runWorker.on("completed", async (job) => {
  await logStep(job.data.runId, "worker", "job:completed", { jobId: job.id });
});
runWorker.on("failed", async (job, err) => {
  if (job) {
    await logError(job.data.runId, "worker", "job:failed", err);
  }
});
runWorker.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("[runWorker] error", err);
});

// ============================================================================
// ENQUEUE HELPER — used by POST /runs and confirm-company
// ============================================================================
export async function enqueueResumeRun(data: RunJobData, opts?: { jobName?: string; delayMs?: number }) {
  return runQueue.add(opts?.jobName ?? "pipeline.resume", data, {
    delay: opts?.delayMs,
  });
}

// ============================================================================
// EXPRESS ROUTER (Stages 0..5 endpoints)
// ============================================================================
// Assumes middleware: `authRequired`, `adminBypass`, `bodyParserJson`
// Assumes req.user = { id: string; isAdmin: boolean }
// ============================================================================
import { Router, Request, Response, NextFunction } from "express";

export const runsRouter = Router();

// ----- helpers --------------------------------------------------------------
function uid(req: Request): { userId: string; isAdmin: boolean } {
  const user = (req as any).user;
  if (!user?.id) throw new Error("UNAUTHENTICATED");
  return { userId: user.id, isAdmin: !!user.isAdmin };
}

// ---------------------------------------------------------------------------
// POST /runs — create a run and enqueue pipeline
// ---------------------------------------------------------------------------
// Body:
//   { input: { kind: "paste"|"file"|"url", pasteText?, fileBufferB64?, filename?, mimeType?, url? } }
//   { overrides?: { contactLocationOverride?: string | null } }
// ---------------------------------------------------------------------------
runsRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, isAdmin } = uid(req);
    const body = req.body as {
      input?: RunJobData["input"];
      overrides?: RunJobData["overrides"];
    };

    if (!body?.input || !body.input.kind) {
      return res.status(400).json({ error: "MISSING_INPUT" });
    }

    const run = await prisma.run.create({
      data: {
        userId,
        status: "QUEUED" as RunStatus,
        progress: 0,
        inputKind: body.input.kind,
        inputMeta: {
          filename: body.input.filename,
          mimeType: body.input.mimeType,
          url: body.input.url,
        } as any,
        overrides: (body.overrides ?? {}) as any,
      },
    });

    await logStep(run.id, "api", "run:created", { userId, kind: body.input.kind });

    const job = await enqueueResumeRun({
      runId: run.id,
      userId,
      isAdmin,
      input: body.input,
      overrides: body.overrides,
    });

    await logStep(run.id, "api", "run:enqueued", { jobId: job.id });

    return res.status(202).json({
      runId: run.id,
      jobId: job.id,
      status: run.status,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /runs/:id — fetch run status / results
// ---------------------------------------------------------------------------
runsRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, isAdmin } = uid(req);
    const run = await prisma.run.findUnique({
      where: { id: req.params.id },
      include: {
        logs: { orderBy: { createdAt: "asc" }, take: 500 },
        validationFlags: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!run) return res.status(404).json({ error: "NOT_FOUND" });
    if (!isAdmin && run.userId !== userId) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    return res.json({
      id: run.id,
      status: run.status,
      progress: run.progress,
      pendingCompany: (run as any).pendingCompany ?? null,
      analysis: run.analysis ?? null,
      rewrite: run.rewrite ?? null,
      assembled: run.assembled ?? null,
      validationFlags: run.validationFlags,
      logs: run.logs,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /runs/:id/confirm-company — resume a paused run
// ---------------------------------------------------------------------------
// Body: { company: string }
// ---------------------------------------------------------------------------
runsRouter.post(
  "/:id/confirm-company",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, isAdmin } = uid(req);
      const { company } = req.body as { company?: string };

      if (!company || company.trim().length < 2) {
        return res.status(400).json({ error: "INVALID_COMPANY" });
      }

      const run = await prisma.run.findUnique({ where: { id: req.params.id } });
      if (!run) return res.status(404).json({ error: "NOT_FOUND" });
      if (!isAdmin && run.userId !== userId) {
        return res.status(403).json({ error: "FORBIDDEN" });
      }
      if (run.status !== "AWAITING_COMPANY_CONFIRM") {
        return res.status(409).json({ error: "RUN_NOT_AWAITING_CONFIRM", status: run.status });
      }

      const analysis = (run.analysis ?? {}) as any;
      const updatedAnalysis = {
        ...analysis,
        company: company.trim(),
        companyInferred: false,
        confidence: 1,
      };

      await prisma.run.update({
        where: { id: run.id },
        data: {
          analysis: updatedAnalysis,
          status: "QUEUED" as RunStatus,
          pendingCompany: null,
        } as any,
      });

      await logStep(run.id, "api", "confirm_company:accepted", { company: company.trim() });

      // Re-enqueue from Stage 4 (analysis is now confirmed)
      const sourceText = run.sourceText ?? "";
      const job = await enqueueResumeRun({
        runId: run.id,
        userId: run.userId,
        isAdmin,
        input: {
          kind: (run.inputKind as any) ?? "paste",
          pasteText: sourceText, // worker will rehydrate sourceText directly
        },
        overrides: (run.overrides ?? {}) as any,
      }, { jobName: "pipeline.resume.resume" });

      await logStep(run.id, "api", "confirm_company:re_enqueued", { jobId: job.id });

      return res.status(202).json({ runId: run.id, jobId: job.id, status: "QUEUED" });
    } catch (err) {
      next(err);
    }
  },
);

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================
export async function shutdownWorker() {
  await runWorker.close();
  await runQueue.close();
  await runQueueEvents.close();
  await redis.quit().catch(() => void 0);
  await prisma.$disconnect().catch(() => void 0);
}

process.on("SIGTERM", shutdownWorker);
process.on("SIGINT", shutdownWorker);

// ============================================================================
// END OF FILE — Stages 0..5 + endpoints
// Stage 6 (Validation pass) and Stage 7 (Export/DOCX render) follow in
// the next package, per Victor's phased sign-off.
// ============================================================================
