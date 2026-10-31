"use client";

// The employment roster the pipeline locks (rules R7 and R13): roles, education,
// certifications. Saving replaces each list (PUT /profiles/:id/{roles,education,certs}).

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Input } from "@/components/ui";
import { isMonth, parseLines, toIntOrNull, toMonth } from "@/lib/forms";
import { errMsg } from "@/lib/run-status";
import type { CertEntry, EducationEntry, ProfileDetail, RoleEntry } from "@/lib/types";

interface RoleDraft {
  companyName: string; title: string; baseTitle: string; startDate: string; endDate: string;
  location: string; baseFlagship: string; baseBullets: string;
}
interface EduDraft { institution: string; degree: string; field: string; startYear: string; endYear: string }
interface CertDraft { name: string; issuer: string; year: string }

const emptyRole = (): RoleDraft => ({
  companyName: "", title: "", baseTitle: "", startDate: "", endDate: "", location: "", baseFlagship: "", baseBullets: "",
});

const roleToDraft = (r: RoleEntry): RoleDraft => ({
  companyName: r.companyName, title: r.title, baseTitle: r.baseTitle,
  startDate: toMonth(r.startDate), endDate: toMonth(r.endDate), location: r.location ?? "",
  baseFlagship: r.baseFlagship ?? "", baseBullets: r.baseBullets.join("\n"),
});

export function roleDraftValid(r: RoleDraft): boolean {
  return Boolean(r.companyName.trim() && r.title.trim() && r.baseTitle.trim()) &&
    isMonth(r.startDate) && (r.endDate === "" || isMonth(r.endDate));
}

export function RosterEditor({ profile }: { profile: ProfileDetail }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["profile", profile.id] });

  const [roles, setRoles] = useState<RoleDraft[]>([]);
  const [edu, setEdu] = useState<EduDraft[]>([]);
  const [certs, setCerts] = useState<CertDraft[]>([]);

  useEffect(() => {
    setRoles(profile.roles.map(roleToDraft));
    setEdu(profile.education.map((e: EducationEntry) => ({
      institution: e.institution, degree: e.degree, field: e.field ?? "",
      startYear: String(e.startYear), endYear: e.endYear ? String(e.endYear) : "",
    })));
    setCerts(profile.certs.map((c: CertEntry) => ({
      name: c.name, issuer: c.issuer ?? "", year: c.year ? String(c.year) : "",
    })));
  }, [profile]);

  const saveRoles = useMutation({
    mutationFn: () => api.put(`/profiles/${profile.id}/roles`, {
      roles: roles.map((r) => ({
        companyName: r.companyName.trim(), title: r.title.trim(), baseTitle: r.baseTitle.trim(),
        startDate: r.startDate, endDate: r.endDate || null,
        location: r.location.trim() || null, baseFlagship: r.baseFlagship.trim() || null,
        baseBullets: parseLines(r.baseBullets),
      })),
    }),
    onSuccess: refresh,
  });
  const saveEdu = useMutation({
    mutationFn: () => api.put(`/profiles/${profile.id}/education`, {
      education: edu.map((e) => ({
        institution: e.institution.trim(), degree: e.degree.trim(), field: e.field.trim() || null,
        startYear: toIntOrNull(e.startYear), endYear: toIntOrNull(e.endYear),
      })),
    }),
    onSuccess: refresh,
  });
  const saveCerts = useMutation({
    mutationFn: () => api.put(`/profiles/${profile.id}/certs`, {
      certs: certs.map((c) => ({ name: c.name.trim(), issuer: c.issuer.trim() || null, year: toIntOrNull(c.year) })),
    }),
    onSuccess: refresh,
  });

  const upd = <T,>(list: T[], set: (v: T[]) => void, i: number, patch: Partial<T>) =>
    set(list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const drop = <T,>(list: T[], set: (v: T[]) => void, i: number) => set(list.filter((_, j) => j !== i));

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-medium">Employment roster</h2>
            <p className="mt-1 text-xs text-fg-2">
              Company names, dates and order never change in a generated résumé. List roles newest first.
              Dates look like 2020-01; leave the end date empty for a current role.
            </p>
          </div>
          <Button variant="outline" onClick={() => setRoles([...roles, emptyRole()])}><Plus size={14} /> Role</Button>
        </div>

        {roles.map((r, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-border bg-bg-2 p-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="Company" value={r.companyName} onChange={(e) => upd(roles, setRoles, i, { companyName: e.target.value })} />
              <Input placeholder="Location (optional)" value={r.location} onChange={(e) => upd(roles, setRoles, i, { location: e.target.value })} />
              <Input placeholder="Title on the base résumé" value={r.title} onChange={(e) => upd(roles, setRoles, i, { title: e.target.value, baseTitle: r.baseTitle || e.target.value })} />
              <Input placeholder="Base title (the rewrite must change it)" value={r.baseTitle} onChange={(e) => upd(roles, setRoles, i, { baseTitle: e.target.value })} />
              <Input placeholder="Start (2020-01)" value={r.startDate} onChange={(e) => upd(roles, setRoles, i, { startDate: e.target.value })} />
              <Input placeholder="End (empty if current)" value={r.endDate} onChange={(e) => upd(roles, setRoles, i, { endDate: e.target.value })} />
            </div>
            <Input placeholder="Base flagship line (optional)" value={r.baseFlagship} onChange={(e) => upd(roles, setRoles, i, { baseFlagship: e.target.value })} />
            <textarea
              className="input min-h-[90px] text-[13px]"
              placeholder="Base bullets, one per line"
              value={r.baseBullets}
              onChange={(e) => upd(roles, setRoles, i, { baseBullets: e.target.value })}
            />
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => drop(roles, setRoles, i)}><Trash2 size={14} /> Remove</Button>
            </div>
          </div>
        ))}

        <SaveRow
          error={saveRoles.isError ? errMsg(saveRoles.error) : null}
          saved={saveRoles.isSuccess}
          loading={saveRoles.isPending}
          disabled={roles.length === 0 || !roles.every(roleDraftValid)}
          onClick={() => saveRoles.mutate()}
          label="Save roles"
        />
      </Card>

      <Card className="space-y-3 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Education</h2>
          <Button variant="outline" onClick={() => setEdu([...edu, { institution: "", degree: "", field: "", startYear: "", endYear: "" }])}>
            <Plus size={14} /> Add
          </Button>
        </div>
        {edu.map((e, i) => (
          <div key={i} className="grid items-center gap-2 sm:grid-cols-[2fr_1fr_1fr_90px_90px_auto]">
            <Input placeholder="Institution" value={e.institution} onChange={(ev) => upd(edu, setEdu, i, { institution: ev.target.value })} />
            <Input placeholder="Degree" value={e.degree} onChange={(ev) => upd(edu, setEdu, i, { degree: ev.target.value })} />
            <Input placeholder="Field" value={e.field} onChange={(ev) => upd(edu, setEdu, i, { field: ev.target.value })} />
            <Input placeholder="Start" value={e.startYear} onChange={(ev) => upd(edu, setEdu, i, { startYear: ev.target.value })} />
            <Input placeholder="End" value={e.endYear} onChange={(ev) => upd(edu, setEdu, i, { endYear: ev.target.value })} />
            <Button variant="ghost" onClick={() => drop(edu, setEdu, i)}><Trash2 size={14} /></Button>
          </div>
        ))}
        <SaveRow
          error={saveEdu.isError ? errMsg(saveEdu.error) : null}
          saved={saveEdu.isSuccess}
          loading={saveEdu.isPending}
          disabled={!edu.every((e) => e.institution.trim() && e.degree.trim() && toIntOrNull(e.startYear) !== null)}
          onClick={() => saveEdu.mutate()}
          label="Save education"
        />
      </Card>

      <Card className="space-y-3 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Certifications</h2>
          <Button variant="outline" onClick={() => setCerts([...certs, { name: "", issuer: "", year: "" }])}>
            <Plus size={14} /> Add
          </Button>
        </div>
        {certs.map((c, i) => (
          <div key={i} className="grid items-center gap-2 sm:grid-cols-[2fr_1fr_90px_auto]">
            <Input placeholder="Name" value={c.name} onChange={(ev) => upd(certs, setCerts, i, { name: ev.target.value })} />
            <Input placeholder="Issuer" value={c.issuer} onChange={(ev) => upd(certs, setCerts, i, { issuer: ev.target.value })} />
            <Input placeholder="Year" value={c.year} onChange={(ev) => upd(certs, setCerts, i, { year: ev.target.value })} />
            <Button variant="ghost" onClick={() => drop(certs, setCerts, i)}><Trash2 size={14} /></Button>
          </div>
        ))}
        <SaveRow
          error={saveCerts.isError ? errMsg(saveCerts.error) : null}
          saved={saveCerts.isSuccess}
          loading={saveCerts.isPending}
          disabled={!certs.every((c) => c.name.trim())}
          onClick={() => saveCerts.mutate()}
          label="Save certifications"
        />
      </Card>
    </div>
  );
}

function SaveRow(p: {
  error: string | null; saved: boolean; loading: boolean; disabled: boolean; onClick: () => void; label: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <p className={"text-xs " + (p.error ? "text-danger" : "text-success")}>{p.error ?? (p.saved ? "Saved" : "")}</p>
      <Button loading={p.loading} disabled={p.disabled} onClick={p.onClick}>{p.label}</Button>
    </div>
  );
}
