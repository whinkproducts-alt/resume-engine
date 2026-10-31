import type { RunListItem, RunStatus } from "./types";

export type Tone = "warn" | "ok" | "fail" | "idle";

export function statusTone(s: RunStatus): Tone {
  if (s === "COMPLETE") return "ok";
  if (s === "FAILED") return "fail";
  if (s === "AWAITING_COMPANY_CONFIRM") return "warn";
  return "idle";
}

export const STATUS_LABEL: Record<RunStatus, string> = {
  QUEUED: "Queued",
  READING_JD: "Reading JD",
  ANALYZING: "Analyzing",
  AWAITING_COMPANY_CONFIRM: "Needs company",
  REWRITING: "Rewriting",
  VALIDATING: "Validating",
  RENDERING: "Rendering",
  EXPORTING_PDF: "Exporting PDF",
  COMPLETE: "Complete",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

/** The steps shown on the progress screen, in pipeline order. */
export const PROGRESS_STEPS: { label: string; statuses: RunStatus[] }[] = [
  { label: "Read the job description", statuses: ["QUEUED", "READING_JD"] },
  { label: "Analyze the role", statuses: ["ANALYZING", "AWAITING_COMPANY_CONFIRM"] },
  { label: "Rewrite the sections", statuses: ["REWRITING"] },
  { label: "Validate against the rules", statuses: ["VALIDATING"] },
  { label: "Render the document", statuses: ["RENDERING"] },
  { label: "Export the PDF", statuses: ["EXPORTING_PDF"] },
];

/** Index of the active step; every step is done once the run is complete. */
export function activeStep(status: RunStatus): number {
  if (status === "COMPLETE") return PROGRESS_STEPS.length;
  const i = PROGRESS_STEPS.findIndex((s) => s.statuses.includes(status));
  return i < 0 ? 0 : i;
}

/** Human text for the stable error codes the pipeline writes to Run.errorCode. */
export const ERROR_TEXT: Record<string, string> = {
  JD_UNUSABLE: "The job description was too short to use.",
  PROFILE_ROSTER_MISSING: "This profile has no employment roster yet. Add roles on the profile page.",
  COMPANY_MISSING: "No company name could be determined.",
  VALIDATION_FAILED: "The rewrite still broke blocking rules after retries. Nothing was exported.",
  PIPELINE_ERROR: "Something went wrong while generating. You can retry.",
};

export function errorText(code: string | null): string | null {
  return code ? (ERROR_TEXT[code] ?? code) : null;
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

/** A finished run opens its review; one waiting on the company opens the confirm step. */
export function runHref(r: Pick<RunListItem, "id" | "status">): string {
  if (r.status === "COMPLETE") return `/runs/${r.id}/review`;
  if (r.status === "AWAITING_COMPANY_CONFIRM") return `/runs/${r.id}/confirm`;
  return `/runs/${r.id}`;
}

/** The API has no free text search, so the text box filters the pages already loaded. */
export function matchesQuery(r: Pick<RunListItem, "profileName" | "company" | "roleTitle">, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [r.profileName, r.company, r.roleTitle].some((v) => v?.toLowerCase().includes(needle));
}

