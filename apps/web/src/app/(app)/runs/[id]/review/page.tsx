"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Download, RefreshCw, Pencil } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Card, Spinner } from "@/components/ui";
import type { Bullet, RunReview, Section, ValidationFlag } from "@/lib/types";

export default function ReviewRunPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["review", id],
    queryFn: () => api.get<RunReview>(`/api/runs/${id}/review`),
  });

  if (isLoading || !data) {
    return <div className="flex h-96 items-center justify-center"><Spinner /></div>;
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Review</h1>
          <p className="mt-1 text-sm text-fg-2">Edit bullets inline, regenerate per section, then download.</p>
        </div>
        <div className="flex gap-2">
          <a href={data.downloadUrls.docx} download>
            <Button variant="outline"><Download size={14} /> DOCX</Button>
          </a>
          <a href={data.downloadUrls.pdf} download>
            <Button variant="outline"><Download size={14} /> PDF</Button>
          </a>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* LEFT: JD */}
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-fg">Job description</h2>
          <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap text-[13px] leading-relaxed text-fg-2">
            {data.jd}
          </pre>
        </Card>

        {/* RIGHT: Résumé + validator */}
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-fg">Tailored résumé</h2>
            <div className="max-h-[55vh] space-y-6 overflow-auto pr-2">
              {data.sections.map((s) => (
                <SectionEditor key={s.id} runId={id} section={s} onMutate={() =>
                  qc.invalidateQueries({ queryKey: ["review", id] })} />
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-fg">Validator</h2>
            {data.flags.length === 0 ? (
              <Badge tone="ok">No flags</Badge>
            ) : (
              <ul className="space-y-2">
                {data.flags.map((f) => <FlagRow key={f.id} flag={f} />)}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function SectionEditor({
  runId, section, onMutate,
}: { runId: string; section: Section; onMutate: () => void }) {
  const regen = useMutation({
    mutationFn: () => api.post(`/api/runs/${runId}/sections/${section.id}/regenerate`),
    onSuccess: onMutate,
  });

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gold-2">
          {section.title}
        </h3>
        <Button variant="ghost" onClick={() => regen.mutate()} loading={regen.isPending}>
          <RefreshCw size={12} /> Regenerate
        </Button>
      </div>
      <ul className="space-y-2">
        {section.bullets.map((b) => (
          <BulletRow key={b.id} runId={runId} bullet={b} onMutate={onMutate} />
        ))}
      </ul>
    </div>
  );
}

function BulletRow({ runId, bullet, onMutate }: { runId: string; bullet: Bullet; onMutate: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(bullet.text);

  const save = useMutation({
    mutationFn: () => api.patch(`/api/runs/${runId}/bullets/${bullet.id}`, { text }),
    onSuccess: () => { setEditing(false); onMutate(); },
  });

  return (
    <li className="group rounded-lg border border-border bg-bg-2 p-3 text-[13px] leading-relaxed text-fg">
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="input min-h-[70px] font-mono text-[12px]"
          />
          <div className="flex gap-2">
            <Button onClick={() => save.mutate()} loading={save.isPending}>Save</Button>
            <Button variant="ghost" onClick={() => { setEditing(false); setText(bullet.text); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <span className="flex-1">{bullet.text}</span>
          <button
            onClick={() => setEditing(true)}
            className="opacity-0 transition-opacity group-hover:opacity-100"
            aria-label="Edit bullet"
          >
            <Pencil size={12} className="text-fg-2" />
          </button>
        </div>
      )}
    </li>
  );
}

function FlagRow({ flag }: { flag: ValidationFlag }) {
  const tone = flag.severity === "fail" ? "fail" : flag.severity === "warn" ? "warn" : "idle";
  return (
    <li className="flex items-start gap-2 text-sm">
      <Badge tone={tone as "fail" | "warn" | "idle"}>{flag.rule}</Badge>
      <span className="text-fg-2">{flag.message}</span>
    </li>
  );
}
