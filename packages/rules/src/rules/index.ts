// packages/rules/src/rules/index.ts
// R1 .. R20 as defined in the authoritative ruleset
// (docs/source-parts/Resume_Engine_Spec_v3.1.txt, Section 4), plus FACTS,
// the Stage 6 fact bank check from 01-SPEC-v3.md section 5.
//
// Severity / blocking matrix:
//   Where the spec states a concrete check, a failure is an error and blocks
//   (the failing section is regenerated, up to the retry budget). Where the
//   spec says "LLM judged", "warn" or "optional", or gives no number for a
//   heuristic, the rule only ever warns.
//
//   R1  HEADER_CHANGED ................ error  blocking
//   R2  HEADLINE_ROLE_MISMATCH ........ error  blocking
//   R3  HEADLINE_LINE_COUNT ........... error  blocking
//   R4  SUMMARY_PARAGRAPHS ............ error  blocking (length / JD terms: warn)
//   R5  COMPETENCY_LABELS ............. error  blocking
//   R6  TITLE_UNCHANGED / NO_JD_TERMS . error  blocking
//   R7  ROSTER_MISMATCH ............... error  blocking
//   R8  FLAGSHIP_MISSING .............. error  blocking
//   R9  LLM_BULLET_STRUCTURE .......... warn   NON-BLOCKING (Victor sign-off)
//   R10 DUPLICATE_VERB ................ warn   NON-BLOCKING (Victor sign-off)
//   R11 TOO_FEW_POINTS ................ error  blocking
//   R12 BULLET_COUNT_DRIFT ............ warn   NON-BLOCKING
//   R13 EDUCATION_CHANGED ............. error  blocking
//   R14 TOO_FEW_KEYWORDS .............. error  blocking
//   R15 KEYWORD_BLOCK_UNCHANGED ....... error  blocking
//   R16 TARGET_COMPANIES .............. error  blocking
//   R17 WHINK_FRAMING_NOT_ENABLED ..... warn   NON-BLOCKING (optional toggle)
//   R18 FILENAME_PATTERN .............. error  blocking (Victor sign-off)
//   R19 BASE_TEXT_CARRIED_OVER ........ error  blocking (near copy: warn)
//   R20 DASH_IN_PROSE / HYPHEN ........ error  blocking (long sentence: warn)
//   FACTS FACT_BANK_MISS / UNVERIFIED . error  blocking when strictFactsMode,
//                                       otherwise warn

import type {
  EducationItem,
  CertificationItem,
  ExperienceItem,
  Rule,
  RuleContext,
  ValidationFlag,
} from '../types';
import { dateKey } from '../util/date';
import {
  extractLeadingVerb,
  isBareYear,
  jaccard,
  looseEqual,
  normalizeText,
  scanNumericTokens,
  splitSentences,
  tokenOverlap,
  tokenize,
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
  const f: ValidationFlag = { ruleId, code, severity, blocking, message };
  if (path !== undefined) f.path = path;
  if (meta !== undefined) f.meta = meta;
  return f;
}

const fail = (
  ruleId: string, code: string, message: string,
  path?: string, meta?: Record<string, unknown>,
) => flag(ruleId, code, 'error', true, message, path, meta);

const warn = (
  ruleId: string, code: string, message: string,
  path?: string, meta?: Record<string, unknown>,
) => flag(ruleId, code, 'warn', false, message, path, meta);

interface Surface { path: string; text: string }

/** Flagship line plus bullets for every role, with their paths. */
function experiencePoints(ctx: RuleContext): Surface[] {
  const out: Surface[] = [];
  ctx.resume.experience.forEach((exp, i) => {
    if (exp.flagship) out.push({ path: `experience[${i}].flagship`, text: exp.flagship });
    (exp.bullets ?? []).forEach((b, j) => {
      out.push({ path: `experience[${i}].bullets[${j}]`, text: b });
    });
  });
  return out;
}

/** Everything a reader would call written prose (R20 lints these). */
function proseSurfaces(ctx: RuleContext): Surface[] {
  const r = ctx.resume;
  return [
    ...r.headline.map((text, i) => ({ path: `headline[${i}]`, text })),
    ...r.summary.map((text, i) => ({ path: `summary[${i}]`, text })),
    ...experiencePoints(ctx),
  ];
}

function jdTerms(ctx: RuleContext): Set<string> {
  const stop = new Set(ctx.config.roleStopWords.map((w) => w.toLowerCase()));
  const terms = new Set<string>();
  for (const t of tokenize(ctx.jd.roleTitle)) if (!stop.has(t)) terms.add(t);
  for (const k of ctx.jd.keywords) for (const t of tokenize(k)) if (!stop.has(t)) terms.add(t);
  return terms;
}

function distinctKeywords(list: string[]): Set<string> {
  return new Set(list.map((k) => k.trim().toLowerCase()).filter(Boolean));
}

/* ------------------------------------ R1 ----------------------------------- */

export const R1: Rule = {
  id: 'R1',
  name: 'Header is locked',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const h = ctx.resume.header;
    const b = ctx.base.header;
    const override = ctx.contactLocationOverride?.trim();
    const flags: ValidationFlag[] = [];

    const same = (field: string, got: string, want: string) => {
      if (got !== want) {
        flags.push(fail('R1', 'HEADER_CHANGED',
          `Header ${field} must match the profile exactly.`, `header.${field}`,
          { expected: want, actual: got }));
      }
    };

    same('fullName', h.fullName, b.fullName);
    same('city', h.city, override ? override : b.city);
    same('email', h.email, b.email);
    same('linkedIn', h.linkedIn ?? '', b.linkedIn ?? '');
    if (JSON.stringify(h.phones) !== JSON.stringify(b.phones)) {
      flags.push(fail('R1', 'HEADER_CHANGED',
        'Header phones must match the profile exactly.', 'header.phones',
        { expected: b.phones, actual: h.phones }));
    }
    return flags;
  },
};

/* ------------------------------------ R2 ----------------------------------- */

export const R2: Rule = {
  id: 'R2',
  name: 'Headline contains the JD role title or a close variant',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const role = ctx.jd.roleTitle || ctx.resume.meta.targetRole || '';
    const line = ctx.resume.headline[0] ?? '';
    if (!line.trim()) {
      return [fail('R2', 'HEADLINE_MISSING',
        'The role line of the headline is empty.', 'headline[0]')];
    }
    if (!role.trim()) return [];

    if (normalizeText(line).includes(normalizeText(role))) return [];

    const { score, onlyB } = tokenOverlap(
      line, role, ctx.config.roleStopWords,
    );
    if (score >= ctx.config.roleOverlapThreshold) return [];

    return [fail('R2', 'HEADLINE_ROLE_MISMATCH',
      `Headline shares ${(score * 100).toFixed(0)}% of its tokens with the JD role ` +
      `"${role}"; at least ${(ctx.config.roleOverlapThreshold * 100).toFixed(0)}% is required.`,
      'headline[0]',
      { score, threshold: ctx.config.roleOverlapThreshold, missingTokens: onlyB })];
  },
};

/* ------------------------------------ R3 ----------------------------------- */

export const R3: Rule = {
  id: 'R3',
  name: 'Two headline lines: role line, then industry line',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const lines = ctx.resume.headline;
    const want = ctx.config.headlineLines;
    const flags: ValidationFlag[] = [];
    if (lines.length !== want) {
      flags.push(fail('R3', 'HEADLINE_LINE_COUNT',
        `Headline must have exactly ${want} lines; found ${lines.length}.`, 'headline',
        { count: lines.length }));
    }
    lines.forEach((l, i) => {
      if (!l.trim()) {
        flags.push(fail('R3', 'HEADLINE_LINE_EMPTY',
          `Headline line ${i + 1} is empty.`, `headline[${i}]`));
      }
    });
    return flags;
  },
};

/* ------------------------------------ R4 ----------------------------------- */

export const R4: Rule = {
  id: 'R4',
  name: 'Summary is four short paragraphs in the JD language',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const paras = ctx.resume.summary;
    const want = ctx.config.summaryParagraphs;
    const flags: ValidationFlag[] = [];

    if (paras.length !== want) {
      flags.push(fail('R4', 'SUMMARY_PARAGRAPHS',
        `Summary must have exactly ${want} paragraphs; found ${paras.length}.`,
        'summary', { count: paras.length }));
    }
    paras.forEach((p, i) => {
      if (!p.trim()) {
        flags.push(fail('R4', 'SUMMARY_PARAGRAPH_EMPTY',
          `Summary paragraph ${i + 1} is empty.`, `summary[${i}]`));
      } else if (wordCount(p) > ctx.config.summaryMaxParagraphWords) {
        flags.push(warn('R4', 'SUMMARY_PARAGRAPH_LONG',
          `Summary paragraph ${i + 1} has ${wordCount(p)} words; short paragraphs ` +
          `of at most ${ctx.config.summaryMaxParagraphWords} are expected.`,
          `summary[${i}]`));
      }
    });

    if (ctx.jd.keywords.length > 0) {
      const text = paras.join(' ').toLowerCase();
      const hits = ctx.jd.keywords.filter((k) => k.trim() && text.includes(k.trim().toLowerCase()));
      if (hits.length < ctx.config.summaryMinJdTerms) {
        flags.push(warn('R4', 'SUMMARY_JD_LANGUAGE',
          `Summary uses ${hits.length} JD keywords; at least ` +
          `${ctx.config.summaryMinJdTerms} are expected.`, 'summary',
          { found: hits }));
      }
    }
    return flags;
  },
};

/* ------------------------------------ R5 ----------------------------------- */

export const R5: Rule = {
  id: 'R5',
  name: 'Core Competencies has exactly six subsections in order',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const want = ctx.config.competencyLabels;
    const got = ctx.resume.competencies.map((c) => c.label);
    const flags: ValidationFlag[] = [];

    const ok = got.length === want.length && want.every((l, i) => looseEqual(l, got[i]));
    if (!ok) {
      flags.push(fail('R5', 'COMPETENCY_LABELS',
        `Core Competencies must be, in order: ${want.join(', ')}.`,
        'competencies', { expected: [...want], actual: got }));
    }
    ctx.resume.competencies.forEach((c, i) => {
      if (!c.items.some((s) => s.trim())) {
        flags.push(warn('R5', 'COMPETENCY_EMPTY',
          `Subsection "${c.label}" has no items.`, `competencies[${i}]`));
      }
    });
    return flags;
  },
};

/* ------------------------------------ R6 ----------------------------------- */

export const R6: Rule = {
  id: 'R6',
  name: 'Role titles change to JD adjacent titles',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const flags: ValidationFlag[] = [];
    const terms = jdTerms(ctx);
    const stop = new Set(ctx.config.roleStopWords.map((w) => w.toLowerCase()));

    ctx.resume.experience.forEach((exp, i) => {
      const base = ctx.base.roles[i];
      if (!base) return; // R7 reports roster length problems
      if (looseEqual(exp.title, base.baseTitle)) {
        flags.push(fail('R6', 'TITLE_UNCHANGED',
          `Role "${exp.title}" at ${exp.company} must be retitled to a JD adjacent title.`,
          `experience[${i}].title`, { baseTitle: base.baseTitle }));
        return;
      }
      const titleTokens = tokenize(exp.title).filter((t) => !stop.has(t));
      if (terms.size > 0 && !titleTokens.some((t) => terms.has(t))) {
        flags.push(fail('R6', 'TITLE_NO_JD_TERMS',
          `Role title "${exp.title}" shares no terms with the JD.`,
          `experience[${i}].title`));
      }
    });
    return flags;
  },
};

/* ------------------------------------ R7 ----------------------------------- */

export const R7: Rule = {
  id: 'R7',
  name: 'Company names, dates and order never change',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const exp = ctx.resume.experience;
    const roster = ctx.base.roles;
    const flags: ValidationFlag[] = [];

    if (exp.length !== roster.length) {
      flags.push(fail('R7', 'ROSTER_LENGTH',
        `Resume has ${exp.length} roles; the profile roster has ${roster.length}.`,
        'experience', { expected: roster.length, actual: exp.length }));
    }
    const n = Math.min(exp.length, roster.length);
    for (let i = 0; i < n; i++) {
      const e = exp[i] as ExperienceItem;
      const b = roster[i];
      if (!b) continue;
      if (e.company.trim() !== b.company.trim()) {
        flags.push(fail('R7', 'COMPANY_CHANGED',
          `Role ${i + 1} company must be "${b.company}" (roster order).`,
          `experience[${i}].company`, { expected: b.company, actual: e.company }));
      }
      if (dateKey(e.startDate) !== dateKey(b.startDate)) {
        flags.push(fail('R7', 'START_DATE_CHANGED',
          `Role ${i + 1} start date must be ${b.startDate}.`,
          `experience[${i}].startDate`, { expected: b.startDate, actual: e.startDate }));
      }
      if (dateKey(e.endDate) !== dateKey(b.endDate)) {
        flags.push(fail('R7', 'END_DATE_CHANGED',
          `Role ${i + 1} end date must be ${b.endDate ?? 'Present'}.`,
          `experience[${i}].endDate`, { expected: b.endDate ?? null, actual: e.endDate ?? null }));
      }
    }
    return flags;
  },
};

/* ------------------------------------ R8 ----------------------------------- */

export const R8: Rule = {
  id: 'R8',
  name: 'Every role opens with one bold flagship line',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const flags: ValidationFlag[] = [];
    ctx.resume.experience.forEach((exp, i) => {
      const f = exp.flagship ?? '';
      if (!f.trim()) {
        flags.push(fail('R8', 'FLAGSHIP_MISSING',
          `Role at ${exp.company} needs exactly one flagship line.`,
          `experience[${i}].flagship`));
      } else if (/\r|\n/.test(f.trim())) {
        flags.push(fail('R8', 'FLAGSHIP_MULTIPLE',
          `Role at ${exp.company} has more than one flagship line.`,
          `experience[${i}].flagship`));
      }
    });
    return flags;
  },
};

/* ------------------------------------ R9 ----------------------------------- */

export const R9: Rule = {
  id: 'R9',
  name: 'Bullet structure: accomplished X by measure Y resulting in Z (LLM judged)',
  severity: 'warn',
  blocking: false,
  evaluate(ctx) {
    const scores = ctx.llmJudgement?.bulletScores;
    if (!scores) {
      return [flag('R9', 'LLM_NOT_JUDGED', 'info', false,
        'No LLM judgement was supplied; bullet structure was not assessed.')];
    }
    return scores
      .filter((s) => s.score < ctx.config.llmScoreFloor)
      .map((s) => warn('R9', 'LLM_BULLET_STRUCTURE',
        `Bullet scored ${s.score.toFixed(2)} for the "accomplished X by Y resulting in Z" ` +
        `structure (floor ${ctx.config.llmScoreFloor}).` +
        (s.rationale ? ` ${s.rationale}` : ''),
        s.path, { score: s.score }));
  },
};

/* ----------------------------------- R10 ----------------------------------- */

export const R10: Rule = {
  id: 'R10',
  name: 'Bullets are varied: no repeated opening verbs (per resume)',
  severity: 'warn',
  blocking: false,
  evaluate(ctx) {
    const seen = new Map<string, string[]>();
    for (const { path, text } of experiencePoints(ctx)) {
      const verb = extractLeadingVerb(text);
      if (!verb) continue;
      const list = seen.get(verb) ?? [];
      list.push(path);
      seen.set(verb, list);
    }
    const flags: ValidationFlag[] = [];
    for (const [verb, paths] of seen) {
      if (paths.length > 1) {
        flags.push(warn('R10', 'DUPLICATE_VERB',
          `Opening verb "${verb}" is used ${paths.length} times in this resume.`,
          paths[1], { verb, paths }));
      }
    }
    return flags;
  },
};

/* ----------------------------------- R11 ----------------------------------- */

export const R11: Rule = {
  id: 'R11',
  name: 'At least eight experience points per role',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const min = ctx.config.minPointsPerRole;
    const flags: ValidationFlag[] = [];
    ctx.resume.experience.forEach((exp, i) => {
      const points =
        (exp.flagship?.trim() ? 1 : 0) + exp.bullets.filter((b) => b.trim()).length;
      if (points < min) {
        flags.push(fail('R11', 'TOO_FEW_POINTS',
          `Role at ${exp.company} has ${points} points; at least ${min} are required ` +
          '(flagship plus bullets). Pad with JD aligned content.',
          `experience[${i}]`, { points, min }));
      }
    });
    return flags;
  },
};

/* ----------------------------------- R12 ----------------------------------- */

export const R12: Rule = {
  id: 'R12',
  name: 'Bullet count per role stays stable against the base',
  severity: 'warn',
  blocking: false,
  evaluate(ctx) {
    const flags: ValidationFlag[] = [];
    ctx.resume.experience.forEach((exp, i) => {
      const base = ctx.base.roles[i];
      if (!base) return;
      const was = base.bullets.length;
      const now = exp.bullets.length;
      if (was !== now) {
        flags.push(warn('R12', 'BULLET_COUNT_DRIFT',
          `Role at ${exp.company} has ${now} bullets; the base resume had ${was}.`,
          `experience[${i}].bullets`, { base: was, actual: now }));
      }
    });
    return flags;
  },
};

/* ----------------------------------- R13 ----------------------------------- */

function sameEducation(a: EducationItem, b: EducationItem): boolean {
  return looseEqual(a.institution, b.institution)
    && looseEqual(a.degree, b.degree)
    && looseEqual(a.field, b.field)
    && a.startYear === b.startYear
    && (a.endYear ?? null) === (b.endYear ?? null);
}

function sameCert(a: CertificationItem, b: CertificationItem): boolean {
  return looseEqual(a.name, b.name)
    && looseEqual(a.issuer, b.issuer)
    && (a.year ?? null) === (b.year ?? null);
}

export const R13: Rule = {
  id: 'R13',
  name: 'Education, certifications and dates unchanged',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const flags: ValidationFlag[] = [];
    const { education, certifications } = ctx.resume;
    const base = ctx.base;

    const compare = <T>(
      label: string, path: string, got: T[], want: T[],
      same: (a: T, b: T) => boolean,
    ) => {
      if (got.length !== want.length) {
        flags.push(fail('R13', 'COUNT_CHANGED',
          `${label} count changed from ${want.length} to ${got.length}.`, path));
        return;
      }
      got.forEach((g, i) => {
        const w = want[i];
        if (w !== undefined && !same(g, w)) {
          flags.push(fail('R13', 'ENTRY_CHANGED',
            `${label} entry ${i + 1} differs from the profile.`, `${path}[${i}]`,
            { expected: w, actual: g }));
        }
      });
    };

    compare('Education', 'education', education, base.education, sameEducation);
    compare('Certification', 'certifications', certifications, base.certifications, sameCert);
    return flags;
  },
};

/* ----------------------------------- R14 ----------------------------------- */

export const R14: Rule = {
  id: 'R14',
  name: 'Keyword block has at least 150 distinct terms',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const flags: ValidationFlag[] = [];
    const list = ctx.resume.keywords;
    const distinct = distinctKeywords(list);

    if (distinct.size < ctx.config.minKeywords) {
      flags.push(fail('R14', 'TOO_FEW_KEYWORDS',
        `Keyword block has ${distinct.size} distinct terms; at least ` +
        `${ctx.config.minKeywords} are required.`, 'keywords',
        { distinct: distinct.size, min: ctx.config.minKeywords }));
    }
    if (distinct.size < list.filter((k) => k.trim()).length) {
      flags.push(warn('R14', 'DUPLICATE_KEYWORDS',
        'Keyword block contains duplicates; dedupe before rendering.', 'keywords'));
    }
    const missing = ctx.jd.keywords.filter((k) => k.trim() && !distinct.has(k.trim().toLowerCase()));
    if (missing.length > 0) {
      flags.push(warn('R14', 'JD_KEYWORDS_MISSING',
        `${missing.length} JD keywords are missing from the keyword block.`, 'keywords',
        { missing: missing.slice(0, 25) }));
    }
    return flags;
  },
};

/* ----------------------------------- R15 ----------------------------------- */

export const R15: Rule = {
  id: 'R15',
  name: 'Keyword block is replaced every time, never carried over',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const base = distinctKeywords(ctx.base.keywords);
    if (base.size === 0) return [];
    const now = distinctKeywords(ctx.resume.keywords);
    const identical = now.size === base.size && [...now].every((k) => base.has(k));
    if (identical) {
      return [fail('R15', 'KEYWORD_BLOCK_UNCHANGED',
        'Keyword block is identical to the base resume; it must be rebuilt for this JD.',
        'keywords')];
    }
    const carried = [...now].filter((k) => base.has(k)).length;
    return [flag('R15', 'KEYWORD_CARRYOVER', 'info', false,
      `${carried} of ${now.size} keywords also appear in the base block.`,
      'keywords', { carried, total: now.size })];
  },
};

/* ----------------------------------- R16 ----------------------------------- */

export const R16: Rule = {
  id: 'R16',
  name: 'Seven target companies, each with a department and example role',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const want = ctx.config.targetCompanyCount;
    const list = ctx.resume.targetCompanies;
    const flags: ValidationFlag[] = [];

    const names = new Set(list.map((t) => t.name.trim().toLowerCase()).filter(Boolean));
    if (list.length !== want || names.size !== want) {
      flags.push(fail('R16', 'TARGET_COMPANY_COUNT',
        `Exactly ${want} distinct target companies are required; found ${list.length} ` +
        `(${names.size} distinct).`, 'targetCompanies',
        { count: list.length, distinct: names.size }));
    }
    list.forEach((t, i) => {
      if (!t.name.trim()) {
        flags.push(fail('R16', 'TARGET_COMPANY_NAME',
          `Target company ${i + 1} has no name.`, `targetCompanies[${i}].name`));
      }
      if (!t.department.trim()) {
        flags.push(fail('R16', 'TARGET_COMPANY_DEPARTMENT',
          `Target company ${i + 1} has no department.`, `targetCompanies[${i}].department`));
      }
      if (!t.exampleRole.trim()) {
        flags.push(fail('R16', 'TARGET_COMPANY_ROLE',
          `Target company ${i + 1} has no example role.`, `targetCompanies[${i}].exampleRole`));
      }
    });
    return flags;
  },
};

/* ----------------------------------- R17 ----------------------------------- */

export const R17: Rule = {
  id: 'R17',
  name: 'WHINK Group framing is an optional per-resume toggle',
  severity: 'warn',
  blocking: false,
  evaluate(ctx) {
    if (ctx.toggles.whinkGroupFraming) return [];
    // A candidate who actually worked at WHINK Group legitimately names it.
    if (ctx.base.roles.some((r) => /whink/i.test(r.company))) return [];

    const flags: ValidationFlag[] = [];
    for (const { path, text } of [
      ...ctx.resume.summary.map((t, i) => ({ path: `summary[${i}]`, text: t })),
      ...experiencePoints(ctx),
    ]) {
      if (/whink\s+group/i.test(text)) {
        flags.push(warn('R17', 'WHINK_FRAMING_NOT_ENABLED',
          'WHINK Group framing appears but the toggle is off for this resume.', path));
      }
    }
    return flags;
  },
};

/* ----------------------------------- R18 ----------------------------------- */

export const R18: Rule = {
  id: 'R18',
  name: 'File name format',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const name = ctx.fileName ?? '';
    const pattern = ctx.config.filenamePattern;
    pattern.lastIndex = 0;
    if (!pattern.test(name)) {
      return [fail('R18', 'FILENAME_PATTERN',
        `File name "${name}" does not match the required pattern.`,
        'meta.fileName', { fileName: name, pattern: pattern.source })];
    }
    return [];
  },
};

/* ----------------------------------- R19 ----------------------------------- */

export const R19: Rule = {
  id: 'R19',
  name: 'Company blocks are fully rewritten: no leftover base text',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const flags: ValidationFlag[] = [];
    ctx.resume.experience.forEach((exp, i) => {
      const base = ctx.base.roles[i];
      if (!base) return;
      const baseTexts = [base.flagship ?? '', ...base.bullets]
        .map((t) => ({ raw: t, norm: normalizeText(t) }))
        .filter((t) => t.norm);
      const baseNorms = new Set(baseTexts.map((t) => t.norm));

      const own: Surface[] = [
        { path: `experience[${i}].flagship`, text: exp.flagship },
        ...exp.bullets.map((b, j) => ({ path: `experience[${i}].bullets[${j}]`, text: b })),
      ];
      for (const { path, text } of own) {
        const norm = normalizeText(text);
        if (!norm) continue;
        if (baseNorms.has(norm)) {
          flags.push(fail('R19', 'BASE_TEXT_CARRIED_OVER',
            `Text at ${path} is unchanged from the base resume.`, path));
          continue;
        }
        const near = baseTexts.find(
          (b) => jaccard(norm, b.norm) >= ctx.config.nearDuplicateSimilarity,
        );
        if (near) {
          flags.push(warn('R19', 'BASE_TEXT_NEAR_COPY',
            `Text at ${path} is almost identical to base text.`, path,
            { similarity: jaccard(norm, near.norm) }));
        }
      }
    });
    return flags;
  },
};

/* ----------------------------------- R20 ----------------------------------- */

const EM_EN_DASH = /[–—―]/;
const HYPHEN = /[-‐‑‒]/;

export const R20: Rule = {
  id: 'R20',
  name: 'Writing style: short sentences, plain prose, no hyphens or em dashes',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const flags: ValidationFlag[] = [];
    for (const { path, text } of proseSurfaces(ctx)) {
      if (EM_EN_DASH.test(text)) {
        flags.push(fail('R20', 'DASH_IN_PROSE',
          'Em and en dashes are not allowed in written prose.', path));
      } else if (ctx.toggles.banHyphensInProse && HYPHEN.test(text)) {
        flags.push(fail('R20', 'HYPHEN_IN_PROSE',
          'Hyphens are not allowed in written prose; rephrase.', path));
      }
      for (const s of splitSentences(text)) {
        if (wordCount(s) > ctx.config.maxSentenceWords) {
          flags.push(warn('R20', 'LONG_SENTENCE',
            `Sentence has ${wordCount(s)} words; keep sentences short ` +
            `(at most ${ctx.config.maxSentenceWords}).`, path));
        }
      }
    }
    return flags;
  },
};

/* ---------------------------------- FACTS ---------------------------------- */

export const FACTS: Rule = {
  id: 'FACTS',
  name: 'Every numeric claim is grounded in the Fact Bank',
  severity: 'error',
  blocking: true,
  evaluate(ctx) {
    const flags: ValidationFlag[] = [];
    const strict = ctx.toggles.strictFactsMode;
    const surfaces: Surface[] = [
      ...ctx.resume.summary.map((text, i) => ({ path: `summary[${i}]`, text })),
      ...experiencePoints(ctx),
    ];

    for (const { path, text } of surfaces) {
      for (const token of scanNumericTokens(text)) {
        if (isBareYear(token)) continue; // a date mention, not a metric
        const match = matchNumericToken(token, ctx.factBank);

        if (!match.entry) {
          flags.push(flag('FACTS', 'FACT_BANK_MISS', strict ? 'error' : 'warn', strict,
            `Numeric claim "${token.raw}" has no Fact Bank entry.`, path,
            { token: token.raw, numeric: token.numeric, unit: token.unit }));
        } else if (!match.entry.verified) {
          flags.push(flag('FACTS', 'FACT_BANK_UNVERIFIED', strict ? 'error' : 'warn', strict,
            `Numeric claim "${token.raw}" matches unverified Fact Bank entry ` +
            `"${match.entry.value}" (${match.entry.id}).`, path,
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
  R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, FACTS,
];
