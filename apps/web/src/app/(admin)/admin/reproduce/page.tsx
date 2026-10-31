"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Input } from "@/components/ui";
import type { Run } from "@/lib/types";

export default function AdminReproducePage() {
  const [runId, setRunId] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");

  const { data: original } = useQuery({
    queryKey: ["admin", "run", runId],
    queryFn: () => api.get<Run>(`/api/admin/runs/${runId}`),
    enabled: runId.length > 0,
  });

  const reproduce = useMutation({
    mutationFn: () =>
      api.post<Run>(
        `/api/admin/runs/${runId}/reproduce`,
        {},
        { extraHeaders: { "X-Bootstrap-Token": bootstrapToken } }
      ),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Reproduce run</h1>
        <p className="mt-1 text-sm text-fg-2">
          Re-execute a run with pinned model and ruleset versions.
        </p>
      </header>

      <Card className="space-y-4 p-6">
        <div>
          <label className="mb-2 block text-xs uppercase tracking-wide text-fg-2">Run ID</label>
          <Input value={runId} onChange={(e) => setRunId(e.target.value)} placeholder="run_…" />
        </div>

        <div>
          <label className="mb-2 block text-xs uppercase tracking-wide text-fg-2">
            Bootstrap token (X-Bootstrap-Token)
          </label>
          <Input
            type="password"
            value={bootstrapToken}
            onChange={(e) => setBootstrapToken(e.target.value)}
            placeholder="bootstrap token"
          />
        </div>

        {original && (
          <div className="rounded-lg bg-bg-2 p-4 text-sm text-fg-2">
            <div><span className="text-fg-2">Profile: </span>{original.profileName}</div>
            <div><span className="text-fg-2">Status: </span>{original.status}</div>
            <div><span className="text-fg-2">Created: </span>{original.createdAt}</div>
          </div>
        )}

        <Button
          disabled={!runId || !bootstrapToken}
          loading={reproduce.isPending}
          onClick={() => reproduce.mutate()}
        >
          Reproduce with pinned versions
        </Button>

        {reproduce.data && (
          <p className="text-sm text-success">New run created: {reproduce.data.id}</p>
        )}
        {reproduce.isError && (
          <p className="text-sm text-danger">{(reproduce.error as Error).message}</p>
        )}
      </Card>
    </div>
  );
}
