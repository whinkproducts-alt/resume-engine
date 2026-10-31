"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Download, Copy } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Card, Input, Skeleton } from "@/components/ui";
import type { HistoryRow } from "@/lib/types";
import { format } from "date-fns";

export default function HistoryPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["history", q, status],
    queryFn: () =>
      api.get<{ items: HistoryRow[] }>(
        `/api/runs?${new URLSearchParams({ ...(q && { q }), ...(status && { status }) })}`
      ),
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => api.post<{ id: string }>(`/api/runs/${id}/duplicate`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["history"] }),
  });

  const rows = data?.items ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">History</h1>
        <p className="mt-1 text-sm text-fg-2">All tailoring runs, filterable and re-runnable.</p>
      </header>

      <Card className="flex flex-wrap gap-2 p-3">
        <Input
          placeholder="Search by profile or company…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <select className="input max-w-[180px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="review">Review</option>
          <option value="failed">Failed</option>
        </select>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
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
                  <td className="px-4 py-3">{r.profileName}</td>
                  <td className="px-4 py-3 text-fg-2">{r.company || "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={r.status === "failed" ? "fail" : r.status === "review" ? "ok" : "idle"}>
                      {r.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-fg-2">
                    {format(new Date(r.createdAt), "MMM d, yyyy HH:mm")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <a href={r.downloadUrl} download>
                        <Button variant="ghost"><Download size={14} /></Button>
                      </a>
                      <Button variant="ghost" onClick={() => duplicate.mutate(r.id)}>
                        <Copy size={14} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
