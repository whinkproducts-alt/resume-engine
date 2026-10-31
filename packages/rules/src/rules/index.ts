// packages/rules/src/rules/index.ts
// R1 .. R20 — deterministic validator rules.
//
// Severity / blocking matrix (authoritative for this stage):
//   R1  MISSING_SECTION .......... error   blocking
//   R2  ROLE_MISMATCH ............ error   blocking   (close variant => warn)
//   R3  INVALID_CONTACT .......... error   blocking   (phone => warn)
//   R4  DATE_ORDER ............... error   blocking
//   R5  DATE_FORMAT .............. warn    non-blocking
//   R6  EMPLOYMENT_GAP ........... warn    non-blocking
//   R7  BULLET_COUNT ............. warn    non-blocking
//   R8  BULLET_LENGTH ............ warn    non-blocking
//   R9  LLM_JUDGED ............... warn    NON-BLOCKING (Victor sign-off)
//   R10 DUPLICATE_VERB ........... warn    non-blocking (Victor sign-off)
//   R11 BANNED_PHRASE ............ warn    non-blocking
//   R12 FIRST_PERSON ............. warn    non-blocking
//   R13 UNSUPPORTED_NODE ......... error   blocking
//   R14 WORD_DENSITY ............. warn    non-blocking
//   R15 PAGE_OVERFLOW ............ warn    non-blocking (Stage 8 QA)
//   R16 SKILLS_BOUNDS ............ warn    non-blocking
//   R17 EDUCATION ................ warn    non-blocking
//   R18 FILENAME_REGEX ........... error   blocking (Victor sign-off)
//   R19 PROHIBITED_PII ........... error   blocking (salary => warn)
//   R20 FACT_BANK ................ error   blocking -> retry (max 2)

import {
  FactBankEntry,
  Rule,
  RuleConfig,
  RuleContext,
  ValidationFlag,
  ExperienceItem,
} from '../types';
import {
  isCanonicalIsoMonth,
  isPresent,
  monthsBetween,
  parseYearMonth,
  toMonths,
} from '../util/date';
import {
  containsPhrase,
  extractLeadingVerb,
  scanNumericTokens,
  tokenOverlap,
  wordCount,
} from '../util/text';
import { matchNumericToken } from '../fact-bank';

/* --------------------------------- helpers --------------------------------- */

function flag(
  ruleId: string,
  code: string,
  severity: ValidationFlag['severity'],
  blocking: boolean,
  message: string,
  path?: string,
  meta?: Record<string, unknown>,
): ValidationFlag {
  return { ruleId, code, severity, blocking, message, path, meta };
}

function allBullets(ctx: RuleContext): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  ctx.resume.experience.forEach((exp, i) => {
    (exp.bullets ?? []).forEach((b, j) => {
      out.push({ path: `experience[${i}].bullets[${j}]`, text: b });
    });
  });
  (ctx.resume.projects ?? []).forEach((p, i) => {
    (p.bullets ?? []).forEach((b, j) => {
      out.push({ path: `projects[${i}].bullets[${j}]`, text: b });
    });
  });
  return out;
}

function isOpenEnded(exp: ExperienceItem): boolean {
  return exp.current === true || isPresent(exp.endDate ?? null);
}

/* ------------------------------------ R1 ----------------------------------- */

export const R1: Rule = {
  id: 'R1',
  name: 'Required sections present',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const flags: ValidationFlag[] = [];
    const r = ctx.resume;

    if (!r.contact?.name?.trim()) {
      flags.push(flag('R1', 'MISSING_SECTION', 'error', true,
        'Contact name is required.', 'contact.name'));
    }
    if (!r.summary?.trim() || wordCount(r.summary) < 15) {
      flags.push(flag('R1', 'MISSING_SECTION', 'error', true,
        'Professional summary must be present and at least 15 words.',
        'summary'));
    }
    if (!Array.isArray(r.skills) || r.skills.length === 0) {
      flags.push(flag('R1', 'MISSING_SECTION', 'error', true,
        'At least one skills group is required.', 'skills'));
    }
    if (!Array.isArray(r.experience) || r.experience.length === 0) {
      flags.push(flag('R1', 'MISSING_SECTION', 'error', true,
        'At least one experience entry is required.', 'experience'));
    }
    if (!Array.isArray(r.education) || r.education.length === 0) {
      flags.push(flag('R1', 'MISSING_SECTION', 'error', true,
        'At least one education entry is required.', 'education'));
    }
    return flags;
  },
};

/* ------------------------------------ R2 ----------------------------------- */

export const R2: Rule = {
  id: 'R2',
  name: 'Target role alignment (70% token overlap, stop words ignored)',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const target = ctx.targetRole ?? ctx.resume.meta.targetRole ?? '';
    const headline = ctx.resume.headline ?? '';

    if (!headline.trim()) {
      return [flag('R2', 'ROLE_MISSING', 'error', true,
        'Headline is required for role-alignment checking.', 'headline')];
    }

    const { score, shared, onlyA, onlyB } = tokenOverlap(
      headline, target, ctx.config.roleStopWords,
    );

    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
    if (norm(headline) === norm(target)) {
      return []; // exact
    }

    if (score >= ctx.config.roleOverlapThreshold) {
      // Authoritative close-variant behaviour: warn, do not block.
      return [flag('R2', 'ROLE_CLOSE_VARIANT', 'warn', false,
        `Headline "${headline}" is a close variant of target role "${target}" ` +
        `(${(score * 100).toFixed(0)}% token overlap).`,
        'headline',
        { score, shared, onlyA, onlyB, threshold: ctx.config.roleOverlapThreshold })];
    }

    return [flag('R2', 'ROLE_MISMATCH', 'error', true,
      `Headline "${headline}" does not match target role "${target}" ` +
      `(${(score * 100).toFixed(0)}% token overlap, required ` +
      `${(ctx.config.roleOverlapThreshold * 100).toFixed(0)}%).`,
      'headline',
      { score, shared, onlyA, onlyB })];
  },
};

/* ------------------------------------ R3 ----------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const PHONE_RE = /^\+?[0-9\s().-]{7,20}$/;

export const R3: Rule = {
  id: 'R3',
  name: 'Contact details well-formed',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const flags: ValidationFlag[] = [];
    const c = ctx.resume.contact ?? ({} as RuleContext['resume']['contact']);

    if (!c.email || !EMAIL_RE.test(c.email)) {
      flags.push(flag('R3', 'INVALID_EMAIL', 'error', true,
        `Email "${c.email ?? ''}" is missing or malformed.`, 'contact.email'));
    }
    if (c.phone && !PHONE_RE.test(c.phone)) {
      flags.push(flag('R3', 'INVALID_PHONE', 'warn', false,
        `Phone "${c.phone}" does not match an international-safe pattern.`,
        'contact.phone'));
    }
    for (const [i, link] of (c.links ?? []).entries()) {
      if (!/^https?:\/\/[^\s]+$/i.test(link)) {
        flags.push(flag('R3', 'INVALID_LINK', 'warn', false,
          `Link "${link}" is not an absolute http(s) URL.`,
          `contact.links[${i}]`));
      }
    }
    return flags;
  },
};

/* ------------------------------------ R4 ----------------------------------- */

export const R4: Rule = {
  id: 'R4',
  name: 'Chronological consistency',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const flags: ValidationFlag[] = [];
    const nowMonths = (() => {
      const d = new Date();
      return d.getUTCFullYear() * 12 + d.getUTCMonth();
    })();

    ctx.resume.experience.forEach((exp, i) => {
      const start = parseYearMonth(exp.startDate);
      const end = isOpenEnded(exp) ? null : parseYearMonth(exp.endDate ?? null);
      const p = `experience[${i}]`;

      if (!start) {
        flags.push(flag('R4', 'DATE_UNPARSEABLE', 'error', true,
          `Start date "${exp.startDate}" on ${exp.title} @ ${exp.company} ` +
          'cannot be parsed.', `${p}.startDate`));
        return;
      }
      if (!isOpenEnded(exp) && !end) {
        flags.push(flag('R4', 'DATE_UNPARSEABLE', 'error', true,
          `End date "${exp.endDate ?? ''}" on ${exp.title} @ ${exp.company} ` +
          'cannot be parsed (use "Present" for the current role).',
          `${p}.endDate`));
        return;
      }
      if (end && toMonths(end) < toMonths(start)) {
        flags.push(flag('R4', 'DATE_REVERSED', 'error', true,
          `End date precedes start date on ${exp.title} @ ${exp.company}.`,
          `${p}`,
          { startDate: exp.startDate, endDate: exp.endDate }));
      }
      if (end && toMonths(end) > nowMonths) {
        flags.push(flag('R4', 'DATE_FUTURE', 'error', true,
          `End date on ${exp.title} @ ${exp.company} is in the future.`,
          `${p}.endDate`));
      }
    });

    // Overlap detection across roles (sorted by start, ignoring open-ended past).
    const spans = ctx.resume.experience
      .map((exp, i) => {
        const s = parseYearMonth(exp.startDate);
        const e = isOpenEnded(exp) ? null : parseYearMonth(exp.endDate ?? null);
        return s ? { i, s: toMonths(s), e: e ? toMonths(e) : Number.MAX_SAFE_INTEGER,
          label: `${exp.title} @ ${exp.company}` } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.s - b.s);

    for (let k = 1; k < spans.length; k++) {
      const prev = spans[k - 1];
      const cur = spans[k];
      if (cur.s < prev.e) {
        flags.push(flag('R4', 'DATE_OVERLAP', 'error', true,
          `Roles overlap: "${prev.label}" and "${cur.label}".`,
          `experience[${cur.i}]`,
          { previous: prev.label, current: cur.label }));
      }
    }

    // Education ordering.
    ctx.resume.education.forEach((edu, i) => {
      const s = parseYearMonth(edu.startDate ?? null);
      const e = parseYearMonth(edu.endDate ?? null);
      if (s && e && toMonths(e) < toMonths(s)) {
        flags.push(flag('R4', 'DATE_REVERSED', 'error', true,
          `End date precedes start date for ${edu.degree} at ${edu.institution}.`,
          `education[${i}]`));
      }
    });

    return flags;
  },
};

/* ------------------------------------ R5 ----------------------------------- */

export const R5: Rule = {
  id: 'R5',
  name: 'Canonical date formatting (YYYY-MM)',
  severity: 'warn',
  blocking: false,
  evaluate(ctx) {
    const flags: ValidationFlag[] = [];
    ctx.resume.experience.forEach((exp, i) => {
      if (!isCanonicalIsoMonth(exp.startDate)) {
        flags.push(flag('R5', 'DATE_FORMAT', 'warn', false,
          `Start date "${exp.startDate}" should be YYYY-MM.`,
          `experience[${i}].startDate`));
      }
      if (!isOpenEnded(exp) && exp.endDate && !isCanonicalIsoMonth(exp.endDate)) {
        flags.push(flag('R5', 'DATE_FORMAT', 'warn', false,
          `End date "${exp.endDate}" should be YYYY-MM.`,
          `experience[${i}].endDate`));
      }
    });
    return flags;
  },
};

/* ------------------------------------ R6 ----------------------------------- */

export const R6: Rule = {
  id: 'R6',
  name: 'Employment gap detection',
  severity: 'warn',
  blocking: false,
  evaluate(ctx) {
    const flags: ValidationFlag[] = [];
    const spans = ctx.resume.experience
      .map((exp, i) => {
        const s = parseYearMonth(exp.startDate);
        const e = isOpenEnded(exp) ? null : parseYearMonth(exp.endDate ?? null);
        return s ? { i, start: s, end: e, exp } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => toMonths(a.start) - toMonths(b.start));

    for (let k = 1; k < spans.length; k++) {
      const prev = spans[k - 1];
      if (!prev.end) continue; // still employed — no gap possible
      const gap = monthsBetween(prev.end, spans[k].start);
      if (gap > ctx.config.maxGapMonths) {
        flags.push(flag('R6', 'EMPLOYMENT_GAP', 'warn', false,
          `${gap}-month gap between "${prev.exp.title} @ ${prev.exp.company}" ` +
          `and "${spans[k].exp.title} @ ${spans[k].exp.company}".`,
          `experience[${spans[k].i}]`,
          { gapMonths: gap, threshold: ctx.config.maxGapMonths }));
      }
    }
    return flags;
  },
};

/* ------------------------------------ R7 ----------------------------------- */

export const R7: Rule = {
  id: 'R7',
  name: 'Bullet count per role',
  severity: 'warn',
  blocking: false,
  evaluate(ctx) {
    const flags: ValidationFlag[] = [];
    const { min, max } = ctx.config.bulletsPerRole;
    ctx.resume.experience.forEach((exp, i) => {
      const n = (exp.bullets ?? []).length;
      if (n < min || n > max) {
        flags.push(flag('R7', 'BULLET_COUNT', 'warn', false,
          `${exp.title} @ ${exp.company} has ${n} bullets; expected ${min}–${max}.`,
          `experience[${i}].bullets`, { count: n, min, max }));
      }
    });
    return flags;
  },
};

/* ------------------------------------ R8 ----------------------------------- */

export const R8: Rule = {
  id: 'R8',
  name: 'Bullet length',
  severity: 'warn',
  blocking: false,
  evaluate(ctx) {
    const flags: ValidationFlag[] = [];
    for (const { path, text } of allBullets(ctx)) {
      if (text.length > ctx.config.maxBulletChars) {
        flags.push(flag('R8', 'BULLET_LENGTH', 'warn', false,
          `Bullet is ${text.length} chars; limit is ${ctx.config.maxBulletChars}.`,
          path, { length: text.length, limit: ctx.config.maxBulletChars }));
      }
      if (text.trim().length === 0) {
        flags.push(flag('R8', 'BULLET_EMPTY', 'warn', false,
          'Empty bullet found.', path));
      }
    }
    return flags;
  },
};

/* ------------------------------------ R9 ----------------------------------- */

export const R9: Rule = {
  id: 'R9',
  name: 'LLM-judged bullet quality',
  severity: 'warn',
  blocking: false, // Victor sign-off: records a warn, never blocks.
  evaluate(ctx) {
    const j = ctx.llmJudgement;
    if (!j) {
      return [flag('R9', 'LLM_JUDGED_SKIPPED', 'info', false,
        'No LLM judgement payload supplied; R9 skipped.')];
    }

    const flags: ValidationFlag[] = [];

    for (const b of j.bulletScores ?? []) {
      if (b.score < ctx.config.llmScoreFloor) {
        flags.push(flag('R9', 'LLM_JUDGED', 'warn', false,
          `Bullet scored ${b.score.toFixed(2)} (< ${ctx.config.llmScoreFloor})` +
          (b.rationale ? `: ${b.rationale}` : '.'),
          b.path, { score: b.score }));
      }
    }

    if (j.overallScore != null && j.overallScore < ctx.config.llmScoreFloor) {
      flags.push(flag('R9', 'LLM_JUDGED_OVERALL', 'warn', false,
        `Overall LLM quality score ${j.overallScore.toFixed(2)} is below ` +
        `${ctx.config.llmScoreFloor}.`, undefined, { score: j.overallScore }));
    }

    // Guarantee the non-blocking contract even if a caller passed blocking flags.
    return flags.map((f) => ({ ...f, severity: 'warn' as const, blocking: false }));
  },
};

/* ------------------------------------ R10 ---------------------------------- */

export const R10: Rule = {
  id: 'R10',
  name: 'Duplicate leading verbs (per-resume)',
  severity: 'warn',
  blocking: false, // Victor sign-off: warning severity only.
  evaluate(ctx) {
    const byVerb = new Map<string, string[]>();
    for (const { path, text } of allBullets(ctx)) {
      const verb = extractLeadingVerb(text);
      if (!verb) continue;
      const list = byVerb.get(verb) ?? [];
      list.push(path);
      byVerb.set(verb, list);
    }

    const flags: ValidationFlag[] = [];
    for (const [verb, paths] of byVerb) {
      if (paths.length > 1) {
        flags.push(flag('R10', 'DUPLICATE_VERB', 'warn', false,
          `Verb "${verb}" leads ${paths.length} bullets; vary the opening verb.`,
          paths[0], { verb, count: paths.length, paths }));
      }
    }
    return flags;
  },
};

/* ------------------------------------ R11 ---------------------------------- */

export const R11: Rule = {
  id: 'R11',
  name: 'Banned phrases and clichés',
  severity: 'warn',
  blocking: false,
  evaluate(ctx) {
    const flags: ValidationFlag[] = [];
    const haystacks: { path: string; text: string }[] = [
      ...(ctx.resume.summary ? [{ path: 'summary', text: ctx.resume.summary }] : []),
      ...allBullets(ctx),
    ];
    for (const { path, text } of haystacks) {
      for (const phrase of ctx.config.bannedPhrases) {
        if (containsPhrase(text, phrase)) {
          flags.push(flag('R11', 'BANNED_PHRASE', 'warn', false,
            `Cliché "${phrase}" detected.`, path, { phrase }));
        }
      }
    }
    return flags;
  },
};

/* ------------------------------------ R12 ---------------------------------- */

export const R12: Rule = {
  id: 'R12',
  name: 'First-person voice',
  severity: 'warn',
  blocking: false,
  evaluate(ctx) {
    const flags: ValidationFlag[] = [];
    for (const { path, text } of allBullets(ctx)) {
      const words = text.toLowerCase().match(/\b[a-z']+\b/g) ?? [];
      const hit = words.find((w) => ctx.config.pronouns.includes(w));
      if (hit) {
        flags.push(flag('R12', 'FIRST_PERSON', 'warn', false,
          `First-person pronoun "${hit}" in bullet; use implied-subject voice.`,
          path, { pronoun: hit }));
      }
    }
    return flags;
  },
};

/* ------------------------------------ R13 ---------------------------------- */

const ALLOWED_NODES = new Set(['paragraph', 'heading', 'bullet']);

export const R13: Rule = {
  id: 'R13',
  name: 'Renderable structure only (no tables / images / textboxes)',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    if (!ctx.renderedNodes) {
      return [flag('R13', 'RENDER_NOT_INSPECTED', 'info', false,
        'No renderer node inventory supplied; R13 deferred to post-render pass.')];
    }
    const flags: ValidationFlag[] = [];
    for (const node of ctx.renderedNodes) {
      if (!ALLOWED_NODES.has(node.type)) {
        flags.push(flag('R13', 'UNSUPPORTED_NODE', 'error', true,
          `Renderer emitted unsupported node type "${node.type}".`,
          node.path, { nodeType: node.type }));
      }
    }
    return flags;
  },
};

/* ------------------------------------ R14 ---------------------------------- */

export const R14: Rule = {
  id: 'R14',
  name: 'Document word density',
  severity: 'warn',
  blocking: false,
  evaluate(ctx) {
    const r = ctx.resume;
    let total = wordCount(r.summary ?? '');
    for (const { text } of allBullets(ctx)) total += wordCount(text);
    for (const g of r.skills) total += g.items.length;
    if (total > ctx.config.maxTotalWords) {
      return [flag('R14', 'WORD_DENSITY', 'warn', false,
        `Document contains ~${total} words; budget is ${ctx.config.maxTotalWords}.`,
        undefined, { total, budget: ctx.config.maxTotalWords })];
    }
    return [];
  },
};

/* ------------------------------------ R15 ---------------------------------- */

export const R15: Rule = {
  id: 'R15',
  name: 'Page overflow',
  severity: 'warn',
  blocking: false,
  evaluate(ctx) {
    if (ctx.pageCount == null) {
      return [flag('R15', 'PAGE_COUNT_UNKNOWN', 'info', false,
        'Page count not yet available; R15 runs after Stage 8 PDF QA.')];
    }
    if (ctx.pageCount > ctx.config.maxPages) {
      return [flag('R15', 'PAGE_OVERFLOW', 'warn', false,
        `Rendered document is ${ctx.pageCount} pages; limit is ` +
        `${ctx.config.maxPages}.`, undefined,
        { pageCount: ctx.pageCount, maxPages: ctx.config.maxPages })];
    }
    return [];
  },
};

/* ------------------------------------ R16 ---------------------------------- */

export const R16: Rule = {
  id: 'R16',
  name: 'Skills inventory bounds',
  severity: 'warn',
  blocking: false,
  evaluate(ctx) {
    const { min, max } = ctx.config.skillsBounds;
    const items = (ctx.resume.skills ?? []).flatMap((g) => g.items ?? []);
    const deduped = new Set(items.map((s) => s.trim().toLowerCase()));

    const flags: ValidationFlag[] = [];
    if (deduped.size < min) {
      flags.push(flag('R16', 'SKILLS_BOUNDS', 'warn', false,
        `Only ${deduped.size} unique skills; minimum is ${min}.`,
        'skills', { count: deduped.size, min, max }));
    }
    if (deduped.size > max) {
      flags.push(flag('R16', 'SKILLS_BOUNDS', 'warn', false,
        `${deduped.size} unique skills exceeds the maximum of ${max}.`,
        'skills', { count: deduped.size, min, max }));
    }
    if (deduped.size !== items.length) {
      flags.push(flag('R16', 'SKILLS_DUPLICATE', 'warn', false,
        `${items.length - deduped.size} duplicate skill entries detected.`,
        'skills'));
    }
    return flags;
  },
};

/* ------------------------------------ R17 ---------------------------------- */

export const R17: Rule = {
  id: 'R17',
  name: 'Education completeness',
  severity: 'warn',
  blocking: false,
  evaluate(ctx) {
    const flags: ValidationFlag[] = [];
    ctx.resume.education.forEach((edu, i) => {
      if (!edu.institution?.trim()) {
        flags.push(flag('R17', 'EDUCATION_INCOMPLETE', 'warn', false,
          'Education entry is missing an institution.', `education[${i}]`));
      }
      if (!edu.degree?.trim()) {
        flags.push(flag('R17', 'EDUCATION_INCOMPLETE', 'warn', false,
          'Education entry is missing a degree.', `education[${i}]`));
      }
      if (!edu.endDate) {
        flags.push(flag('R17', 'EDUCATION_NO_END_DATE', 'warn', false,
          `Education at ${edu.institution} has no completion date.`,
          `education[${i}].endDate`));
      }
    });
    return flags;
  },
};

/* ------------------------------------ R18 ---------------------------------- */

export const R18: Rule = {
  id: 'R18',
  name: 'Output filename pattern (Candidate_Role_Company.docx)',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const pattern = ctx.config.filenamePattern;
    const name = ctx.fileName || ctx.resume.meta.fileName || '';

    // Rebuild a fresh regex so lastIndex state on a /g pattern can't leak.
    const re = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''));
    if (!re.test(name)) {
      return [flag('R18', 'FILENAME_REGEX', 'error', true,
        `Filename "${name}" does not match ${pattern.source}.`,
        'meta.fileName', { fileName: name, pattern: pattern.source })];
    }
    return [];
  },
};

/* ------------------------------------ R19 ---------------------------------- */

const PROHIBITED: { code: string; re: RegExp; label: string; blocking: boolean }[] = [
  { code: 'PII_DOB', label: 'date of birth',
    re: /\b(d\.?o\.?b\.?|date of birth|born on)\b/i, blocking: true },
  { code: 'PII_MARITAL', label: 'marital status',
    re: /\b(marital status|married|single|divorced|spouse)\b/i, blocking: true },
  { code: 'PII_NATIONAL_ID', label: 'national ID / SSN',
    re: /\b\d{3}-\d{2}-\d{4}\b|\bnational id\b|\bpassport (no|number)\b/i,
    blocking: true },
  { code: 'PII_PHOTO', label: 'photo reference',
    re: /\b(photo|headshot|portrait) (attached|enclosed|available)\b/i,
    blocking: true },
  { code: 'PII_SALARY', label: 'salary expectation',
    re: /\b(expected salary|salary expectation|current ctc|compensation expectation)\b/i,
    blocking: false },
];

export const R19: Rule = {
  id: 'R19',
  name: 'Prohibited personal data',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const r = ctx.resume;
    const surfaces: { path: string; text: string }[] = [
      { path: 'summary', text: r.summary ?? '' },
      { path: 'headline', text: r.headline ?? '' },
      { path: 'contact.location', text: r.contact?.location ?? '' },
      ...allBullets(ctx),
    ];

    const flags: ValidationFlag[] = [];
    for (const { path, text } of surfaces) {
      if (!text) continue;
      for (const p of PROHIBITED) {
        if (p.re.test(text)) {
          flags.push(flag('R19', p.code, p.blocking ? 'error' : 'warn',
            p.blocking, `Prohibited ${p.label} content detected.`, path,
            { pattern: p.re.source }));
        }
      }
    }
    return flags;
  },
};

/* ------------------------------------ R20 ---------------------------------- */

export const R20: Rule = {
  id: 'R20',
  name: 'Fact Bank grounding of numeric claims',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const flags: ValidationFlag[] = [];
    const bank: FactBankEntry[] = ctx.factBank ?? [];
    const { allowUnverifiedNumbers, requireVerified } = ctx.config.factBank;

    for (const { path, text } of allBullets(ctx)) {
      const tokens = scanNumericTokens(text);
      for (const token of tokens) {
        const match = matchNumericToken(token, bank);

        if (!match.entry) {
          flags.push(flag('R20',
            allowUnverifiedNumbers ? 'FACT_BANK_MISS' : 'FACT_BANK_MISS',
            allowUnverifiedNumbers ? 'warn' : 'error',
            !allowUnverifiedNumbers,
            `Numeric claim "${token.raw}" has no Fact Bank entry.`,
            path,
            { token: token.raw, numeric: token.numeric, unit: token.unit }));
          continue;
        }

        if (requireVerified && !match.entry.verified) {
          flags.push(flag('R20', 'FACT_BANK_UNVERIFIED', 'error', true,
            `Numeric claim "${token.raw}" matches unverified Fact Bank entry ` +
            `"${match.entry.value}" (${match.entry.id}).`,
            path,
            { token: token.raw, factId: match.entry.id, via: match.via }));
        }
      }
    }
    return flags;
  },
};

/* ------------------------------- Rule registry ----------------------------- */

export const ALL_RULES: Rule[] = [
  R1, R2, R3, R4, R5, R6, R7, R8, R9, R10,
  R11, R12, R13, R14, R15, R16, R17, R18, R19, R20,
];
