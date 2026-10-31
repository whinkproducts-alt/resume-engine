"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Badge, Card, Spinner } from "@/components/ui";
import { displayName, useAuth } from "@/lib/auth";
import { errMsg } from "@/lib/run-status";
import type { SettingKey, Settings } from "@/lib/types";

/**
 * The ten UserSettings toggles. `applied` marks the ones the pipeline reads today;
 * the others are stored in each run's settings snapshot but do not change behaviour yet.
 */
const TOGGLES: { key: SettingKey; label: string; hint: string; applied: boolean }[] = [
  { key: "strictFactsMode", label: "Strict facts mode", applied: true,
    hint: "Every number must match a verified Fact Bank entry. Unmatched numbers block the run." },
  { key: "banHyphensInProse", label: "Ban hyphens in prose", applied: true,
    hint: "Rule R20: hyphens in written prose fail validation. Em and en dashes always do." },
  { key: "whinkGroupFraming", label: "WHINK Group framing", applied: true,
    hint: "Rule R17: allow past employer projects to be presented as completed under WHINK Group." },
  { key: "flagAndInclude", label: "Flag and include", applied: false, hint: "" },
  { key: "lockCompanyNames", label: "Lock company names", applied: false,
    hint: "Company names are always locked by rule R7 today." },
  { key: "lockEmploymentDates", label: "Lock employment dates", applied: false,
    hint: "Employment dates are always locked by rule R7 today." },
  { key: "blockOnUnusableJD", label: "Block on unusable job description", applied: false,
    hint: "Job descriptions under 200 characters are always rejected today." },
  { key: "inferCompanyName", label: "Infer company name", applied: false, hint: "" },
  { key: "consultingFraming", label: "Consulting framing", applied: false, hint: "" },
  { key: "heritageLineDefault", label: "Heritage line by default", applied: false, hint: "" },
];

export default function SettingsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<Settings>("/settings"),
  });

  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => api.put<Settings>("/settings", patch),
    onSuccess: (next) => qc.setQueryData(["settings"], next),
  });

  if (isLoading || !data) {
    return <div className="flex h-64 items-center justify-center"><Spinner /></div>;
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-fg-2">Accuracy toggles and your account.</p>
      </header>

      <Card className="divide-y divide-border">
        {TOGGLES.map((t) => {
          const on = data[t.key];
          return (
            <div key={t.key} className="flex items-center justify-between gap-4 p-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  {t.label}
                  {!t.applied && <Badge tone="idle">Saved, not applied yet</Badge>}
                </div>
                {t.hint && <div className="mt-0.5 text-xs text-fg-2">{t.hint}</div>}
              </div>
              <button
                role="switch"
                aria-checked={on}
                aria-label={t.label}
                disabled={save.isPending}
                onClick={() => save.mutate({ [t.key]: !on })}
                className={
                  "relative h-6 w-11 shrink-0 rounded-full border transition-colors " +
                  (on ? "border-gold/50 bg-gold/80" : "border-border bg-bg-3")
                }
              >
                <span
                  className={
                    "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all " +
                    (on ? "left-[22px]" : "left-0.5")
                  }
                />
              </button>
            </div>
          );
        })}
      </Card>
      {save.isError && <p className="text-sm text-danger">{errMsg(save.error)}</p>}

      <Card className="space-y-1 p-5 text-sm">
        <div className="font-medium">Account</div>
        <div className="text-fg-2">{displayName(user)} · {user?.email}</div>
        <div className="text-xs text-fg-2">Plan: {user?.role}. Dark theme only for now.</div>
      </Card>
    </div>
  );
}
