"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button, Card, Spinner } from "@/components/ui";
import type { Settings } from "@/lib/types";
import { useAuth } from "@/lib/auth";

/* Authoritative toggles — R-rules are mapped to explicit switches. */
const TOGGLES: { key: string; label: string; hint: string }[] = [
  { key: "r2_title_close_variant",  label: "R2 · Title close-variant match", hint: "70% token overlap, ignores stop words." },
  { key: "r9_llm_judged",           label: "R9 · LLM-judged flags",          hint: "Records `warn`, non-blocking." },
  { key: "r10_duplicate_verb",      label: "R10 · Duplicate verb",           hint: "Per-résumé warning, non-blocking." },
  { key: "r18_filename_regex",      label: "R18 · Strict filename regex",    hint: "Enforces First_Last_Role.docx pattern." },
  { key: "evidence_required",       label: "Evidence required",              hint: "Every bullet needs JD or profile evidence." },
  { key: "header_lock",             label: "Header lock",                    hint: "Never mutate profile header block." },
  { key: "company_confirmation",    label: "Company confirmation",           hint: "Ask user to confirm inferred company." },
  { key: "keyword_density_check",   label: "Keyword density check",          hint: "Warn on JD keyword stuffing." },
  { key: "date_normalization",      label: "Date normalization",             hint: "Enforce ISO dates in sections." },
  { key: "section_order_check",     label: "Section order check",            hint: "Warn on non-standard section order." },
];

export default function SettingsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<Settings>("/api/settings"),
  });

  const save = useMutation({
    mutationFn: (next: Settings) => api.patch<Settings>("/api/settings", next),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  if (isLoading || !data) return <Spinner />;

  const toggle = (key: string) =>
    save.mutate({
      ...data,
      accuracyToggles: { ...data.accuracyToggles, [key]: !data.accuracyToggles[key] },
    });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-fg-2">Accuracy toggles, theme, and account.</p>
      </header>

      <Card className="p-6">
        <h2 className="mb-4 text-sm font-semibold text-fg">Accuracy</h2>
        <div className="space-y-3">
          {TOGGLES.map((t) => {
            const on = !!data.accuracyToggles[t.key];
            return (
              <div key={t.key} className="flex items-start justify-between gap-4 rounded-lg border border-border bg-bg-2 p-4">
                <div>
                  <div className="text-sm text-fg">{t.label}</div>
                  <div className="mt-0.5 text-xs text-fg-2">{t.hint}</div>
                </div>
                <button
                  onClick={() => toggle(t.key)}
                  aria-pressed={on}
                  className={
                    "relative h-6 w-11 shrink-0 rounded-full border transition-colors " +
                    (on ? "border-gold bg-gold/30" : "border-border bg-bg-3")
                  }
                >
                  <span
                    className={
                      "absolute top-0.5 h-4 w-4 rounded-full transition-transform " +
                      (on ? "left-6 bg-gold-2" : "left-0.5 bg-fg-2")
                    }
                  />
                </button>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-4 text-sm font-semibold text-fg">Theme</h2>
        <div className="rounded-lg border border-border bg-bg-2 p-4 text-sm text-fg-2">
          Dark theme (locked for Phase 1).
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-4 text-sm font-semibold text-fg">Account</h2>
        <div className="space-y-1 text-sm">
          <div><span className="text-fg-2">Name: </span>{user?.name}</div>
          <div><span className="text-fg-2">Email: </span>{user?.email}</div>
          <div><span className="text-fg-2">Role: </span>{user?.role}</div>
          <div><span className="text-fg-2">2FA: </span>{user?.twoFactorEnabled ? "enabled" : "disabled"}</div>
        </div>
      </Card>
    </div>
  );
}
