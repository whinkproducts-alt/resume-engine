"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Badge, Card, Skeleton } from "@/components/ui";

interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
  runsThisMonth: number;
  runsLimit: number;
}

export default function AdminUsersPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.get<{ items: AdminUserRow[] }>("/api/admin/users"),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="mt-1 text-sm text-fg-2">Roles and monthly usage.</p>
      </header>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-bg-2 text-left text-xs uppercase tracking-wide text-fg-2">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Runs (month)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data?.items.map((u) => (
                <tr key={u.id} className="hover:bg-bg-3/40">
                  <td className="px-4 py-3">{u.name}</td>
                  <td className="px-4 py-3 text-fg-2">{u.email}</td>
                  <td className="px-4 py-3">
                    <Badge tone={u.role === "owner" ? "ok" : u.role === "admin" ? "warn" : "idle"}>
                      {u.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-fg-2">{u.runsThisMonth} / {u.runsLimit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
