// apps/api/src/pipeline/types.ts
// Shared types for the BullMQ pipeline. The Prisma schema is the source of
// truth (docs/DECISIONS.md): everything here is read from, or written to,
// existing models. The worker never invents its own data structures.

import type {
  BaseSnapshot,
  FactBankEntry,
  JdContext,
  ResumeDoc,
  RuleToggles,
  ValidationFlag,
  ValidationResult,
} from '@resume-engine/rules';

/** Mirrors the RunStatus enum in prisma/schema.prisma. */
export type RunStatusName =
  | 'QUEUED' | 'READING_JD' | 'ANALYZING' | 'AWAITING_COMPANY_CONFIRM'
  | 'REWRITING' | 'VALIDATING' | 'RENDERING' | 'EXPORTING_PDF'
  | 'COMPLETE' | 'FAILED' | 'CANCELLED';

/** Job payload on the `resume.run` queue. */
export interface RunJobData {
  runId: string;
  /** After company confirmation the run continues at Stage 4. */
  resumeFrom?: 'rewrite';
}

/** Stored in Run.settingsSnap when the run is created, so it can be reproduced. */
export interface SettingsSnapshot {
  toggles: RuleToggles;
  /** Full UserSettings row at creation time. */
  userSettings: Record<string, unknown>;
  /** ProfileSettings.overrides, if any. */
  profileOverrides: Record<string, unknown> | null;
}

export interface JdRecord {
  id: string;
  rawText: string;
  company: string | null;
  roleTitle: string | null;
  location: string | null;
  seniority: string | null;
  industryTags: string[];
  responsibilities: string[];
  requirements: string[];
  keywords: string[];
  companyInferred: boolean;
  companyConfidence: number | null;
}

export interface RosterRole {
  company: string;
  baseTitle: string;
  /** 'YYYY-MM' */
  startDate: string;
  endDate: string | null;
  location: string | null;
  baseFlagship: string | null;
  baseBullets: string[];
}

export interface ProfileRecord {
  id: string;
  fullName: string;
  city: string;
  phones: string[];
  email: string;
  linkedIn: string | null;
  roles: RosterRole[];
  education: BaseSnapshot['education'];
  certifications: BaseSnapshot['certifications'];
  facts: FactBankEntry[];
}

export interface RunContext {
  run: {
    id: string;
    userId: string;
    status: RunStatusName;
    companyConfirmed: boolean;
    contactLocationOverride: string | null;
    startedAt: Date | null;
    outputJson: unknown;
    ruleSetVersion: string;
  };
  jd: JdRecord;
  profile: ProfileRecord;
  base: {
    id: string;
    version: number;
    /** Extracted text of the active base resume. */
    text: string;
    /** The base resume's keyword block, when the parser recorded one. */
    keywords: string[];
  };
  snapshot: SettingsSnapshot;
  /** Present only when the run owner is on the AGENCY plan. */
  branding: { primaryColor: string; footerText: string | null } | null;
}

export interface StepLog {
  step: string;
  status: 'ok' | 'error' | 'skipped';
  attempt?: number;
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  modelId?: string;
  errorCode?: string;
  errorMsg?: string;
}

export interface AnalysisResult {
  company: string;
  roleTitle: string;
  location: string;
  seniority: string;
  industryTags: string[];
  topKeywords: string[];
  responsibilities: string[];
  requirements: string[];
  companyInferred: boolean;
  companyConfidence: number;
}

export interface CompletionRecord {
  status: 'COMPLETE' | 'FAILED';
  errorCode?: string;
  outputJson: ResumeDoc;
  validation: ValidationResult;
  qaFlags: ValidationFlag[];
  docxKey: string | null;
  pdfKey: string | null;
  docxSize: number | null;
  pdfSize: number | null;
  pageCount: number | null;
  keywordCount: number;
  actualTokens: number;
  jdTerms: string[];
  relatedTerms: string[];
}

/** Everything the orchestrator needs from persistence. */
export interface PipelineRepo {
  loadContext(runId: string): Promise<RunContext | null>;
  setStatus(runId: string, status: RunStatusName, patch?: {
    stage?: string;
    progress?: number;
    errorCode?: string | null;
    startedAt?: Date;
    finishedAt?: Date;
  }): Promise<void>;
  isCancelled(runId: string): Promise<boolean>;
  logStep(runId: string, entry: StepLog): Promise<void>;
  saveAnalysis(jdId: string, analysis: AnalysisResult): Promise<void>;
  /** Partial or final Run.outputJson (also used to resume after confirmation). */
  saveOutput(runId: string, output: unknown): Promise<void>;
  saveCompletion(runId: string, rec: CompletionRecord): Promise<void>;
  /** Replaces the run's ValidationFlag rows. */
  replaceFlags(runId: string, flags: ValidationFlag[]): Promise<void>;
}

export interface PipelineModels {
  analyze: string;
  write: string;
}

export const RULE_JD_CONTEXT = (jd: JdRecord, fallbackRole: string): JdContext => ({
  roleTitle: jd.roleTitle ?? fallbackRole,
  keywords: jd.keywords,
});
