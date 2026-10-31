"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/lib/api";
import { Badge, Button, Card, EmptyState, Skeleton } from "@/components/ui";
import { STATUS_LABEL, runHref, statusTone } from "@/lib/run-status";
import type { Paged, RunListItem } from "@/lib/types";

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["runs", "recent"],
    queryFn: () => api.get<Paged<RunListItem>>("/runs?limit=5"),
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
            <Link key={r.id} href={runHref(r)}>
              <Card className="flex items-center justify-between p-5 transition-colors hover:bg-bg-3">
                <div>
                  <div className="font-medium">
                    {r.profileName}{r.company ? ` for ${r.company}` : ""}
                  </div>
                  <div className="mt-1 text-xs text-fg-2">
                    {r.roleTitle ? `${r.roleTitle} · ` : ""}
                    {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
                  </div>
                </div>
                <Badge tone={statusTone(r.status)}>{STATUS_LABEL[r.status]}</Badge>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
