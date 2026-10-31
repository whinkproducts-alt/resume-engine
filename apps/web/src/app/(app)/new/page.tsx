"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Input } from "@/components/ui";
import type { Profile, Run } from "@/lib/types";
import { clsx } from "clsx";

type Tab = "paste" | "file" | "url";

export default function NewRunPage() {
  const router = useRouter();
  const { data: profiles } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => api.get<{ items: Profile[] }>("/api/profiles"),
  });

  const [profileId, setProfileId] = useState("");
  const [tab, setTab] = useState<Tab>("paste");
  const [jdText, setJdText] = useState("");
  const [jdUrl, setJdUrl] = useState("");
  const [jdFile, setJdFile] = useState<File | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      if (tab === "file" && jdFile) {
        const fd = new FormData();
        fd.append("profileId", profileId);
        fd.append("jdFile", jdFile);
        fd.append("jdSource", "file");
        return api.post<Run>("/api/runs", fd);
      }
      return api.post<Run>("/api/runs", {
        profileId,
        jdSource: tab,
        jd: tab === "paste" ? jdText : undefined,
        jdUrl: tab === "url" ? jdUrl : undefined,
      });
    },
    onSuccess: (run) => router.push(`/runs/${run.id}`),
  });

  const canSubmit =
    !!profileId &&
    ((tab === "paste" && jdText.trim().length > 40) ||
      (tab === "url" && /^https?:\/\//.test(jdUrl)) ||
      (tab === "file" && !!jdFile));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">New run</h1>
        <p className="mt-1 text-sm text-fg-2">Pick a profile, paste the JD, and generate.</p>
      </header>

      <Card className="space-y-6 p-6">
        <div>
          <label className="mb-2 block text-xs uppercase tracking-wide text-fg-2">Profile</label>
          <select
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            className="input"
          >
            <option value="">Select a profile…</option>
            {profiles?.items.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div>
          <div className="mb-3 flex gap-1 rounded-lg border border-border bg-bg-2 p-1 text-sm">
            {(["paste", "file", "url"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={clsx(
                  "flex-1 rounded-md px-3 py-1.5 capitalize transition-colors",
                  tab === t ? "bg-bg-3 text-fg" : "text-fg-2 hover:text-fg"
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "paste" && (
            <textarea
              className="input min-h-[220px] resize-y font-mono text-[13px]"
              placeholder="Paste the job description here…"
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
            />
          )}

          {tab === "file" && (
            <div className="rounded-xl border border-dashed border-border bg-bg-2 p-6 text-center">
              <input
                type="file"
                accept=".pdf,.docx,.txt"
                onChange={(e) => setJdFile(e.target.files?.[0] ?? null)}
                className="mx-auto block text-sm text-fg-2"
              />
              {jdFile && <p className="mt-2 text-xs text-gold-2">{jdFile.name}</p>}
            </div>
          )}

          {tab === "url" && (
            <Input
              placeholder="https://…"
              value={jdUrl}
              onChange={(e) => setJdUrl(e.target.value)}
            />
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="primary"
            disabled={!canSubmit}
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            Generate
          </Button>
        </div>

        {create.isError && (
          <p className="text-sm text-danger">{(create.error as Error).message}</p>
        )}
      </Card>
    </div>
  );
}
