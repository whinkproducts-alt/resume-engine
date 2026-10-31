"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, EmptyState, Input, Skeleton } from "@/components/ui";
import { errMsg } from "@/lib/run-status";
import { parsePhones } from "@/lib/forms";
import type { CreateProfileInput, Profile } from "@/lib/types";

export default function ProfilesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => api.get<Profile[]>("/profiles"),
  });

  const [form, setForm] = useState({
    name: "", headerFullName: "", headerCity: "", phones: "", headerEmail: "", linkedIn: "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const phones = parsePhones(form.phones);
  const valid =
    form.name.trim() && form.headerFullName.trim() && form.headerCity.trim() &&
    phones.length > 0 && /\S+@\S+\.\S+/.test(form.headerEmail);

  const create = useMutation({
    mutationFn: () => {
      const body: CreateProfileInput = {
        name: form.name.trim(),
        headerFullName: form.headerFullName.trim(),
        headerCity: form.headerCity.trim(),
        headerPhones: phones,
        headerEmail: form.headerEmail.trim(),
        ...(form.linkedIn.trim() ? { linkedIn: form.linkedIn.trim() } : {}),
      };
      return api.post<Profile>("/profiles", body);
    },
    onSuccess: () => {
      setForm({ name: "", headerFullName: "", headerCity: "", phones: "", headerEmail: "", linkedIn: "" });
      void qc.invalidateQueries({ queryKey: ["profiles"] });
    },
  });

  const items = data ?? [];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Profiles</h1>
        <p className="mt-1 text-sm text-fg-2">
          Each profile holds a header that is copied into every résumé unchanged, plus the
          employment roster and a base résumé.
        </p>
      </header>

      <Card className="space-y-3 p-5">
        <h2 className="text-sm font-medium">New profile</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input placeholder="Profile name (e.g. Product, 2026)" value={form.name} onChange={set("name")} />
          <Input placeholder="Full name as it appears on the résumé" value={form.headerFullName} onChange={set("headerFullName")} />
          <Input placeholder="City, Country" value={form.headerCity} onChange={set("headerCity")} />
          <Input placeholder="Phones (comma separated)" value={form.phones} onChange={set("phones")} />
          <Input type="email" placeholder="Email" value={form.headerEmail} onChange={set("headerEmail")} />
          <Input placeholder="LinkedIn (optional)" value={form.linkedIn} onChange={set("linkedIn")} />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-danger">{create.isError ? errMsg(create.error) : ""}</p>
          <Button loading={create.isPending} disabled={!valid} onClick={() => create.mutate()}>
            Create profile
          </Button>
        </div>
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
                  <div className="font-medium">
                    {p.name}{p.isDefault ? <span className="ml-2 text-xs text-gold-2">default</span> : null}
                  </div>
                  <div className="mt-1 text-xs text-fg-2">
                    {p.headerFullName} · {p.headerCity}
                  </div>
                </div>
                <span className="text-xs text-fg-2">
                  {p.activeBaseId ? "Base résumé uploaded" : "No base résumé"}
                </span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
