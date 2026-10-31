import { Badge } from "@/components/ui";
import type { ValidationFlag } from "@/lib/types";

const tone = (f: ValidationFlag) => (f.blocking ? "fail" : f.severity === "warn" ? "warn" : "idle");

export function ValidatorPanel({ flags, passed }: { flags: ValidationFlag[]; passed: boolean }) {
  if (flags.length === 0) return <Badge tone="ok">No flags</Badge>;

  const blocking = flags.filter((f) => f.blocking);
  const rest = flags.filter((f) => !f.blocking);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-fg-2">
        <Badge tone={passed ? "ok" : "fail"}>{passed ? "Passed" : "Blocked"}</Badge>
        {blocking.length} blocking, {rest.length} to review
      </div>
      <ul className="space-y-2">
        {[...blocking, ...rest].map((f) => (
          <li key={f.id} className="flex items-start gap-2 text-xs">
            <Badge tone={tone(f)}>{f.ruleId ?? f.severity}</Badge>
            <span className="text-fg-2">
              {f.message}
              {f.field ? <span className="ml-1 font-mono text-fg-2/60">{f.field}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
