// Types mirror the backend responses (01-SPEC-v3.md section 7 and the Nest
// controllers in apps/api). The backend defines the contract; when the UI wants a
// different shape it transforms the data, it does not ask the API to change.

export type UserRole = "USER" | "PRO" | "AGENCY" | "ADMIN";

export interface User {
  id: string;
  email: string;
  role: UserRole;
  isAdmin: boolean;
  adminUnlimited: boolean;
  emailVerified: boolean;
  mustChangePassword: boolean;
  firstName: string | null;
  lastName: string | null;
  themePref: string;
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

/* -------------------------------- profiles --------------------------------- */

export interface Profile {
  id: string;
  name: string;
  headerFullName: string;
  headerCity: string;
  headerPhones: string[];
  headerEmail: string;
  linkedIn: string | null;
  isDefault: boolean;
  activeBaseId: string | null;
}

export interface RoleEntry {
  id: string;
  companyName: string;
  title: string;
  baseTitle: string;
  startDate: string;
  endDate: string | null;
  location: string | null;
  orderIndex: number;
  baseBullets: string[];
  baseFlagship: string | null;
}

export interface EducationEntry {
  id: string;
  institution: string;
  degree: string;
  field: string | null;
  startYear: number;
  endYear: number | null;
}

export interface CertEntry {
  id: string;
  name: string;
  issuer: string | null;
  year: number | null;
}

export interface BaseSummary {
  id: string;
  version: number;
  fileName: string;
  isActive: boolean;
  uploadedAt: string;
}

export interface ProfileDetail extends Profile {
  roles: RoleEntry[];
  education: EducationEntry[];
  certs: CertEntry[];
  bases: BaseSummary[];
}

export interface CreateProfileInput {
  name: string;
  headerFullName: string;
  headerCity: string;
  headerPhones: string[];
  headerEmail: string;
  linkedIn?: string;
}

/* -------------------------------- fact bank -------------------------------- */

export const FACT_KINDS = ["metric", "date", "employer", "title", "education", "skill", "other"] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export interface FactEntry {
  id: string;
  profileId: string;
  roleId: string | null;
  kind: FactKind | string;
  claimText: string;
  metricValue: string | null;
  metricUnit: string | null;
  context: string;
  employer: string | null;
  verified: boolean;
  sourceNote: string | null;
}

export interface CreateFactInput {
  kind: FactKind;
  claimText: string;
  metricValue?: string;
  metricUnit?: string;
  context: string;
  employer?: string;
  verified?: boolean;
}

/* ----------------------------------- JDs ----------------------------------- */

export interface JdCreated {
  id: string;
  status: string;
  sourceType: string;
  extractedChars: number;
  createdAt: string;
}

export interface JobDescription {
  id: string;
  rawText: string;
  company: string | null;
  roleTitle: string | null;
}

/* ----------------------------------- runs ---------------------------------- */

export type RunStatus =
  | "QUEUED" | "READING_JD" | "ANALYZING" | "AWAITING_COMPANY_CONFIRM"
  | "REWRITING" | "VALIDATING" | "RENDERING" | "EXPORTING_PDF"
  | "COMPLETE" | "FAILED" | "CANCELLED";

export const TERMINAL_STATUSES: RunStatus[] = ["COMPLETE", "FAILED", "CANCELLED"];

export interface RunCreated {
  runId: string;
  status: RunStatus;
  eventsUrl: string;
}

export interface RunListItem {
  id: string;
  status: RunStatus;
  stage: string | null;
  progress: number;
  profileId: string;
  profileName: string;
  jdId: string;
  company: string | null;
  roleTitle: string | null;
  errorCode: string | null;
  pageCount: number | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface RunDetail {
  id: string;
  status: RunStatus;
  stage: string | null;
  progress: number;
  profileId: string;
  jdId: string;
  baseResumeId: string;
  companyConfirmed: boolean;
  pendingCompany: { name: string | null; inferred: boolean; confidence: number | null } | null;
  roleTitle: string | null;
  pageCount: number | null;
  keywordCount: number | null;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RunProgress {
  status: RunStatus;
  stage: string | null;
  progress: number;
  errorCode: string | null;
}

export interface ValidationFlag {
  id: string;
  ruleId: string | null;
  code: string;
  severity: "error" | "warn" | "info";
  blocking: boolean;
  field: string | null;
  message: string;
}

export interface RunValidation {
  passed: boolean;
  flags: ValidationFlag[];
  counts: { total: number; blocking: number; warnings: number; infos: number };
}

/** Run.outputJson (the ResumeDoc produced by the pipeline). */
export interface ResumeOutput {
  meta: { runId: string; fileName: string; candidateName: string; targetRole: string; company?: string };
  header: { fullName: string; city: string; phones: string[]; email: string; linkedIn?: string | null };
  headline: string[];
  summary: string[];
  competencies: { label: string; items: string[] }[];
  experience: {
    id: string; company: string; title: string; location?: string | null;
    startDate: string; endDate?: string | null; flagship: string; bullets: string[];
  }[];
  education: { institution: string; degree: string; field?: string | null; startYear: number; endYear?: number | null }[];
  certifications: { name: string; issuer?: string | null; year?: number | null }[];
  keywords: string[];
  targetCompanies: { name: string; department: string; exampleRole: string }[];
}

export interface RunOutput {
  outputJson: ResumeOutput;
  atsScore: number | null;
  metrics: unknown;
  keywordCount: number | null;
  targetCompanies: { rank: number; name: string; department: string | null; exampleRole: string | null }[];
  validation: unknown;
}

export interface ArtifactLink {
  url: string;
  expiresAt: string;
}

/* ---------------------------- settings / branding --------------------------- */

export const SETTING_KEYS = [
  "strictFactsMode", "flagAndInclude", "lockCompanyNames", "lockEmploymentDates",
  "blockOnUnusableJD", "inferCompanyName", "banHyphensInProse", "consultingFraming",
  "whinkGroupFraming", "heritageLineDefault",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
export type Settings = Record<SettingKey, boolean>;

export interface Branding {
  displayName: string;
  logoUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  footerText: string | null;
  primaryColor: string;
  updatedAt: string;
}

/* ----------------------------------- admin --------------------------------- */

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  isAdmin: boolean;
  totpEnabled: boolean;
  runsThisMonth: number;
  runsLimit: number | null;
  createdAt: string;
}

export interface AdminRunRow {
  id: string;
  status: RunStatus;
  stage: string | null;
  progress: number;
  userId: string;
  userEmail: string;
  planTier: string;
  company: string | null;
  roleTitle: string | null;
  errorCode: string | null;
  actualTokens: number | null;
  pageCount: number | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface AdminRunDetail {
  run: Omit<AdminRunRow, "userEmail" | "company" | "roleTitle"> & {
    profileId: string; jdId: string; keywordCount: number | null; startedAt: string | null;
  };
  logs: { id: string; step: string; status: string; attempt: number; durationMs: number | null;
          tokensIn: number | null; tokensOut: number | null; modelId: string | null;
          errorCode: string | null; errorMsg: string | null; createdAt: string }[];
  flags: ValidationFlag[];
  versions: { ruleSet: string; promptVersion: string; baseResume: number | null; models: string[] };
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  target: string | null;
  ip: string | null;
  createdAt: string;
  meta: unknown;
}

export interface TwoFaEnrollment {
  adminId: string;
  issuer: string;
  account: string;
  secret: string;
  otpauth: string;
  qrDataUrl: string;
  recoveryCodes: string[];
  note: string;
}
