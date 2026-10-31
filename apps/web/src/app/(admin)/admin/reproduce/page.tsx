"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, Input } from "@/components/ui";
import { STATUS_LABEL, errMsg, statusTone } from "@/lib/run-status";
import type { AdminRunDetail } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ReproduceInner() {
  const params = useSearchParams();
  const [runId, setRunId] = useState(params.get("run") ?? "");
  const valid = UUID.test(runId.trim());

  const { data, isError, error } = useQuery({
    queryKey: ["admin", "run", runId.trim()],
    queryFn: () => api.get<AdminRunDetail>(`/admin/runs/${runId.trim()}`),
    enabled: valid,
    retry: false,
  });

  const reproduce = useMutation({
    mutationFn: () => api.post<{ runId: string; status: string }>(`/admin/runs/${runId.trim()}/reproduce`),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Reproduce run</h1>
        <p className="mt-1 text-sm text-fg-2">
          Re-execute a run with its pinned rule set, prompt version, base résumé and settings.
          The new run belongs to you; the original is not touched.
        </p>
      </header>

      <Card className="space-y-4 p-6">
        <div>
          <label className="mb-2 block text-xs uppercase tracking-wide text-fg-2">Run ID</label>
          <Input value={runId} onChange={(e) => setRunId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
          {isError && <p className="mt-2 text-xs text-danger">{errMsg(error)}</p>}
        </div>

        {data && (
          <div className="space-y-3 rounded-lg bg-bg-2 p-4 text-sm">
            <div className="flex items-center gap-2">
              <Badge tone={statusTone(data.run.status)}>{STATUS_LABEL[data.run.status]}</Badge>
              <span className="text-fg-2">{data.run.planTier} plan · {data.logs.length} log steps · {data.flags.length} flags</span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-fg-2">Rule set</dt><dd>{data.versions.ruleSet}</dd>
              <dt className="text-fg-2">Prompts</dt><dd>{data.versions.promptVersion}</dd>
              <dt className="text-fg-2">Base résumé</dt><dd>v{data.versions.baseResume ?? "?"}</dd>
              <dt className="text-fg-2">Models</dt><dd>{data.versions.models.join(", ") || "—"}</dd>
            </dl>
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-sm text-danger">{reproduce.isError ? errMsg(reproduce.error) : ""}</p>
          <Button loading={reproduce.isPending} disabled={!data} onClick={() => reproduce.mutate()}>Reproduce</Button>
        </div>

        {reproduce.data && (
          <p className="text-sm text-success">
            Started run{" "}
            <Link className="underline" href={`/runs/${reproduce.data.runId}`}>{reproduce.data.runId.slice(0, 8)}</Link>.
          </p>
        )}
      </Card>
    </div>
  );
}

export default function ReproducePage() {
  return (
    <Suspense fallback={null}>
      <ReproduceInner />
    </Suspense>
  );
}
