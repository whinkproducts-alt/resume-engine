"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/lib/api";
import { Badge, Card, Skeleton } from "@/components/ui";
import { STATUS_LABEL, statusTone } from "@/lib/run-status";
import type { AdminRunRow, Paged } from "@/lib/types";

export default function AdminRunsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "runs"],
    queryFn: () => api.get<Paged<AdminRunRow>>("/admin/runs?limit=100"),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
        <p className="mt-1 text-sm text-fg-2">Every run across all users.</p>
      </header>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-bg-2 text-left text-xs uppercase tracking-wide text-fg-2">
              <tr>
                <th className="px-4 py-3">Run</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Tokens</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data?.items.map((r) => (
                <tr key={r.id} className="hover:bg-bg-3/40">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link className="hover:text-gold-2" href={`/admin/reproduce?run=${r.id}`}>{r.id.slice(0, 8)}</Link>
                  </td>
                  <td className="px-4 py-3 text-fg-2">{r.userEmail}</td>
                  <td className="px-4 py-3">{r.company ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(r.status)}>{STATUS_LABEL[r.status]}</Badge>
                    {r.errorCode && <span className="ml-2 text-xs text-danger">{r.errorCode}</span>}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-fg-2">{r.actualTokens ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-fg-2">
                    {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
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
