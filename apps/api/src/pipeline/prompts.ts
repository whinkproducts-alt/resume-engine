// apps/api/src/pipeline/prompts.ts
// Prompt text and JSON schemas for Stage 2 (analyze) and Stage 4 (rewrite).
// Versioned: RuleSet.promptVersion and PromptVersion rows pin these for
// reproducibility (01-SPEC-v3.md section 5).

import { COMPETENCY_LABELS, type RuleToggles } from '@resume-engine/rules';
import type { JsonSchemaSpec } from './llm';

export const PROMPT_VERSION = 'v1';

export type SectionName =
  | 'analyze' | 'headline' | 'summary' | 'competencies' | 'role' | 'keywords' | 'targets';

/* --------------------------------- schemas --------------------------------- */
// OpenAI strict mode: every property required, additionalProperties false.

const strArr = { type: 'array', items: { type: 'string' } } as const;

export const ANALYZE_SCHEMA: JsonSchemaSpec = {
  name: 'jd_analysis',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'company', 'roleTitle', 'location', 'seniority', 'industryTags', 'topKeywords',
      'responsibilities', 'requirements', 'companyInferred', 'companyConfidence',
    ],
    properties: {
      company: { type: 'string' },
      roleTitle: { type: 'string' },
      location: { type: 'string' },
      seniority: { type: 'string' },
      industryTags: strArr,
      topKeywords: strArr,
      responsibilities: strArr,
      requirements: strArr,
      companyInferred: { type: 'boolean' },
      companyConfidence: { type: 'number' },
    },
  },
};

export const HEADLINE_SCHEMA: JsonSchemaSpec = {
  name: 'headline',
  schema: {
    type: 'object', additionalProperties: false,
    required: ['roleLine', 'industryLine'],
    properties: { roleLine: { type: 'string' }, industryLine: { type: 'string' } },
  },
};

export const SUMMARY_SCHEMA: JsonSchemaSpec = {
  name: 'summary',
  schema: {
    type: 'object', additionalProperties: false,
    required: ['paragraphs'],
    properties: { paragraphs: strArr },
  },
};

export const COMPETENCIES_SCHEMA: JsonSchemaSpec = {
  name: 'competencies',
  schema: {
    type: 'object', additionalProperties: false,
    required: ['groups'],
    properties: {
      groups: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['label', 'items'],
          properties: { label: { type: 'string' }, items: strArr },
        },
      },
    },
  },
};

export const ROLE_SCHEMA: JsonSchemaSpec = {
  name: 'role',
  schema: {
    type: 'object', additionalProperties: false,
    required: ['title', 'flagship', 'bullets'],
    properties: { title: { type: 'string' }, flagship: { type: 'string' }, bullets: strArr },
  },
};

export const KEYWORDS_SCHEMA: JsonSchemaSpec = {
  name: 'keywords',
  schema: {
    type: 'object', additionalProperties: false,
    required: ['keywords'],
    properties: { keywords: strArr },
  },
};

export const TARGETS_SCHEMA: JsonSchemaSpec = {
  name: 'targets',
  schema: {
    type: 'object', additionalProperties: false,
    required: ['companies'],
    properties: {
      companies: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['name', 'department', 'exampleRole'],
          properties: {
            name: { type: 'string' }, department: { type: 'string' }, exampleRole: { type: 'string' },
          },
        },
      },
    },
  },
};

/* --------------------------------- prompts --------------------------------- */

export function styleRules(toggles: RuleToggles): string {
  return [
    'WRITING STYLE (rule R20):',
    '- Short sentences. Plain, direct prose.',
    '- Never use an em dash or en dash.',
    toggles.banHyphensInProse
      ? '- Never use a hyphen in prose. Write "cross functional", "data driven", "10 to 15 percent".'
      : '- Avoid hyphens where a plain phrase works.',
    '- Do not use first person pronouns.',
  ].join('\n');
}

export function factRules(toggles: RuleToggles): string {
  return [
    'FACTS:',
    '- Use ONLY information present in SOURCE_RESUME, FACT_BANK and the job description.',
    '- Every number, percentage, currency amount or count you write must appear in FACT_BANK',
    toggles.strictFactsMode
      ? '  (strict mode: a number that is not in FACT_BANK will fail validation).'
      : '  (numbers not in FACT_BANK are flagged for review).',
    '- Do not invent employers, titles, dates, certifications or achievements.',
  ].join('\n');
}

export const ANALYZE_SYSTEM = [
  'You analyse a job description and return ONLY JSON matching the schema.',
  '- company: the hiring company. If it is not stated, infer it and set companyInferred=true.',
  '- companyConfidence: 0 to 1, how sure you are of the company name.',
  '- roleTitle: the title of the open role, as written in the job description.',
  '- topKeywords: the 25 most important skills, tools and terms, most important first.',
  '- responsibilities and requirements: short strings, one per item.',
  '- location: the job location, or an empty string.',
].join('\n');

export function analyzeUser(rawText: string): string {
  return `JOB_DESCRIPTION:\n"""\n${rawText.slice(0, 28_000)}\n"""\n\nReturn the JSON object now.`;
}

export interface WriteContext {
  company: string;
  roleTitle: string;
  seniority: string | null;
  industryTags: string[];
  jdKeywords: string[];
  responsibilities: string[];
  requirements: string[];
  sourceResume: string;
  factBank: string;
  toggles: RuleToggles;
  /** Validator feedback from the previous attempt for this section. */
  feedback?: string;
}

function jdBlock(c: WriteContext): string {
  return [
    `TARGET_COMPANY: ${c.company}`,
    `TARGET_ROLE: ${c.roleTitle}`,
    c.seniority ? `SENIORITY: ${c.seniority}` : '',
    `INDUSTRY: ${c.industryTags.join(', ')}`,
    `JD_KEYWORDS: ${c.jdKeywords.join(', ')}`,
    `RESPONSIBILITIES:\n${c.responsibilities.map((r) => `- ${r}`).join('\n')}`,
    `REQUIREMENTS:\n${c.requirements.map((r) => `- ${r}`).join('\n')}`,
  ].filter(Boolean).join('\n');
}

function tail(c: WriteContext): string {
  return [
    `FACT_BANK:\n${c.factBank || '(empty)'}`,
    `SOURCE_RESUME:\n"""\n${c.sourceResume.slice(0, 20_000)}\n"""`,
    c.feedback ? `FIX THESE VALIDATION FAILURES FROM THE LAST ATTEMPT:\n${c.feedback}` : '',
  ].filter(Boolean).join('\n\n');
}

const BASE_SYSTEM = (c: WriteContext) =>
  `You rewrite one section of a resume for a specific job. Return ONLY JSON matching the schema.\n${styleRules(c.toggles)}\n${factRules(c.toggles)}`;

export function headlinePrompt(c: WriteContext) {
  return {
    system: `${BASE_SYSTEM(c)}\nSECTION: headline (rules R2, R3).\n` +
      '- roleLine: the JD role title or a close variant of it.\n' +
      '- industryLine: one line naming the industry or domain focus.',
    user: `${jdBlock(c)}\n\n${tail(c)}`,
  };
}

export function summaryPrompt(c: WriteContext) {
  return {
    system: `${BASE_SYSTEM(c)}\nSECTION: professional summary (rule R4).\n` +
      '- Exactly 4 short paragraphs. Use the language of the job description.',
    user: `${jdBlock(c)}\n\n${tail(c)}`,
  };
}

export function competenciesPrompt(c: WriteContext) {
  return {
    system: `${BASE_SYSTEM(c)}\nSECTION: core competencies (rule R5).\n` +
      `- Exactly six groups, in this order, with these exact labels: ${COMPETENCY_LABELS.join(', ')}.\n` +
      '- Each group has a short list of items drawn from the source resume and the JD.',
    user: `${jdBlock(c)}\n\n${tail(c)}`,
  };
}

export interface RolePromptInput {
  company: string;
  baseTitle: string;
  startDate: string;
  endDate: string | null;
  location: string | null;
  baseFlagship: string | null;
  baseBullets: string[];
  /** Opening verbs already used elsewhere in this resume (rule R10). */
  usedVerbs: string[];
}

export function rolePrompt(c: WriteContext, r: RolePromptInput) {
  return {
    system: `${BASE_SYSTEM(c)}\nSECTION: one experience role (rules R6, R8 to R12, R19).\n` +
      `- title: a JD adjacent title for this role. It must differ from the base title "${r.baseTitle}" and share terms with the JD.\n` +
      '- flagship: exactly one line that opens the role. It is shown in bold.\n' +
      '- bullets: at least 7 bullets, so the role has at least 8 points with the flagship. Pad with JD aligned content if needed.\n' +
      '- Each point follows: accomplished X by measure Y resulting in Z.\n' +
      '- Rewrite every line. Do not reuse any sentence from the base text.\n' +
      '- Open each line with a different action verb. Avoid these verbs, already used: ' +
      `${r.usedVerbs.join(', ') || '(none)'}.\n` +
      `- Keep the bullet count near ${r.baseBullets.length} where the 8 point minimum allows.\n` +
      '- Do not output company names or dates. They are fixed.',
    user: [
      jdBlock(c),
      `ROLE: ${r.company}${r.location ? `, ${r.location}` : ''} (${r.startDate} to ${r.endDate ?? 'present'})`,
      `BASE_TITLE: ${r.baseTitle}`,
      `BASE_FLAGSHIP: ${r.baseFlagship ?? '(none)'}`,
      `BASE_BULLETS:\n${r.baseBullets.map((b) => `- ${b}`).join('\n') || '(none)'}`,
      tail(c),
    ].join('\n\n'),
  };
}

export function keywordsPrompt(c: WriteContext, previousBlock: string[]) {
  return {
    system: `${BASE_SYSTEM(c)}\nSECTION: keyword block (rules R14, R15).\n` +
      '- Include every JD keyword, then add related terms.\n' +
      '- At least 160 distinct terms in total. No duplicates.\n' +
      '- Build a new block for this job. Do not copy the previous block as a whole.\n' +
      '- Terms may contain hyphens; this section is not prose.',
    user: `${jdBlock(c)}\n\nPREVIOUS_BLOCK:\n${previousBlock.join(', ') || '(none)'}\n\n${tail(c)}`,
  };
}

export function targetsPrompt(c: WriteContext) {
  return {
    system: `${BASE_SYSTEM(c)}\nSECTION: target companies and similar roles (rule R16).\n` +
      '- Exactly 7 distinct real companies similar to the target company or industry.\n' +
      '- Each has a department and an example role title.',
    user: `${jdBlock(c)}\n\n${tail(c)}`,
  };
}
