"use client";

import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Download, RotateCw } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Card, Input, Skeleton } from "@/components/ui";
import { openArtifact } from "@/lib/download";
import { STATUS_LABEL, matchesQuery, runHref, statusTone } from "@/lib/run-status";
import type { Paged, RunCreated, RunListItem, RunStatus } from "@/lib/types";

const STATUSES: RunStatus[] = ["COMPLETE", "FAILED", "AWAITING_COMPANY_CONFIRM", "CANCELLED"];

export default function HistoryPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["history", status],
    initialPageParam: "" as string,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: "20" });
      if (status) p.set("status", status);
      if (pageParam) p.set("cursor", pageParam);
      return api.get<Paged<RunListItem>>(`/runs?${p}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  // A new run on the same profile and job description (spends a run like any other).
  const again = useMutation({
    mutationFn: (r: RunListItem) => api.post<RunCreated>("/runs", { profileId: r.profileId, jdId: r.jdId }),
    onSuccess: (run) => router.push(`/runs/${run.runId}`),
  });

  const rows = useMemo(
    () => (data?.pages.flatMap((p) => p.items) ?? []).filter((r) => matchesQuery(r, q)),
    [data, q],
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">History</h1>
        <p className="mt-1 text-sm text-fg-2">All tailoring runs, filterable and re-runnable.</p>
      </header>

      <Card className="flex flex-wrap gap-2 p-3">
        <Input
          placeholder="Filter by profile, company or role…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <select className="input max-w-[220px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-fg-2">No runs match.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-bg-2 text-left text-xs uppercase tracking-wide text-fg-2">
              <tr>
                <th className="px-4 py-3">Profile</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-bg-3/40">
                  <td className="px-4 py-3">
                    <button className="text-left hover:text-gold-2" onClick={() => router.push(runHref(r))}>
                      {r.profileName}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-fg-2">{r.company || "—"}</td>
                  <td className="px-4 py-3"><Badge tone={statusTone(r.status)}>{STATUS_LABEL[r.status]}</Badge></td>
                  <td className="px-4 py-3 text-xs text-fg-2">{format(new Date(r.createdAt), "MMM d, yyyy HH:mm")}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      {r.status === "COMPLETE" && (
                        <Button variant="ghost" title="Download DOCX" onClick={() => void openArtifact(r.id, "docx")}>
                          <Download size={14} />
                        </Button>
                      )}
                      <Button variant="ghost" title="Run again" loading={again.isPending} onClick={() => again.mutate(r)}>
                        <RotateCw size={14} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>Load more</Button>
        </div>
      )}
    </div>
  );
}
