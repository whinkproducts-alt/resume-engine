import type { ResumeOutput } from "@/lib/types";

const HEADING = "mb-2 mt-5 border-b border-border pb-1 text-xs font-semibold uppercase tracking-wide text-gold-2";

export function formatRange(start: string, end?: string | null): string {
  const fmt = (v: string) => {
    const m = /^(\d{4})-(\d{2})/.exec(v);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return m ? `${months[Number(m[2]) - 1]} ${m[1]}` : v;
  };
  return `${fmt(start)} to ${end ? fmt(end) : "Present"}`;
}

/** Read only view of Run.outputJson, in the order the document is rendered. */
export function ResumePreview({ doc }: { doc: ResumeOutput }) {
  const h = doc.header;
  return (
    <div className="space-y-1 text-[13px] leading-relaxed text-fg">
      <div className="text-center">
        <div className="text-lg font-semibold">{h.fullName}</div>
        <div className="text-xs text-fg-2">
          {[h.city, ...h.phones, h.email, h.linkedIn].filter(Boolean).join(" | ")}
        </div>
        {doc.headline.map((l, i) => (
          <div key={i} className={i === 0 ? "mt-2 font-semibold uppercase" : "italic text-fg-2"}>{l}</div>
        ))}
      </div>

      <h3 className={HEADING}>Professional summary</h3>
      {doc.summary.map((p, i) => <p key={i} className="mb-1">{p}</p>)}

      <h3 className={HEADING}>Core competencies</h3>
      {doc.competencies.map((c) => (
        <p key={c.label}><span className="font-semibold">{c.label}: </span>{c.items.join(", ")}</p>
      ))}

      <h3 className={HEADING}>Professional experience</h3>
      {doc.experience.map((e) => (
        <div key={e.id} className="mb-3">
          <div><span className="font-semibold">{e.company}</span> | {formatRange(e.startDate, e.endDate)}</div>
          <div className="italic text-fg-2">{e.title}</div>
          <ul className="mt-1 space-y-0.5">
            <li className="font-semibold"><span className="mr-1 text-gold-2">▸</span>{e.flagship}</li>
            {e.bullets.map((b, i) => <li key={i}><span className="mr-1 text-fg-2">•</span>{b}</li>)}
          </ul>
        </div>
      ))}

      <h3 className={HEADING}>Education</h3>
      {doc.education.map((e, i) => (
        <p key={i}>
          {[[e.degree, e.field].filter(Boolean).join(", "), e.institution,
            [e.startYear, e.endYear].filter(Boolean).join(" to ")].filter(Boolean).join(" | ")}
        </p>
      ))}

      {doc.certifications.length > 0 && (
        <>
          <h3 className={HEADING}>Certifications</h3>
          {doc.certifications.map((c, i) => (
            <p key={i}>{[c.name, c.issuer, c.year].filter(Boolean).join(" | ")}</p>
          ))}
        </>
      )}

      <h3 className={HEADING}>Keywords ({doc.keywords.length})</h3>
      <p className="text-[11px] text-fg-2">{doc.keywords.join(", ")}</p>

      <h3 className={HEADING}>Target companies and similar roles</h3>
      {doc.targetCompanies.map((t, i) => (
        <p key={i}>{t.name} | {t.department} | {t.exampleRole}</p>
      ))}
    </div>
  );
}
