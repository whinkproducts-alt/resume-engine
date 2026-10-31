"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { clsx } from "clsx";
import { api } from "@/lib/api";
import { Button, Card, Input } from "@/components/ui";
import { errMsg } from "@/lib/run-status";
import type { JdCreated, Profile, RunCreated } from "@/lib/types";

type Tab = "paste" | "file" | "url";

/** The backend rejects job descriptions under 200 characters (JD_UNUSABLE). */
const MIN_JD_CHARS = 200;

export default function NewRunPage() {
  const router = useRouter();
  const { data: profiles } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => api.get<Profile[]>("/profiles"),
  });

  const [profileId, setProfileId] = useState("");
  const [tab, setTab] = useState<Tab>("paste");
  const [jdText, setJdText] = useState("");
  const [jdUrl, setJdUrl] = useState("");
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [location, setLocation] = useState("");

  // Two calls, as in the API contract: store the job description, then start a run on it.
  const create = useMutation({
    mutationFn: async () => {
      let jd: JdCreated;
      if (tab === "file" && jdFile) {
        const fd = new FormData();
        fd.append("profileId", profileId);
        fd.append("file", jdFile);
        jd = await api.post<JdCreated>("/jds", fd);
      } else if (tab === "url") {
        jd = await api.post<JdCreated>("/jds", { profileId, sourceType: "url", sourceUrl: jdUrl.trim() });
      } else {
        jd = await api.post<JdCreated>("/jds", { profileId, sourceType: "paste", rawText: jdText });
      }
      return api.post<RunCreated>("/runs", {
        profileId,
        jdId: jd.id,
        ...(location.trim() ? { contactLocationOverride: location.trim() } : {}),
      });
    },
    onSuccess: (run) => router.push(`/runs/${run.runId}`),
  });

  const selected = profiles?.find((p) => p.id === profileId);
  const canSubmit =
    !!profileId &&
    !!selected?.activeBaseId &&
    ((tab === "paste" && jdText.trim().length >= MIN_JD_CHARS) ||
      (tab === "url" && /^https?:\/\//.test(jdUrl.trim())) ||
      (tab === "file" && !!jdFile));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">New run</h1>
        <p className="mt-1 text-sm text-fg-2">Pick a profile, add the job description, and generate.</p>
      </header>

      <Card className="space-y-6 p-6">
        <div>
          <label className="mb-2 block text-xs uppercase tracking-wide text-fg-2">Profile</label>
          <select value={profileId} onChange={(e) => setProfileId(e.target.value)} className="input">
            <option value="">Select a profile…</option>
            {profiles?.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {selected && !selected.activeBaseId && (
            <p className="mt-2 text-xs text-gold-2">This profile has no base résumé yet. Upload one on the profile page.</p>
          )}
        </div>

        <div>
          <div className="mb-3 flex gap-1 rounded-lg border border-border bg-bg-2 p-1 text-sm">
            {(["paste", "file", "url"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={clsx(
                  "flex-1 rounded-md px-3 py-1.5 capitalize transition-colors",
                  tab === t ? "bg-bg-3 text-fg" : "text-fg-2 hover:text-fg",
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "paste" && (
            <>
              <textarea
                className="input min-h-[220px] resize-y font-mono text-[13px]"
                placeholder="Paste the job description here…"
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
              />
              <p className="mt-1 text-xs text-fg-2">
                {jdText.trim().length} / {MIN_JD_CHARS} characters minimum
              </p>
            </>
          )}

          {tab === "file" && (
            <div className="rounded-xl border border-dashed border-border bg-bg-2 p-6 text-center">
              <input
                type="file"
                accept=".docx,.txt"
                onChange={(e) => setJdFile(e.target.files?.[0] ?? null)}
                className="mx-auto block text-sm text-fg-2"
              />
              {jdFile && <p className="mt-2 text-xs text-gold-2">{jdFile.name}</p>}
            </div>
          )}

          {tab === "url" && (
            <Input placeholder="https://…" value={jdUrl} onChange={(e) => setJdUrl(e.target.value)} />
          )}
        </div>

        <div>
          <label className="mb-2 block text-xs uppercase tracking-wide text-fg-2">
            Contact location override (optional)
          </label>
          <Input
            placeholder={selected ? `Default: ${selected.headerCity}` : "City, Country"}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-danger">{create.isError ? errMsg(create.error) : ""}</p>
          <Button variant="primary" disabled={!canSubmit} loading={create.isPending} onClick={() => create.mutate()}>
            Generate
          </Button>
        </div>
      </Card>
    </div>
  );
}
