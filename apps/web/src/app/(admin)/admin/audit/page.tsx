"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { api } from "@/lib/api";
import { Card, Skeleton } from "@/components/ui";
import type { AuditEntry, Paged } from "@/lib/types";

export default function AdminAuditPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "audit"],
    queryFn: () => api.get<Paged<AuditEntry>>("/admin/audit?limit=100"),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="mt-1 text-sm text-fg-2">Admin sign ins, two factor changes and reproductions.</p>
      </header>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : data?.items.length === 0 ? (
          <div className="p-8 text-center text-sm text-fg-2">Nothing recorded yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-bg-2 text-left text-xs uppercase tracking-wide text-fg-2">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data?.items.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3 text-xs text-fg-2">{format(new Date(a.createdAt), "MMM d, yyyy HH:mm:ss")}</td>
                  <td className="px-4 py-3">{a.actor}</td>
                  <td className="px-4 py-3 font-mono text-xs">{a.action}</td>
                  <td className="px-4 py-3 text-fg-2">{a.target ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-fg-2">{a.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
