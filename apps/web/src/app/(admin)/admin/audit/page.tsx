"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, Skeleton } from "@/components/ui";
import type { AuditEntry } from "@/lib/types";
import { format } from "date-fns";

export default function AdminAuditPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "audit"],
    queryFn: () => api.get<{ items: AuditEntry[] }>("/api/admin/audit?limit=200"),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="mt-1 text-sm text-fg-2">Admin actions across the system.</p>
      </header>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-bg-2 text-left text-xs uppercase tracking-wide text-fg-2">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data?.items.map((e) => (
                <tr key={e.id} className="hover:bg-bg-3/40">
                  <td className="px-4 py-3 text-xs text-fg-2">
                    {format(new Date(e.createdAt), "MMM d, HH:mm:ss")}
                  </td>
                  <td className="px-4 py-3">{e.actor}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gold-2">{e.action}</td>
                  <td className="px-4 py-3 text-fg-2">{e.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
