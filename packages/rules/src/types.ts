// packages/rules/src/types.ts
// Domain types for the deterministic Rule Validator (Stage 6).
//
// Rule semantics follow the authoritative R1..R20 table in
// docs/source-parts/Resume_Engine_Spec_v3.1.txt (Section 4). The resume model
// mirrors the shape of Run.outputJson and the Prisma Profile / RoleEntry /
// Education / Certification models (the schema is the source of truth).

export type Severity = 'error' | 'warn' | 'info';

/** A single finding emitted by a rule. */
export interface ValidationFlag {
  ruleId: string;                 // 'R1' .. 'R20', or 'FACTS'
  code: string;                   // machine-readable, e.g. 'HEADER_CHANGED'
  severity: Severity;
  blocking: boolean;              // true => section must be regenerated
  message: string;                // human-readable
  path?: string;                  // e.g. 'experience[2].bullets[0]'
  meta?: Record<string, unknown>;
}

export type Flag = ValidationFlag;

/* ------------------------------- Resume model ------------------------------ */

/** R1: the header block is copied byte-for-byte from the profile. */
export interface ResumeHeader {
  fullName: string;
  city: string;
  phones: string[];
  email: string;
  linkedIn?: string | null;
}

/** R5: Core Competencies subsection. */
export interface CompetencyGroup {
  label: string;
  items: string[];
}

export interface ExperienceItem {
  id: string;
  company: string;
  title: string;
  location?: string | null;
  startDate: string;              // 'YYYY-MM'
  endDate?: string | null;        // null / undefined => current role
  /** R8: the single bold flagship line that opens the role. */
  flagship: string;
  bullets: string[];
}

export interface EducationItem {
  institution: string;
  degree: string;
  field?: string | null;
  startYear: number;
  endYear?: number | null;
}

export interface CertificationItem {
  name: string;
  issuer?: string | null;
  year?: number | null;
}

/** R16: "Target companies and similar roles". */
export interface TargetCompany {
  name: string;
  department: string;
  exampleRole: string;
}

export interface ResumeMeta {
  runId: string;
  fileName: string;               // output artifact name, e.g. 'Jane Doe_CTO_Acme.docx'
  candidateName: string;
  targetRole: string;
  company?: string;
  generatedAt: string;            // ISO-8601
  pageCount?: number;             // filled in by Stage 8 QA
}

export interface ResumeDoc {
  meta: ResumeMeta;
  header: ResumeHeader;
  /** R3: exactly two lines, role line then industry line. */
  headline: string[];
  /** R4: four short paragraphs. */
  summary: string[];
  /** R5: six subsections in a fixed order. */
  competencies: CompetencyGroup[];
  experience: ExperienceItem[];
  education: EducationItem[];
  certifications: CertificationItem[];
  /** R14 / R15: the keyword block. */
  keywords: string[];
  /** R16: exactly seven. */
  targetCompanies: TargetCompany[];
}

/* ------------------------- Reference data for checks ------------------------ */

export interface BaseRole {
  company: string;
  baseTitle: string;
  startDate: string;              // 'YYYY-MM'
  endDate?: string | null;
  location?: string | null;
  flagship?: string | null;
  bullets: string[];
}

/** The profile roster plus the active base resume (R1, R6, R7, R12, R13, R15, R19). */
export interface BaseSnapshot {
  header: ResumeHeader;
  roles: BaseRole[];
  education: EducationItem[];
  certifications: CertificationItem[];
  /** The base resume's keyword block. */
  keywords: string[];
}

/** What Stage 2 extracted from the job description (R2, R4, R6, R14). */
export interface JdContext {
  roleTitle: string;
  keywords: string[];
}

/** The subset of UserSettings that changes rule behaviour. */
export interface RuleToggles {
  /** UserSettings.banHyphensInProse */
  banHyphensInProse: boolean;
  /** UserSettings.whinkGroupFraming (R17) */
  whinkGroupFraming: boolean;
  /** UserSettings.strictFactsMode: unverified numbers block the run. */
  strictFactsMode: boolean;
}

export const DEFAULT_TOGGLES: RuleToggles = {
  banHyphensInProse: true,
  whinkGroupFraming: false,
  strictFactsMode: true,
};

/* -------------------------------- Fact bank -------------------------------- */

export type FactKind =
  | 'metric' | 'date' | 'employer' | 'title'
  | 'education' | 'skill' | 'other';

/**
 * Engine-side view of a fact. The database model is Prisma's FactBankEntry
 * (claimText, metricValue, metricUnit, ...); the worker maps one to the other.
 */
export interface FactBankEntry {
  id: string;
  kind: FactKind;
  /** Canonical surface form, e.g. '42%' or 'Acme Corp'. */
  value: string;
  /** Alternate spellings that also count as a match. */
  aliases?: string[];
  /** Normalised numeric value when kind === 'metric'. */
  numeric?: number;
  /** Normalised unit when kind === 'metric' ('%', 'k', 'users', ...). */
  unit?: string;
  verified: boolean;
  sourceRunId?: string;
}

/* ------------------------------ LLM judgement ------------------------------ */

/** Supplied by Stage 4/6. Consumed only by R9, which never blocks. */
export interface LlmJudgement {
  bulletScores?: { path: string; score: number; rationale?: string }[];
  overallScore?: number;
  notes?: string[];
}

/* --------------------------------- Config ---------------------------------- */

export interface RuleConfig {
  /** R18: authoritative regex from Victor's sign-off. */
  filenamePattern: RegExp;
  /** R2: 70% token overlap, stop words ignored. */
  roleOverlapThreshold: number;
  roleStopWords: readonly string[];
  /** R3: headline line count. */
  headlineLines: number;
  /** R4: paragraph count. */
  summaryParagraphs: number;
  /** R5: the six subsection labels, in order. */
  competencyLabels: readonly string[];
  /** R11: minimum experience points per role (flagship plus bullets). */
  minPointsPerRole: number;
  /** R14: minimum distinct keyword terms. */
  minKeywords: number;
  /** R16: number of target companies. */
  targetCompanyCount: number;
  /** Stage 8 page budget (PAGE_OVERFLOW warn). */
  maxPages: number;
  /** Retry budget when a blocking failure occurs (Stage 6). */
  maxRetries: number;
  /** R9: warn when an LLM bullet score falls below this. */
  llmScoreFloor: number;

  /* Heuristic thresholds the spec does not number. They only ever warn. */
  /** R4 "short paragraphs": words per paragraph. */
  summaryMaxParagraphWords: number;
  /** R4 "uses JD language": minimum JD keywords found in the summary. */
  summaryMinJdTerms: number;
  /** R20 "short sentences": words per sentence. */
  maxSentenceWords: number;
  /** R19: token similarity at or above which a rewrite is flagged as near-identical. */
  nearDuplicateSimilarity: number;
}

export const R18_FILENAME_PATTERN =
  /^[a-zA-Z0-9\s\-_]+_[a-zA-Z0-9\s\-_]+_[a-zA-Z0-9\s\-_]+\.docx$/;

export const COMPETENCY_LABELS = [
  'Soft Skills',
  'Stakeholder Management',
  'Technical Skills',
  'Delivery Methodologies',
  'Security and Compliance',
  'Business Tools',
] as const;

export const DEFAULT_RULE_CONFIG: RuleConfig = {
  filenamePattern: R18_FILENAME_PATTERN,
  roleOverlapThreshold: 0.7,
  roleStopWords: [
    'senior', 'sr', 'lead', 'principal', 'staff', 'junior', 'jr',
    'head', 'chief', 'the', 'of', 'and', 'a', 'an', 'for', 'in', 'at',
    'to', 'with', 'i', 'ii', 'iii', 'iv',
  ],
  headlineLines: 2,
  summaryParagraphs: 4,
  competencyLabels: COMPETENCY_LABELS,
  minPointsPerRole: 8,
  minKeywords: 150,
  targetCompanyCount: 7,
  maxPages: 3,
  maxRetries: 2,
  llmScoreFloor: 0.6,
  summaryMaxParagraphWords: 70,
  summaryMinJdTerms: 2,
  maxSentenceWords: 28,
  nearDuplicateSimilarity: 0.9,
};

/* ------------------------------ Rule plumbing ------------------------------ */

export interface RuleContext {
  resume: ResumeDoc;
  base: BaseSnapshot;
  jd: JdContext;
  toggles: RuleToggles;
  factBank: FactBankEntry[];
  config: RuleConfig;
  /** Output filename to be validated by R18. */
  fileName: string;
  /** Stage 5 contact location override; R1 accepts it in place of the profile city. */
  contactLocationOverride?: string | null;
  /** Optional LLM judgement for R9. */
  llmJudgement?: LlmJudgement;
  /** 1-based attempt number. */
  attempt?: number;
}

export interface Rule {
  id: string;
  name: string;
  /** Default severity applied to flags this rule emits. */
  severity: Severity;
  /** Default blocking behaviour. A non-blocking rule can never block a run. */
  blocking: boolean;
  evaluate(ctx: RuleContext): ValidationFlag[] | Promise<ValidationFlag[]>;
}

export interface RuleOutcome {
  ruleId: string;
  name: string;
  passed: boolean;
  flagCount: number;
  durationMs: number;
  error?: string;
}

export interface ValidationResult {
  runId: string;
  attempt: number;
  passed: boolean;
  /** True when at least one blocking flag exists and retry budget remains. */
  requiresRetry: boolean;
  blockingFailures: ValidationFlag[];
  warnings: ValidationFlag[];
  infos: ValidationFlag[];
  flags: ValidationFlag[];
  ruleResults: RuleOutcome[];
  evaluatedAt: string;
}

/** Signature used by the run orchestrator to re-generate a resume. */
export type RegenerateFn = (
  attempt: number,
  feedback: ValidationFlag[],
) => Promise<ResumeDoc>;

export interface RetryOutcome {
  resume: ResumeDoc;
  result: ValidationResult;
  attempts: number;
  exhausted: boolean;       // true => retries used up with blocking failures
  requiresHumanReview: boolean;
}
