"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Input } from "@/components/ui";
import type { Run } from "@/lib/types";

export default function ConfirmCompanyPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { data: run } = useQuery({
    queryKey: ["run", id],
    queryFn: () => api.get<Run>(`/api/runs/${id}`),
  });

  const [company, setCompany] = useState("");
  useEffect(() => {
    if (run?.companyGuess?.name) setCompany(run.companyGuess.name);
  }, [run]);

  const confirm = useMutation({
    mutationFn: () =>
      api.post<Run>(`/api/runs/${id}/confirm-company`, { company }),
    onSuccess: () => router.replace(`/runs/${id}/review`),
  });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Confirm company</h1>
        <p className="mt-1 text-sm text-fg-2">
          We inferred the company from the JD. Adjust if needed.
        </p>
      </header>

      <Card className="space-y-4 p-6">
        <div>
          <label className="mb-2 block text-xs uppercase tracking-wide text-fg-2">Company</label>
          <Input value={company} onChange={(e) => setCompany(e.target.value)} />
        </div>

        {run?.companyGuess?.evidence?.length ? (
          <div className="rounded-lg bg-bg-2 p-4">
            <div className="mb-2 text-xs uppercase tracking-wide text-fg-2">Evidence</div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-fg-2">
              {run.companyGuess.evidence.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
            <div className="mt-2 text-xs text-fg-2/70">
              Confidence: {(run.companyGuess.confidence * 100).toFixed(0)}%
            </div>
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button loading={confirm.isPending} disabled={!company.trim()} onClick={() => confirm.mutate()}>
            Confirm & continue
          </Button>
        </div>
      </Card>
    </div>
  );
}
