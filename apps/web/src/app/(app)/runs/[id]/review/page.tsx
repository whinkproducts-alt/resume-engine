"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { Download } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Card, Spinner } from "@/components/ui";
import { ResumePreview } from "@/components/runs/resume-preview";
import { ValidatorPanel } from "@/components/runs/validator-panel";
import { openArtifact } from "@/lib/download";
import { errorText } from "@/lib/run-status";
import type { JobDescription, RunDetail, RunOutput, RunValidation } from "@/lib/types";

export default function ReviewRunPage() {
  const { id } = useParams<{ id: string }>();

  const run = useQuery({ queryKey: ["run", id], queryFn: () => api.get<RunDetail>(`/runs/${id}`) });
  const output = useQuery({ queryKey: ["output", id], queryFn: () => api.get<RunOutput>(`/runs/${id}/output`) });
  const validation = useQuery({ queryKey: ["validation", id], queryFn: () => api.get<RunValidation>(`/runs/${id}/validation`) });
  const jdId = run.data?.jdId;
  const jd = useQuery({
    queryKey: ["jd", jdId],
    enabled: !!jdId,
    queryFn: () => api.get<JobDescription>(`/jds/${jdId}`),
  });

  if (run.isLoading || output.isLoading) {
    return <div className="flex h-96 items-center justify-center"><Spinner /></div>;
  }
  if (output.isError || !output.data) {
    return (
      <Card className="p-6 text-sm text-fg-2">
        There is no output for this run yet. {errorText(run.data?.errorCode ?? null)}
      </Card>
    );
  }

  const exported = run.data?.status === "COMPLETE";

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Review</h1>
          <p className="mt-1 text-sm text-fg-2">
            {output.data.outputJson.meta.fileName}
            {run.data?.pageCount ? ` · ${run.data.pageCount} page${run.data.pageCount > 1 ? "s" : ""}` : ""}
          </p>
        </div>
        {exported ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void openArtifact(id, "docx")}><Download size={14} /> DOCX</Button>
            <Button variant="outline" onClick={() => void openArtifact(id, "pdf")}><Download size={14} /> PDF</Button>
          </div>
        ) : (
          <Badge tone="fail">Not exported</Badge>
        )}
      </header>

      {!exported && (
        <Card className="border-danger/40 p-4 text-sm text-danger">
          {errorText(run.data?.errorCode ?? null) ?? "This run did not finish."} The draft below is shown so you can see which rules failed.
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-fg">Job description</h2>
          <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap text-[13px] leading-relaxed text-fg-2">
            {jd.data?.rawText ?? "Loading…"}
          </pre>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-fg">Tailored résumé</h2>
            <div className="max-h-[55vh] overflow-auto pr-2">
              <ResumePreview doc={output.data.outputJson} />
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-fg">Validator</h2>
            {validation.data ? (
              <ValidatorPanel flags={validation.data.flags} passed={validation.data.passed} />
            ) : (
              <Spinner />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
