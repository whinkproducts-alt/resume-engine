"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Badge, Card, Skeleton } from "@/components/ui";
import type { AdminUserRow, Paged } from "@/lib/types";

export default function AdminUsersPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.get<Paged<AdminUserRow>>("/admin/users?limit=100"),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="mt-1 text-sm text-fg-2">Accounts, plans and usage this month.</p>
      </header>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-bg-2 text-left text-xs uppercase tracking-wide text-fg-2">
              <tr>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Runs this month</th>
                <th className="px-4 py-3">2FA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data?.items.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3">
                    <div>{u.name ?? u.email}</div>
                    {u.name && <div className="text-xs text-fg-2">{u.email}</div>}
                  </td>
                  <td className="px-4 py-3"><Badge tone={u.isAdmin ? "warn" : "idle"}>{u.role}</Badge></td>
                  <td className="px-4 py-3 tabular-nums">
                    {u.runsThisMonth}{u.runsLimit !== null ? ` / ${u.runsLimit}` : ""}
                  </td>
                  <td className="px-4 py-3">
                    {u.isAdmin ? <Badge tone={u.totpEnabled ? "ok" : "warn"}>{u.totpEnabled ? "On" : "Off"}</Badge> : "—"}
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
