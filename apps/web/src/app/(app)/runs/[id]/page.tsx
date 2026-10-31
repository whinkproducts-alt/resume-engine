"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { api, subscribeRunProgress } from "@/lib/api";
import { Badge, Card, Spinner } from "@/components/ui";
import type { Run } from "@/lib/types";

const STAGES = [
  "Ingest JD",
  "Parse profile",
  "Draft sections",
  "Validate",
  "Render",
];

export default function RunProgressPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { data: run } = useQuery({
    queryKey: ["run", id],
    queryFn: () => api.get<Run>(`/api/runs/${id}`),
    refetchOnMount: "always",
  });

  const [status, setStatus] = useState<Run["status"]>("queued");
  const [stage, setStage] = useState("");

  useEffect(() => {
    if (!id) return;
    const stop = subscribeRunProgress(id, (evt) => {
      setStatus(evt.status);
      setStage(evt.stage);
      if (evt.status === "review") router.replace(`/runs/${id}/review`);
      if (evt.status === "failed") router.replace(`/runs/${id}`);
    });
    return () => stop();
  }, [id, router]);

  const activeIdx = Math.max(0, STAGES.findIndex((s) => stage.toLowerCase().includes(s.toLowerCase())));

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Run {id.slice(0, 8)}</h1>
          <p className="mt-1 text-sm text-fg-2">
            {run?.profileName ? `Profile: ${run.profileName}` : "Generating your résumé…"}
          </p>
        </div>
        <Badge tone={status === "failed" ? "fail" : status === "review" ? "ok" : "idle"}>
          {status}
        </Badge>
      </header>

      <Card className="space-y-4 p-6">
        {STAGES.map((label, i) => {
          const done = i < activeIdx || status === "review";
          const active = i === activeIdx && status !== "review";
          return (
            <div key={label} className="flex items-center gap-3 text-sm">
              <div
                className={
                  "flex h-6 w-6 items-center justify-center rounded-full border text-[11px] " +
                  (done
                    ? "border-success/40 bg-success/10 text-success"
                    : active
                    ? "border-gold/40 bg-gold/10 text-gold-2"
                    : "border-border bg-bg-3 text-fg-2")
                }
              >
                {done ? "✓" : i + 1}
              </div>
              <span className={done ? "text-fg" : active ? "text-gold-2" : "text-fg-2"}>
                {label}
              </span>
              {active && <Spinner className="ml-auto" />}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
