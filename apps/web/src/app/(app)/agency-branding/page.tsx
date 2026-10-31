"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Input } from "@/components/ui";
import type { Branding } from "@/lib/types";

export default function AgencyBrandingPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["agency", "branding"],
    queryFn: () => api.get<Branding>("/api/agency/branding"),
  });

  const [form, setForm] = useState<Branding | null>(null);
  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = useMutation({
    mutationFn: (next: Branding) => api.patch<Branding>("/api/agency/branding", next),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["agency", "branding"] }),
  });

  const uploadLogo = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("logo", file);
      return api.post<Branding>("/api/agency/branding/logo", fd);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["agency", "branding"] }),
  });

  if (isLoading || !form) return null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Agency branding</h1>
        <p className="mt-1 text-sm text-fg-2">Logo, accent color, and footer applied to exports.</p>
      </header>

      <Card className="space-y-4 p-6">
        <div>
          <label className="mb-2 block text-xs uppercase tracking-wide text-fg-2">Logo</label>
          {form.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.logoUrl} alt="logo" className="mb-2 h-12" />
          )}
          <input
            type="file"
            accept="image/png,image/svg+xml"
            onChange={(e) => e.target.files?.[0] && uploadLogo.mutate(e.target.files[0])}
            className="block text-sm text-fg-2"
          />
        </div>

        <div>
          <label className="mb-2 block text-xs uppercase tracking-wide text-fg-2">Primary color</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={form.primaryColor}
              onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
              className="h-9 w-14 cursor-pointer rounded-md border border-border bg-bg-2"
            />
            <Input
              value={form.primaryColor}
              onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-xs uppercase tracking-wide text-fg-2">Footer text</label>
          <Input
            value={form.footerText}
            onChange={(e) => setForm({ ...form, footerText: e.target.value })}
            placeholder="Whink Apps · resumeengine.io"
          />
        </div>

        <Button loading={save.isPending} onClick={() => save.mutate(form)}>
          Save branding
        </Button>
      </Card>
    </div>
  );
}
