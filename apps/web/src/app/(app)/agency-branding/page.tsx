"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Input, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { errMsg } from "@/lib/run-status";
import type { Branding } from "@/lib/types";

const DEFAULT_COLOR = "#1F3864";

export default function AgencyBrandingPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const allowed = user?.role === "AGENCY" || user?.isAdmin === true;

  const { data, isLoading } = useQuery({
    queryKey: ["branding"],
    queryFn: () => api.get<Branding | null>("/me/branding"),
  });

  const [form, setForm] = useState({
    displayName: "", contactEmail: "", contactPhone: "", footerText: "", primaryColor: DEFAULT_COLOR,
  });
  useEffect(() => {
    if (!data) return;
    setForm({
      displayName: data.displayName, contactEmail: data.contactEmail ?? "", contactPhone: data.contactPhone ?? "",
      footerText: data.footerText ?? "", primaryColor: data.primaryColor,
    });
  }, [data]);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => api.put<Branding>("/me/branding", {
      displayName: form.displayName.trim(),
      ...(form.contactEmail.trim() ? { contactEmail: form.contactEmail.trim() } : {}),
      ...(form.contactPhone.trim() ? { contactPhone: form.contactPhone.trim() } : {}),
      ...(form.footerText.trim() ? { footerText: form.footerText.trim() } : {}),
      primaryColor: form.primaryColor,
    }),
    onSuccess: (next) => qc.setQueryData(["branding"], next),
  });

  if (isLoading) return <div className="flex h-64 items-center justify-center"><Spinner /></div>;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Agency branding</h1>
        <p className="mt-1 text-sm text-fg-2">
          White label documents: your accent colour replaces the default, and your footer text appears on every page.
        </p>
      </header>

      {!allowed && (
        <Card className="border-gold/40 p-4 text-sm text-gold-2">
          White label branding is part of the Agency plan. You can look, but saving needs an Agency account.
        </Card>
      )}

      <Card className="space-y-4 p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input placeholder="Display name" value={form.displayName} onChange={set("displayName")} />
          <Input type="email" placeholder="Contact email" value={form.contactEmail} onChange={set("contactEmail")} />
          <Input placeholder="Contact phone" value={form.contactPhone} onChange={set("contactPhone")} />
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Primary colour"
              value={/^#[0-9a-fA-F]{6}$/.test(form.primaryColor) ? form.primaryColor : DEFAULT_COLOR}
              onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value.toUpperCase() }))}
              className="h-9 w-12 cursor-pointer rounded border border-border bg-bg-2"
            />
            <Input value={form.primaryColor} onChange={set("primaryColor")} placeholder="#1F3864" />
          </div>
        </div>
        <Input placeholder="Footer text" value={form.footerText} onChange={set("footerText")} />
        <p className="text-xs text-fg-2">Logo upload is not available yet.</p>

        <div className="flex items-center justify-between">
          <p className={"text-xs " + (save.isError ? "text-danger" : "text-success")}>
            {save.isError ? errMsg(save.error) : save.isSuccess ? "Saved" : ""}
          </p>
          <Button
            loading={save.isPending}
            disabled={!allowed || !form.displayName.trim() || !/^#[0-9a-fA-F]{6}$/.test(form.primaryColor)}
            onClick={() => save.mutate()}
          >
            Save branding
          </Button>
        </div>
      </Card>
    </div>
  );
}
