"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { UploadCloud } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Card, Input, Skeleton } from "@/components/ui";
import { RosterEditor } from "@/components/profiles/roster-editor";
import { parsePhones } from "@/lib/forms";
import { errMsg } from "@/lib/run-status";
import type { BaseSummary, Profile, ProfileDetail } from "@/lib/types";

export default function ProfileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["profile", id] });

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile", id],
    queryFn: () => api.get<ProfileDetail>(`/profiles/${id}`),
  });

  const [form, setForm] = useState({ name: "", headerFullName: "", headerCity: "", phones: "", headerEmail: "", linkedIn: "" });
  useEffect(() => {
    if (!profile) return;
    setForm({
      name: profile.name, headerFullName: profile.headerFullName, headerCity: profile.headerCity,
      phones: profile.headerPhones.join(", "), headerEmail: profile.headerEmail, linkedIn: profile.linkedIn ?? "",
    });
  }, [profile]);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => api.patch<Profile>(`/profiles/${id}`, {
      name: form.name.trim(), headerFullName: form.headerFullName.trim(), headerCity: form.headerCity.trim(),
      headerPhones: parsePhones(form.phones), headerEmail: form.headerEmail.trim(),
      linkedIn: form.linkedIn.trim() || undefined,
    }),
    onSuccess: refresh,
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.post<BaseSummary>(`/profiles/${id}/bases`, fd);
    },
    onSuccess: refresh,
  });

  const activate = useMutation({
    mutationFn: (baseId: string) => api.patch(`/profiles/${id}/bases/${baseId}/activate`),
    onSuccess: refresh,
  });

  const onDrop = useCallback((files: File[]) => {
    if (files[0]) upload.mutate(files[0]);
  }, [upload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"] },
    maxFiles: 1,
  });

  if (isLoading || !profile) {
    return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-40" /></div>;
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{profile.name}</h1>
        <p className="mt-1 text-sm text-fg-2">
          The header below is copied into every résumé exactly as written (rule R1).
        </p>
      </header>

      <Card className="space-y-3 p-6">
        <h2 className="text-sm font-medium">Header</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input placeholder="Profile name" value={form.name} onChange={set("name")} />
          <Input placeholder="Full name" value={form.headerFullName} onChange={set("headerFullName")} />
          <Input placeholder="City, Country" value={form.headerCity} onChange={set("headerCity")} />
          <Input placeholder="Phones (comma separated)" value={form.phones} onChange={set("phones")} />
          <Input type="email" placeholder="Email" value={form.headerEmail} onChange={set("headerEmail")} />
          <Input placeholder="LinkedIn" value={form.linkedIn} onChange={set("linkedIn")} />
        </div>
        <div className="flex items-center justify-between">
          <p className={"text-xs " + (save.isError ? "text-danger" : "text-success")}>
            {save.isError ? errMsg(save.error) : save.isSuccess ? "Saved" : ""}
          </p>
          <Button loading={save.isPending} onClick={() => save.mutate()}>Save header</Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-1 text-sm font-medium">Base résumé</h2>
        <p className="mb-3 text-xs text-fg-2">
          A .docx named like <span className="font-mono">First Last_Role_Company.docx</span> (three parts joined by underscores, rule R18).
        </p>
        <div
          {...getRootProps()}
          className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-bg-2 px-6 py-10 text-center transition-colors hover:border-gold/40"
        >
          <input {...getInputProps()} />
          <UploadCloud className="mb-3 text-fg-2" />
          <p className="text-sm text-fg">
            {isDragActive ? "Drop the file…" : "Drag and drop a .docx, or click to browse"}
          </p>
          {upload.isPending && <p className="mt-2 text-xs text-gold-2">Uploading…</p>}
          {upload.isError && <p className="mt-2 text-xs text-danger">{errMsg(upload.error)}</p>}
        </div>

        {profile.bases.length > 0 && (
          <ul className="mt-4 divide-y divide-border text-sm">
            {profile.bases.map((b) => (
              <li key={b.id} className="flex items-center justify-between py-2">
                <span>
                  v{b.version} <span className="text-fg-2">{b.fileName}</span>
                </span>
                {b.isActive ? (
                  <Badge tone="ok">Active</Badge>
                ) : (
                  <Button variant="ghost" loading={activate.isPending} onClick={() => activate.mutate(b.id)}>
                    Make active
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <RosterEditor profile={profile} />
    </div>
  );
}
