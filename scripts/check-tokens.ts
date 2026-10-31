// scripts/check-tokens.ts
// Fails when a colour literal appears in apps/web/src outside the token file.
// Colours must come from the design tokens (see docs/DESIGN_TOKENS.md).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "apps/web/src");
/** The files allowed to define colours: the UI tokens, and the colours of generated documents. */
const TOKEN_FILES = new Set([
  "apps/web/src/app/globals.css",
  "apps/web/src/lib/document-colors.ts",
]);

const COLOR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|\b(?:rgba?|hsla?)\(/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Returns "file:line: literal" for each colour literal found in the text. */
export function findColorLiterals(text: string, file: string): string[] {
  const hits: string[] = [];
  text.split("\n").forEach((line, i) => {
    // Ignore Tailwind arbitrary-value anchors such as href="#section" and CSS ids.
    for (const m of line.matchAll(COLOR)) {
      const before = line[(m.index ?? 0) - 1];
      if (m[0].startsWith("#") && before !== undefined && /[\w&]/.test(before)) continue;
      hits.push(`${file}:${i + 1}: ${m[0]}`);
    }
  });
  return hits;
}

function main() {
  const offenders = walk(SRC)
    .filter((f) => /\.(tsx?|css|mdx)$/.test(f))
    .map((f) => ({ f, rel: relative(ROOT, f) }))
    .filter(({ rel }) => !TOKEN_FILES.has(rel))
    .flatMap(({ f, rel }) => findColorLiterals(readFileSync(f, "utf8"), rel));

  if (offenders.length > 0) {
    console.error("Hard coded colours found. Use a design token instead:\n" + offenders.join("\n"));
    process.exit(1);
  }
  console.log("check:tokens ok, no hard coded colours in apps/web/src");
}

if (require.main === module) main();
