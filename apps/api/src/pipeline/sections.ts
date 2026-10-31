// apps/api/src/pipeline/sections.ts
// Stage 4 (rewrite, one LLM call per section, retryable per section) and
// Stage 5 (assemble). Header, roster, education and certifications are copied
// from the database, never produced by the model (rules R1, R7, R13).

import { z } from 'zod';
import {
  extractLeadingVerb,
  toRetryFeedback,
  type CompetencyGroup,
  type ResumeDoc,
  type TargetCompany,
  type ValidationFlag,
} from '@resume-engine/rules';
import type { LlmClient } from './llm';
import { factsForPrompt } from './facts';
import {
  COMPETENCIES_SCHEMA, HEADLINE_SCHEMA, KEYWORDS_SCHEMA, ROLE_SCHEMA, SUMMARY_SCHEMA,
  TARGETS_SCHEMA, competenciesPrompt, headlinePrompt, keywordsPrompt, rolePrompt,
  summaryPrompt, targetsPrompt, type WriteContext,
} from './prompts';
import type { PipelineModels, PipelineRepo, RunContext } from './types';

/* --------------------------------- results --------------------------------- */

export interface RoleSection { title: string; flagship: string; bullets: string[] }

export interface Sections {
  headline: string[];
  summary: string[];
  competencies: CompetencyGroup[];
  roles: RoleSection[];
  keywords: string[];
  targets: TargetCompany[];
}

export type SectionKey =
  | 'headline' | 'summary' | 'competencies' | 'keywords' | 'targets' | `role:${number}`;

const zHeadline = z.object({ roleLine: z.string(), industryLine: z.string() });
const zSummary = z.object({ paragraphs: z.array(z.string()) });
const zCompetencies = z.object({
  groups: z.array(z.object({ label: z.string(), items: z.array(z.string()) })),
});
const zRole = z.object({ title: z.string(), flagship: z.string(), bullets: z.array(z.string()) });
const zKeywords = z.object({ keywords: z.array(z.string()) });
const zTargets = z.object({
  companies: z.array(z.object({
    name: z.string(), department: z.string(), exampleRole: z.string(),
  })),
});

const clean = (s: string) => s.trim();

/** Case-insensitive de-duplication that keeps first spelling and order (rule R14: "Dedupe"). */
export function dedupeKeywords(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of list.map(clean).filter(Boolean)) {
    const key = k.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(k); }
  }
  return out;
}

/* ------------------------------ flag -> section ----------------------------- */

/** Which sections can fix a given flag. Header, roster and education come from the database. */
export function sectionForPath(path: string | undefined): SectionKey | null {
  if (!path) return null;
  if (path.startsWith('headline')) return 'headline';
  if (path.startsWith('summary')) return 'summary';
  if (path.startsWith('competencies')) return 'competencies';
  if (path.startsWith('keywords')) return 'keywords';
  if (path.startsWith('targetCompanies')) return 'targets';
  const m = /^experience\[(\d+)\]/.exec(path);
  return m && m[1] !== undefined ? (`role:${Number(m[1])}` as SectionKey) : null;
}

export function groupFeedback(flags: ValidationFlag[]): Map<SectionKey, ValidationFlag[]> {
  const out = new Map<SectionKey, ValidationFlag[]>();
  for (const f of flags) {
    const key = sectionForPath(f.path);
    if (!key) continue;
    const list = out.get(key) ?? [];
    list.push(f);
    out.set(key, list);
  }
  return out;
}

/* -------------------------------- generator -------------------------------- */

export interface GeneratorDeps {
  llm: LlmClient;
  models: PipelineModels;
  repo: PipelineRepo;
}

export class SectionGenerator {
  tokens = 0;
  private attempt = 1;

  constructor(
    private readonly deps: GeneratorDeps,
    private readonly ctx: RunContext,
    private readonly company: string,
  ) {}

  private writeCtx(feedback?: ValidationFlag[]): WriteContext {
    const { jd, profile, base, snapshot } = this.ctx;
    return {
      company: this.company,
      roleTitle: jd.roleTitle ?? '',
      seniority: jd.seniority,
      industryTags: jd.industryTags,
      jdKeywords: jd.keywords,
      responsibilities: jd.responsibilities,
      requirements: jd.requirements,
      sourceResume: base.text,
      factBank: factsForPrompt(profile.facts, snapshot.toggles.strictFactsMode),
      toggles: snapshot.toggles,
      ...(feedback && feedback.length ? { feedback: toRetryFeedback(feedback) } : {}),
    };
  }

  private async call<T>(
    step: string,
    prompt: { system: string; user: string },
    schema: Parameters<LlmClient['completeJson']>[0]['schema'],
    parser: z.ZodType<T>,
  ): Promise<T> {
    const t0 = Date.now();
    const model = this.deps.models.write;
    try {
      const res = await this.deps.llm.completeJson({ model, system: prompt.system, user: prompt.user, schema });
      this.tokens += res.tokensIn + res.tokensOut;
      const parsed = parser.parse(res.data);
      await this.deps.repo.logStep(this.ctx.run.id, {
        step, status: 'ok', attempt: this.attempt, durationMs: Date.now() - t0,
        tokensIn: res.tokensIn, tokensOut: res.tokensOut, modelId: res.model,
      });
      return parsed;
    } catch (err) {
      await this.deps.repo.logStep(this.ctx.run.id, {
        step, status: 'error', attempt: this.attempt, durationMs: Date.now() - t0, modelId: model,
        errorCode: err instanceof z.ZodError ? 'LLM_SCHEMA_MISMATCH' : 'LLM_CALL_FAILED',
        errorMsg: err instanceof Error ? err.message.slice(0, 500) : String(err),
      });
      throw err;
    }
  }

  async headline(feedback?: ValidationFlag[]): Promise<string[]> {
    const r = await this.call('rewrite.headline', headlinePrompt(this.writeCtx(feedback)), HEADLINE_SCHEMA, zHeadline);
    return [clean(r.roleLine), clean(r.industryLine)];
  }

  async summary(feedback?: ValidationFlag[]): Promise<string[]> {
    const r = await this.call('rewrite.summary', summaryPrompt(this.writeCtx(feedback)), SUMMARY_SCHEMA, zSummary);
    return r.paragraphs.map(clean).filter(Boolean);
  }

  async competencies(feedback?: ValidationFlag[]): Promise<CompetencyGroup[]> {
    const r = await this.call('rewrite.competencies', competenciesPrompt(this.writeCtx(feedback)), COMPETENCIES_SCHEMA, zCompetencies);
    return r.groups.map((g) => ({ label: clean(g.label), items: g.items.map(clean).filter(Boolean) }));
  }

  async role(index: number, usedVerbs: string[], feedback?: ValidationFlag[]): Promise<RoleSection> {
    const roster = this.ctx.profile.roles[index];
    if (!roster) throw new Error(`ROLE_NOT_IN_ROSTER:${index}`);
    const r = await this.call(
      `rewrite.role.${index}`,
      rolePrompt(this.writeCtx(feedback), {
        company: roster.company,
        baseTitle: roster.baseTitle,
        startDate: roster.startDate,
        endDate: roster.endDate,
        location: roster.location,
        baseFlagship: roster.baseFlagship,
        baseBullets: roster.baseBullets,
        usedVerbs,
      }),
      ROLE_SCHEMA, zRole,
    );
    return { title: clean(r.title), flagship: clean(r.flagship), bullets: r.bullets.map(clean).filter(Boolean) };
  }

  async keywords(feedback?: ValidationFlag[]): Promise<string[]> {
    const r = await this.call('rewrite.keywords', keywordsPrompt(this.writeCtx(feedback), this.ctx.base.keywords), KEYWORDS_SCHEMA, zKeywords);
    return dedupeKeywords(r.keywords);
  }

  async targets(feedback?: ValidationFlag[]): Promise<TargetCompany[]> {
    const r = await this.call('rewrite.targets', targetsPrompt(this.writeCtx(feedback)), TARGETS_SCHEMA, zTargets);
    return r.companies.map((c) => ({ name: clean(c.name), department: clean(c.department), exampleRole: clean(c.exampleRole) }));
  }

  /** Stage 4: every section, in the order and with the progress points from the spec. */
  async generateAll(onProgress: (progress: number, stage: string) => Promise<void>): Promise<Sections> {
    this.attempt = 1;
    const headline = await this.headline();            await onProgress(0.10, 'headline');
    const summary = await this.summary();              await onProgress(0.30, 'summary');
    const competencies = await this.competencies();   await onProgress(0.45, 'competencies');

    const roles: RoleSection[] = [];
    const n = this.ctx.profile.roles.length;
    for (let i = 0; i < n; i++) {
      roles.push(await this.role(i, verbsOf(roles)));
      await onProgress(0.55 + (0.30 * (i + 1)) / Math.max(1, n), `role ${i + 1} of ${n}`);
    }

    const keywords = await this.keywords();            await onProgress(0.90, 'keywords');
    const targets = await this.targets();              await onProgress(0.95, 'targets');
    return { headline, summary, competencies, roles, keywords, targets };
  }

  /** Stage 6 retry: regenerate only the sections that have blocking failures. */
  async regenerate(
    sections: Sections,
    flags: ValidationFlag[],
    attempt: number,
  ): Promise<Sections> {
    this.attempt = attempt + 1;
    const next: Sections = { ...sections, roles: [...sections.roles] };
    for (const [key, list] of groupFeedback(flags)) {
      if (key === 'headline') next.headline = await this.headline(list);
      else if (key === 'summary') next.summary = await this.summary(list);
      else if (key === 'competencies') next.competencies = await this.competencies(list);
      else if (key === 'keywords') next.keywords = await this.keywords(list);
      else if (key === 'targets') next.targets = await this.targets(list);
      else {
        const i = Number(key.slice('role:'.length));
        const others = next.roles.filter((_, j) => j !== i);
        next.roles[i] = await this.role(i, verbsOf(others), list);
      }
    }
    return next;
  }
}

function verbsOf(roles: RoleSection[]): string[] {
  const verbs = new Set<string>();
  for (const r of roles) {
    for (const line of [r.flagship, ...r.bullets]) {
      const v = extractLeadingVerb(line);
      if (v) verbs.add(v);
    }
  }
  return [...verbs];
}

/* --------------------------------- assemble -------------------------------- */

/** R18: "Candidate_Role_Company.docx", letters, digits, spaces and hyphens only inside each part. */
export function buildFileName(candidate: string, role: string, company: string): string {
  const part = (s: string, fallback: string) =>
    s.replace(/[^a-zA-Z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim() || fallback;
  return `${part(candidate, 'Candidate')}_${part(role, 'Role')}_${part(company, 'Company')}.docx`;
}

export function assemble(
  ctx: RunContext,
  sections: Sections,
  company: string,
  now: Date,
): ResumeDoc {
  const { profile, jd, run } = ctx;
  const override = run.contactLocationOverride?.trim();
  const roleTitle = jd.roleTitle ?? '';

  return {
    meta: {
      runId: run.id,
      fileName: buildFileName(profile.fullName, roleTitle, company),
      candidateName: profile.fullName,
      targetRole: roleTitle,
      company,
      generatedAt: now.toISOString(),
    },
    header: {
      fullName: profile.fullName,
      city: override ? override : profile.city,
      phones: profile.phones,
      email: profile.email,
      linkedIn: profile.linkedIn,
    },
    headline: sections.headline,
    summary: sections.summary,
    competencies: sections.competencies,
    experience: profile.roles.map((roster, i) => {
      const w = sections.roles[i];
      return {
        id: `role-${i}`,
        company: roster.company,
        title: w?.title ?? '',
        location: roster.location,
        startDate: roster.startDate,
        endDate: roster.endDate,
        flagship: w?.flagship ?? '',
        bullets: w?.bullets ?? [],
      };
    }),
    education: profile.education,
    certifications: profile.certifications,
    keywords: sections.keywords,
    targetCompanies: sections.targets,
  };
}

/** Pulls the model-written sections back out of an assembled document. */
export function sectionsFromResume(doc: ResumeDoc): Sections {
  return {
    headline: doc.headline,
    summary: doc.summary,
    competencies: doc.competencies,
    roles: doc.experience.map((e) => ({ title: e.title, flagship: e.flagship, bullets: e.bullets })),
    keywords: doc.keywords,
    targets: doc.targetCompanies,
  };
}
