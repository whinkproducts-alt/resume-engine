"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { Card, EmptyState, Button, Skeleton, Badge } from "@/components/ui";
import type { Run } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["runs", "recent"],
    queryFn: () => api.get<{ items: Run[] }>("/api/runs?limit=5"),
  });

  const runs = data?.items ?? [];

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-fg-2">Your recent tailoring runs.</p>
        </div>
        <Link href="/new"><Button>New run</Button></Link>
      </header>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : runs.length === 0 ? (
        <EmptyState
          title="No runs yet"
          description="Start by creating a profile and generating your first tailored résumé."
          action={<Link href="/new"><Button>Create your first run</Button></Link>}
        />
      ) : (
        <div className="grid gap-3">
          {runs.map((r) => (
            <Link key={r.id} href={`/runs/${r.id}`}>
              <Card className="flex items-center justify-between p-5 transition-colors hover:bg-bg-3">
                <div>
                  <div className="font-medium">{r.profileName} — {r.companyGuess?.name ?? "—"}</div>
                  <div className="mt-1 text-xs text-fg-2">
                    {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
                  </div>
                </div>
                <Badge tone={r.status === "review" ? "ok" : r.status === "failed" ? "fail" : "idle"}>
                  {r.status}
                </Badge>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
