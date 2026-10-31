"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { UploadCloud, Lock, Unlock } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card, Input, Skeleton } from "@/components/ui";
import type { Profile } from "@/lib/types";
import { useState, useEffect } from "react";

export default function ProfileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile", id],
    queryFn: () => api.get<Profile>(`/api/profiles/${id}`),
  });

  const [name, setName] = useState("");
  useEffect(() => { if (profile) setName(profile.name); }, [profile]);

  const update = useMutation({
    mutationFn: (patch: Partial<Profile>) => api.patch<Profile>(`/api/profiles/${id}`, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["profile", id] }),
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.post<Profile>(`/api/profiles/${id}/resume`, fd);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["profile", id] }),
  });

  const onDrop = useCallback((files: File[]) => {
    if (files[0]) upload.mutate(files[0]);
  }, [upload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "application/pdf": [".pdf"],
    },
    maxFiles: 1,
  });

  if (isLoading || !profile) {
    return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-40" /></div>;
  }

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{profile.name}</h1>
          <p className="mt-1 text-sm text-fg-2">Manage base résumé and header lock.</p>
        </div>
        <Button
          variant="outline"
          onClick={() => update.mutate({ headerLocked: !profile.headerLocked })}
        >
          {profile.headerLocked ? <Lock size={14} /> : <Unlock size={14} />}
          {profile.headerLocked ? "Unlock header" : "Lock header"}
        </Button>
      </header>

      <Card className="space-y-4 p-6">
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-fg-2">Profile name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="outline" onClick={() => update.mutate({ name })}>Save</Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-3 text-sm font-medium text-fg">Base résumé</h2>
        <div
          {...getRootProps()}
          className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-bg-2 px-6 py-10 text-center transition-colors hover:border-gold/40"
        >
          <input {...getInputProps()} />
          <UploadCloud className="mb-3 text-fg-2" />
          <p className="text-sm text-fg">
            {isDragActive ? "Drop the file…" : "Drag & drop a .docx or .pdf, or click to browse"}
          </p>
          {profile.baseResumeFileName && (
            <p className="mt-2 text-xs text-fg-2">Current: {profile.baseResumeFileName}</p>
          )}
          {upload.isPending && <p className="mt-2 text-xs text-gold-2">Uploading…</p>}
        </div>
      </Card>
    </div>
  );
}
