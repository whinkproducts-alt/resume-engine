import { describe, expect, it } from "vitest";
import { isMonth, metricLooksValid, parseLines, parsePhones, toIntOrNull, toMonth } from "@/lib/forms";
import { factDraftValid } from "@/components/profiles/facts-editor";
import {
  PROGRESS_STEPS, activeStep, errorText, matchesQuery, runHref, statusTone,
} from "@/lib/run-status";
import { roleDraftValid } from "@/components/profiles/roster-editor";
import { formatRange } from "@/components/runs/resume-preview";
import type { RunStatus } from "@/lib/types";

describe("forms", () => {
  it("parses phones and lines", () => {
    expect(parsePhones(" +234 800 1, ,+44 20 7946 0000 ")).toEqual(["+234 800 1", "+44 20 7946 0000"]);
    expect(parseLines("a\n\n  b  \n")).toEqual(["a", "b"]);
  });
  it("normalises months and numbers", () => {
    expect(toMonth("2020-01-01T00:00:00.000Z")).toBe("2020-01");
    expect(toMonth(null)).toBe("");
    expect(isMonth("2020-01")).toBe(true);
    expect(["2020-13", "2020-1", "20-01", ""].some(isMonth)).toBe(false);
    expect(toIntOrNull("2012")).toBe(2012);
    expect(toIntOrNull("")).toBeNull();
  });
});

describe("run status helpers", () => {
  it("maps every status to a progress step and a tone", () => {
    const all: RunStatus[] = ["QUEUED", "READING_JD", "ANALYZING", "AWAITING_COMPANY_CONFIRM", "REWRITING",
      "VALIDATING", "RENDERING", "EXPORTING_PDF", "COMPLETE", "FAILED", "CANCELLED"];
    for (const s of all) expect(activeStep(s)).toBeGreaterThanOrEqual(0);
    expect(activeStep("QUEUED")).toBe(0);
    expect(activeStep("REWRITING")).toBe(2);
    expect(activeStep("EXPORTING_PDF")).toBe(PROGRESS_STEPS.length - 1);
    expect(activeStep("COMPLETE")).toBe(PROGRESS_STEPS.length);
    expect(statusTone("COMPLETE")).toBe("ok");
    expect(statusTone("FAILED")).toBe("fail");
    expect(statusTone("AWAITING_COMPANY_CONFIRM")).toBe("warn");
  });
  it("routes a run to the right screen", () => {
    expect(runHref({ id: "r", status: "COMPLETE" })).toBe("/runs/r/review");
    expect(runHref({ id: "r", status: "AWAITING_COMPANY_CONFIRM" })).toBe("/runs/r/confirm");
    expect(runHref({ id: "r", status: "REWRITING" })).toBe("/runs/r");
  });
  it("explains the stable error codes and passes unknown ones through", () => {
    expect(errorText("PROFILE_ROSTER_MISSING")).toMatch(/roster/);
    expect(errorText("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(errorText(null)).toBeNull();
  });
  it("filters history rows by profile, company or role", () => {
    const r = { profileName: "Product 2026", company: "Stripe", roleTitle: "Senior PM" };
    expect(matchesQuery(r, "")).toBe(true);
    expect(matchesQuery(r, "stri")).toBe(true);
    expect(matchesQuery(r, "senior")).toBe(true);
    expect(matchesQuery(r, "google")).toBe(false);
    expect(matchesQuery({ profileName: "P", company: null, roleTitle: null }, "x")).toBe(false);
  });
});

describe("roster and preview helpers", () => {
  const ok = { companyName: "Acme", title: "PM", baseTitle: "PM", startDate: "2020-01", endDate: "", location: "", baseFlagship: "", baseBullets: "" };
  it("validates a role draft", () => {
    expect(roleDraftValid(ok)).toBe(true);
    expect(roleDraftValid({ ...ok, endDate: "2021-06" })).toBe(true);
    expect(roleDraftValid({ ...ok, startDate: "Jan 2020" })).toBe(false);
    expect(roleDraftValid({ ...ok, endDate: "soon" })).toBe(false);
    expect(roleDraftValid({ ...ok, companyName: " " })).toBe(false);
  });
  it("formats ranges with words, not dashes", () => {
    expect(formatRange("2020-01", null)).toBe("Jan 2020 to Present");
    expect(formatRange("2016-03", "2019-12")).toBe("Mar 2016 to Dec 2019");
  });
});

describe("fact bank form", () => {
  it("accepts the metric values the API accepts and rejects the rest", () => {
    for (const v of ["40", "1.2", "2M", "$2M", "1,200", "12 users", " 40% "]) expect(metricLooksValid(v)).toBe(true);
    for (const v of ["", "abc", "4-5", "40%%", "%"]) expect(metricLooksValid(v)).toBe(false);
  });
  it("needs a claim, and a number for metrics only", () => {
    const base = { kind: "metric" as const, claimText: "Cut churn by 40%", metricValue: "40", metricUnit: "%", context: "", employer: "" };
    expect(factDraftValid(base)).toBe(true);
    expect(factDraftValid({ ...base, metricValue: "" })).toBe(false);
    expect(factDraftValid({ ...base, claimText: "  " })).toBe(false);
    expect(factDraftValid({ ...base, kind: "skill" as never, metricValue: "" })).toBe(true);
  });
});
