"use client";

// The fact bank: claims a résumé may repeat. In strict mode every number in a
// generated résumé must match a VERIFIED fact (rule check FACTS), so this is where
// metrics come from. GET/POST /profiles/:id/facts, POST .../verify, .../import-from-base,
// PATCH and DELETE /facts/:id.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, Input, Spinner } from "@/components/ui";
import { metricLooksValid } from "@/lib/forms";
import { errMsg } from "@/lib/run-status";
import { FACT_KINDS, type CreateFactInput, type FactEntry, type FactKind, type ProfileDetail } from "@/lib/types";

const EMPTY = { kind: "metric" as FactKind, claimText: "", metricValue: "", metricUnit: "", context: "", employer: "" };

/** What the add form needs to be valid; a metric must have a numeric value. */
export function factDraftValid(d: typeof EMPTY): boolean {
  if (!d.claimText.trim()) return false;
  return d.kind !== "metric" || metricLooksValid(d.metricValue);
}

export function FactsEditor({ profile }: { profile: ProfileDetail }) {
  const qc = useQueryClient();
  const key = ["facts", profile.id];
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.get<FactEntry[]>(`/profiles/${profile.id}/facts`),
  });

  const [draft, setDraft] = useState(EMPTY);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "unverified">("all");
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));

  const add = useMutation({
    mutationFn: () => {
      const body: CreateFactInput = {
        kind: draft.kind,
        claimText: draft.claimText.trim(),
        context: draft.context.trim(),
        ...(draft.metricValue.trim() ? { metricValue: draft.metricValue.trim() } : {}),
        ...(draft.metricUnit.trim() ? { metricUnit: draft.metricUnit.trim() } : {}),
        ...(draft.employer.trim() ? { employer: draft.employer.trim() } : {}),
        verified: true, // typed in by the owner, so it is their own confirmed fact
      };
      return api.post<FactEntry>(`/profiles/${profile.id}/facts`, body);
    },
    onSuccess: () => { setDraft(EMPTY); void refresh(); },
  });

  const verify = useMutation({
    mutationFn: (ids: string[]) => api.post(`/profiles/${profile.id}/facts/verify`, { factIds: ids }),
    onSuccess: () => { setPicked(new Set()); void refresh(); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/facts/${id}`),
    onSuccess: () => void refresh(),
  });

  const activeBase = profile.bases.find((b) => b.isActive);
  const importFacts = useMutation({
    mutationFn: () => api.post<{ created: number; truncated: number }>(
      `/profiles/${profile.id}/facts/import-from-base`, { baseResumeId: activeBase?.id },
    ),
    onSuccess: () => void refresh(),
  });

  const all = data ?? [];
  const rows = filter === "unverified" ? all.filter((f) => !f.verified) : all;
  const toggle = (id: string) =>
    setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <Card className="space-y-4 p-6">
      <div>
        <h2 className="text-sm font-medium">Fact bank</h2>
        <p className="mt-1 text-xs text-fg-2">
          Claims your résumés may repeat. With strict facts mode on, a number in a résumé must match a
          verified fact, so add the metrics you want to be able to use. Without any, résumés are written without numbers.
        </p>
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-bg-2 p-4">
        <div className="grid gap-2 sm:grid-cols-[110px_1fr]">
          <select className="input" value={draft.kind} onChange={set("kind")} aria-label="Kind">
            {FACT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <Input placeholder='The claim, e.g. "Cut churn by 40%"' value={draft.claimText} onChange={set("claimText")} />
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          <Input placeholder={draft.kind === "metric" ? "Number, e.g. 40" : "Number (metrics only)"} value={draft.metricValue} onChange={set("metricValue")} />
          <Input placeholder="Unit, e.g. %" value={draft.metricUnit} onChange={set("metricUnit")} />
          <Input placeholder="Employer (optional)" value={draft.employer} onChange={set("employer")} />
          <Input placeholder="Context, e.g. Platform team, 2023" value={draft.context} onChange={set("context")} />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-danger">
            {add.isError ? errMsg(add.error) : draft.kind === "metric" && draft.metricValue && !metricLooksValid(draft.metricValue)
              ? "A metric needs a number such as 40, 1.2 or 2M." : ""}
          </p>
          <Button loading={add.isPending} disabled={!factDraftValid(draft)} onClick={() => add.mutate()}>Add verified fact</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg border border-border bg-bg-2 p-1 text-xs">
          {(["all", "unverified"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={"rounded-md px-3 py-1 capitalize " + (filter === f ? "bg-bg-3 text-fg" : "text-fg-2 hover:text-fg")}>
              {f}{f === "unverified" ? ` (${all.filter((x) => !x.verified).length})` : ` (${all.length})`}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={picked.size === 0} loading={verify.isPending}
            onClick={() => verify.mutate([...picked])}>
            <CheckCheck size={14} /> Verify selected ({picked.size})
          </Button>
          <Button variant="outline" disabled={!activeBase} loading={importFacts.isPending}
            title={activeBase ? "Propose facts from the numbers in your base résumé" : "Upload a base résumé first"}
            onClick={() => importFacts.mutate()}>
            <Download size={14} /> Import from base résumé
          </Button>
        </div>
      </div>
      {importFacts.isSuccess && (
        <p className="text-xs text-fg-2">
          Added {importFacts.data.created} proposed facts, all unverified. Review them, then verify the ones that are true.
          {importFacts.data.truncated > 0 ? ` ${importFacts.data.truncated} more were not added (limit 200).` : ""}
        </p>
      )}
      {(importFacts.isError || verify.isError || remove.isError) && (
        <p className="text-xs text-danger">{errMsg(importFacts.error ?? verify.error ?? remove.error)}</p>
      )}

      {isLoading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-fg-2">No facts yet.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {rows.map((f) => (
            <li key={f.id} className="flex items-start gap-3 py-2">
              <input type="checkbox" aria-label="Select" className="mt-1" disabled={f.verified}
                checked={picked.has(f.id)} onChange={() => toggle(f.id)} />
              <div className="min-w-0 flex-1">
                <div className="truncate">{f.claimText}</div>
                <div className="mt-0.5 text-xs text-fg-2">
                  {f.kind}
                  {f.metricValue ? ` · ${f.metricValue}${f.metricUnit ?? ""}` : ""}
                  {f.employer ? ` · ${f.employer}` : ""}
                  {f.sourceNote ? ` · ${f.sourceNote}` : ""}
                </div>
              </div>
              <Badge tone={f.verified ? "ok" : "warn"}>{f.verified ? "Verified" : "Unverified"}</Badge>
              <Button variant="ghost" title="Delete" onClick={() => remove.mutate(f.id)}><Trash2 size={14} /></Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
