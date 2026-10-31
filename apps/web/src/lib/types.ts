export type Role = "owner" | "admin" | "member";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  agencyId: string;
  twoFactorEnabled: boolean;
}

export interface Profile {
  id: string;
  name: string;
  headline?: string;
  baseResumeFileName?: string;
  headerLocked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  profileId: string;
  profileName: string;
  status: "queued" | "running" | "awaiting_confirm" | "review" | "completed" | "failed";
  stageLabel?: string;
  companyGuess?: { name: string; confidence: number; evidence: string[] };
  jdSource: "paste" | "file" | "url";
  createdAt: string;
  completedAt?: string;
}

export type FlagSeverity = "warn" | "fail" | "info";
export interface ValidationFlag {
  id: string;
  rule: string;       // e.g. "R2", "R9", "R10", "R18"
  severity: FlagSeverity;
  message: string;
  sectionRef?: string;
  bulletRef?: string;
}

export interface Bullet {
  id: string;
  text: string;
  locked?: boolean;
}

export interface Section {
  id: string;
  title: string;
  bullets: Bullet[];
}

export interface RunReview {
  runId: string;
  jd: string;
  sections: Section[];
  flags: ValidationFlag[];
  downloadUrls: { docx: string; pdf: string };
}

export interface HistoryRow {
  id: string;
  profileName: string;
  company: string;
  status: Run["status"];
  createdAt: string;
  downloadUrl: string;
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  target: string;
  createdAt: string;
  meta?: Record<string, unknown>;
}

export interface Branding {
  logoUrl?: string;
  primaryColor: string;
  footerText: string;
}

export interface Settings {
  accuracyToggles: Record<string, boolean>; // keyed by toggle id
  theme: "dark" | "light";                   // dark locked, kept for future
}
