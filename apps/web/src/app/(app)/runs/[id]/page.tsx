"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { api, subscribeRunProgress } from "@/lib/api";
import { Badge, Button, Card, Spinner } from "@/components/ui";
import {
  PROGRESS_STEPS, STATUS_LABEL, activeStep, errMsg, errorText, statusTone,
} from "@/lib/run-status";
import type { RunDetail, RunProgress } from "@/lib/types";

export default function RunProgressPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data: run } = useQuery({
    queryKey: ["run", id],
    queryFn: () => api.get<RunDetail>(`/runs/${id}`),
    refetchOnMount: "always",
  });

  const [live, setLive] = useState<RunProgress | null>(null);
  const [generation, setGeneration] = useState(0); // bumped by Retry to restart the stream

  useEffect(() => {
    if (!id) return;
    const stop = subscribeRunProgress(id, (evt) => {
      setLive(evt);
      if (evt.status === "COMPLETE") router.replace(`/runs/${id}/review`);
      if (evt.status === "AWAITING_COMPANY_CONFIRM") router.replace(`/runs/${id}/confirm`);
      if (evt.status === "FAILED") void qc.invalidateQueries({ queryKey: ["run", id] });
    });
    return () => stop();
  }, [id, router, qc, generation]);

  // A run opened after it finished (or paused) goes straight to the right screen.
  useEffect(() => {
    if (run?.status === "COMPLETE") router.replace(`/runs/${id}/review`);
    if (run?.status === "AWAITING_COMPANY_CONFIRM") router.replace(`/runs/${id}/confirm`);
  }, [run?.status, id, router]);

  const status = live?.status ?? run?.status ?? "QUEUED";
  const errorCode = live?.errorCode ?? run?.errorCode ?? null;
  const pct = Math.round((live?.progress ?? run?.progress ?? 0) * 100);
  const step = activeStep(status);
  const failed = status === "FAILED";
  const cancelled = status === "CANCELLED";

  const retry = useMutation({
    mutationFn: () => api.post(`/runs/${id}/retry`),
    onSuccess: () => {
      setLive(null);
      setGeneration((g) => g + 1);
      void qc.invalidateQueries({ queryKey: ["run", id] });
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/runs/${id}/cancel`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["run", id] }),
  });

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Run {id.slice(0, 8)}</h1>
          <p className="mt-1 text-sm text-fg-2">
            {run?.roleTitle ? `Role: ${run.roleTitle}` : "Generating your résumé…"}
          </p>
        </div>
        <Badge tone={statusTone(status)}>{STATUS_LABEL[status]}</Badge>
      </header>

      <Card className="space-y-4 p-6">
        <div className="h-1.5 overflow-hidden rounded-full bg-bg-3">
          <div className="h-full bg-gold transition-all" style={{ width: `${pct}%` }} />
        </div>
        {PROGRESS_STEPS.map((s, i) => {
          const done = i < step;
          const active = i === step && !failed && !cancelled;
          return (
            <div key={s.label} className="flex items-center gap-3 text-sm">
              <div
                className={
                  "flex h-6 w-6 items-center justify-center rounded-full border text-[11px] " +
                  (done ? "border-success/40 bg-success/10 text-success"
                    : active ? "border-gold/40 bg-gold/10 text-gold-2"
                    : "border-border bg-bg-3 text-fg-2")
                }
              >
                {done ? "✓" : i + 1}
              </div>
              <span className={done ? "text-fg" : active ? "text-gold-2" : "text-fg-2"}>{s.label}</span>
              {active && <Spinner className="ml-auto" />}
            </div>
          );
        })}
        {live?.stage && !failed && <p className="text-xs text-fg-2">{live.stage}</p>}
      </Card>

      {failed && (
        <Card className="space-y-3 border-danger/40 p-6">
          <p className="text-sm text-danger">{errorText(errorCode) ?? "The run failed."}</p>
          <div className="flex items-center gap-2">
            <Button loading={retry.isPending} onClick={() => retry.mutate()}>Retry</Button>
            {errorCode === "VALIDATION_FAILED" && (
              <Button variant="outline" onClick={() => router.push(`/runs/${id}/review`)}>See what failed</Button>
            )}
            {retry.isError && <span className="text-xs text-danger">{errMsg(retry.error)}</span>}
          </div>
        </Card>
      )}

      {!failed && !cancelled && status !== "COMPLETE" && (
        <div className="flex justify-end">
          <Button variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel run</Button>
        </div>
      )}
    </div>
  );
}
