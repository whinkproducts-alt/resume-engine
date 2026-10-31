"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { Badge, Card, Skeleton } from "@/components/ui";
import type { Run } from "@/lib/types";
import { format } from "date-fns";

export default function AdminRunsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "runs"],
    queryFn: () => api.get<{ items: Run[] }>("/api/admin/runs"),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Global runs</h1>
        <p className="mt-1 text-sm text-fg-2">All runs across the tenant.</p>
      </header>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-bg-2 text-left text-xs uppercase tracking-wide text-fg-2">
              <tr>
                <th className="px-4 py-3">Run</th>
                <th className="px-4 py-3">Profile</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data?.items.map((r) => (
                <tr key={r.id} className="hover:bg-bg-3/40">
                  <td className="px-4 py-3 font-mono text-xs text-gold-2">
                    <Link href={`/runs/${r.id}`}>{r.id.slice(0, 8)}</Link>
                  </td>
                  <td className="px-4 py-3">{r.profileName}</td>
                  <td className="px-4 py-3">
                    <Badge tone={r.status === "failed" ? "fail" : r.status === "completed" ? "ok" : "idle"}>
                      {r.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-fg-2">
                    {format(new Date(r.createdAt), "MMM d, HH:mm")}
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
