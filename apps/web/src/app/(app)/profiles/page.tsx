"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, EmptyState, Input, Skeleton } from "@/components/ui";
import type { Profile } from "@/lib/types";

export default function ProfilesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => api.get<{ items: Profile[] }>("/api/profiles"),
  });

  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => api.post<Profile>("/api/profiles", { name }),
    onSuccess: () => {
      setName("");
      void qc.invalidateQueries({ queryKey: ["profiles"] });
    },
  });

  const items = data?.items ?? [];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Profiles</h1>
        <p className="mt-1 text-sm text-fg-2">Each profile holds one base résumé and a locked header.</p>
      </header>

      <Card className="flex gap-2 p-4">
        <Input
          placeholder="New profile name (e.g. Senior Backend — 2025)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button loading={create.isPending} onClick={() => name.trim() && create.mutate()}>
          Create
        </Button>
      </Card>

      {isLoading ? (
        <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      ) : items.length === 0 ? (
        <EmptyState title="No profiles" description="Create a profile to upload your base résumé." />
      ) : (
        <div className="grid gap-3">
          {items.map((p) => (
            <Link key={p.id} href={`/profiles/${p.id}`}>
              <Card className="flex items-center justify-between p-5 hover:bg-bg-3">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="mt-1 text-xs text-fg-2">
                    {p.baseResumeFileName ?? "No base résumé uploaded"}
                  </div>
                </div>
                <span className="text-xs text-fg-2">{p.headerLocked ? "Header locked" : "Header unlocked"}</span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
