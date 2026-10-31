"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Input, Spinner } from "@/components/ui";
import { errMsg } from "@/lib/run-status";
import type { RunDetail } from "@/lib/types";

export default function ConfirmCompanyPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { data: run } = useQuery({
    queryKey: ["run", id],
    queryFn: () => api.get<RunDetail>(`/runs/${id}`),
  });

  const [company, setCompany] = useState("");
  useEffect(() => {
    if (run?.pendingCompany?.name) setCompany(run.pendingCompany.name);
  }, [run]);

  // Only a run that is waiting on this answer belongs here.
  useEffect(() => {
    if (run && run.status !== "AWAITING_COMPANY_CONFIRM") router.replace(`/runs/${id}`);
  }, [run, id, router]);

  const confirm = useMutation({
    mutationFn: () => api.post(`/runs/${id}/confirm-company`, { companyName: company.trim() }),
    onSuccess: () => router.replace(`/runs/${id}`),
  });

  if (!run) return <div className="flex h-64 items-center justify-center"><Spinner /></div>;

  const pending = run.pendingCompany;
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Confirm company</h1>
        <p className="mt-1 text-sm text-fg-2">
          {pending?.inferred
            ? "The job description does not name the company, so we inferred it. Check it before continuing."
            : "We are not fully sure of the company name. Check it before continuing."}
        </p>
      </header>

      <Card className="space-y-4 p-6">
        <div>
          <label className="mb-2 block text-xs uppercase tracking-wide text-fg-2">Company</label>
          <Input value={company} onChange={(e) => setCompany(e.target.value)} />
          {pending?.confidence != null && (
            <p className="mt-2 text-xs text-fg-2/70">Confidence: {(pending.confidence * 100).toFixed(0)}%</p>
          )}
          <p className="mt-2 text-xs text-fg-2">
            The company name goes into the file name and the target company section.
          </p>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-danger">{confirm.isError ? errMsg(confirm.error) : ""}</p>
          <Button loading={confirm.isPending} disabled={company.trim().length < 2} onClick={() => confirm.mutate()}>
            Confirm and continue
          </Button>
        </div>
      </Card>
    </div>
  );
}
