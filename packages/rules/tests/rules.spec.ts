// packages/rules/tests/rules.spec.ts
import { describe, it, expect } from 'vitest';
import {
  ALL_RULES,
  DEFAULT_RULE_CONFIG,
  DEFAULT_TOGGLES,
  RuleValidator,
  runWithRetry,
  tokenOverlap,
  type BaseSnapshot,
  type FactBankEntry,
  type JdContext,
  type ResumeDoc,
  type Rule,
  type RuleContext,
  type RuleToggles,
} from '../src';

/* --------------------------------- fixtures -------------------------------- */

const VERBS = [
  'Directed', 'Launched', 'Defined', 'Negotiated', 'Reduced', 'Aligned', 'Mentored',
  'Introduced', 'Automated', 'Streamlined', 'Partnered', 'Piloted', 'Standardised',
  'Expanded', 'Coached', 'Delivered',
];

const base = (): BaseSnapshot => ({
  header: {
    fullName: 'Jane Doe',
    city: 'Lagos, Nigeria',
    phones: ['+234 800 000 0000'],
    email: 'jane@example.com',
    linkedIn: 'linkedin.com/in/janedoe',
  },
  roles: [
    {
      company: 'Acme',
      baseTitle: 'Engineering Manager',
      startDate: '2020-01',
      endDate: null,
      flagship: 'Led the platform team',
      bullets: ['Built the billing service', 'Managed vendor contracts'],
    },
    {
      company: 'Globex',
      baseTitle: 'Software Engineer',
      startDate: '2016-03',
      endDate: '2019-12',
      flagship: 'Shipped the payments gateway',
      bullets: ['Wrote the settlement jobs', 'Fixed reconciliation bugs'],
    },
  ],
  education: [
    { institution: 'University of Lagos', degree: 'BSc', field: 'Computer Science',
      startYear: 2008, endYear: 2012 },
  ],
  certifications: [{ name: 'PMP', issuer: 'PMI', year: 2018 }],
  keywords: ['legacy1', 'legacy2'],
});

const jd = (): JdContext => ({
  roleTitle: 'Senior Product Manager',
  keywords: ['roadmap', 'stakeholders', 'agile', 'fintech', 'analytics'],
});

const roleBlock = (n: number, company: string, title: string, start: string,
  end: string | null) => ({
  id: `exp${n}`,
  company,
  title,
  location: null,
  startDate: start,
  endDate: end,
  flagship: `${VERBS[n * 8] ?? 'Owned'} the product strategy at ${company}.`,
  bullets: Array.from({ length: 7 }, (_, k) =>
    `${VERBS[n * 8 + k + 1] ?? `Verb${k}`} work item ${String.fromCharCode(97 + k)} for ${company} customers.`),
});

const resume = (): ResumeDoc => ({
  meta: {
    runId: 'run_abc123',
    fileName: 'Jane Doe_Product Manager_Acme.docx',
    candidateName: 'Jane Doe',
    targetRole: 'Senior Product Manager',
    generatedAt: '2026-10-31T00:00:00.000Z',
  },
  header: { ...base().header },
  headline: ['PRODUCT MANAGER', 'Fintech platforms and payments'],
  summary: [
    'Product leader who owns the roadmap for fintech platforms.',
    'Aligns stakeholders across engineering, risk and operations.',
    'Uses analytics to decide what to build next.',
    'Runs agile delivery with clear plans and honest updates.',
  ],
  competencies: DEFAULT_RULE_CONFIG.competencyLabels.map((label) => ({
    label, items: ['Item one', 'Item two'],
  })),
  experience: [
    roleBlock(0, 'Acme', 'Product Manager, Platform', '2020-01', null),
    roleBlock(1, 'Globex', 'Associate Product Manager', '2016-03', '2019-12'),
  ],
  education: base().education,
  certifications: base().certifications,
  keywords: [
    'roadmap', 'stakeholders', 'agile', 'fintech', 'analytics',
    ...Array.from({ length: 160 }, (_, i) => `keyword${i}`),
  ],
  targetCompanies: Array.from({ length: 7 }, (_, i) => ({
    name: `Company${i}`, department: 'Product', exampleRole: 'Product Manager',
  })),
});

const ctxFor = (over: Partial<RuleContext> = {}): RuleContext => ({
  resume: resume(),
  base: base(),
  jd: jd(),
  toggles: { ...DEFAULT_TOGGLES },
  factBank: [],
  config: DEFAULT_RULE_CONFIG,
  fileName: 'Jane Doe_Product Manager_Acme.docx',
  attempt: 1,
  ...over,
});

const rule = (id: string): Rule => {
  const r = ALL_RULES.find((x) => x.id === id);
  if (!r) throw new Error(`no rule ${id}`);
  return r;
};

const run = async (id: string, ctx: RuleContext) => rule(id).evaluate(ctx);
const codes = (flags: { code: string }[]) => flags.map((f) => f.code);

/* --------------------------------- baseline -------------------------------- */

describe('baseline', () => {
  it('registers R1..R20 and FACTS', () => {
    expect(ALL_RULES.map((r) => r.id)).toEqual([
      ...Array.from({ length: 20 }, (_, i) => `R${i + 1}`), 'FACTS',
    ]);
  });

  it('a well formed resume has no blocking failures', async () => {
    const result = await new RuleValidator().validate(ctxFor());
    expect(result.blockingFailures).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

/* ------------------------------- blocking rules ----------------------------- */

describe('R1 header is locked', () => {
  it('flags a changed name', async () => {
    const ctx = ctxFor();
    ctx.resume.header.fullName = 'Jane D.';
    expect(codes(await run('R1', ctx))).toEqual(['HEADER_CHANGED']);
  });
  it('accepts the contact location override as the city', async () => {
    const ctx = ctxFor({ contactLocationOverride: 'London, UK' });
    ctx.resume.header.city = 'London, UK';
    expect(await run('R1', ctx)).toEqual([]);
  });
  it('flags changed phones', async () => {
    const ctx = ctxFor();
    ctx.resume.header.phones = ['+1 555 0100'];
    expect(codes(await run('R1', ctx))).toContain('HEADER_CHANGED');
  });
});

describe('R2 headline role match (70% overlap, stop words ignored)', () => {
  it('treats a close variant as a pass', async () => {
    const ctx = ctxFor();
    ctx.resume.headline = ['LEAD PRODUCT MANAGER', 'Payments'];
    expect(await run('R2', ctx)).toEqual([]);
  });
  it('fails an unrelated headline', async () => {
    const ctx = ctxFor();
    ctx.resume.headline = ['DATA ENGINEER', 'Payments'];
    expect(codes(await run('R2', ctx))).toEqual(['HEADLINE_ROLE_MISMATCH']);
  });
  it('overlap ignores stop words', () => {
    const r = tokenOverlap('Data Scientist', 'Lead Data Scientist', DEFAULT_RULE_CONFIG.roleStopWords);
    expect(r.score).toBe(1);
  });
});

describe('R3 / R4 headline and summary shape', () => {
  it('R3 needs exactly two lines', async () => {
    const ctx = ctxFor();
    ctx.resume.headline = ['ONE', 'TWO', 'THREE'];
    expect(codes(await run('R3', ctx))).toEqual(['HEADLINE_LINE_COUNT']);
  });
  it('R4 needs four paragraphs', async () => {
    const ctx = ctxFor();
    ctx.resume.summary = ctx.resume.summary.slice(0, 3);
    expect(codes(await run('R4', ctx))).toContain('SUMMARY_PARAGRAPHS');
  });
  it('R4 warns, never blocks, on JD language and length', async () => {
    const ctx = ctxFor();
    ctx.resume.summary = ['Plain text.', 'Plain text.', 'Plain text.', 'Plain text.'];
    const flags = await run('R4', ctx);
    expect(codes(flags)).toEqual(['SUMMARY_JD_LANGUAGE']);
    expect(flags.every((f) => !f.blocking)).toBe(true);
  });
});

describe('R5 competencies', () => {
  it('requires the six labels in order', async () => {
    const ctx = ctxFor();
    const [a, b] = ctx.resume.competencies;
    if (a && b) { ctx.resume.competencies[0] = b; ctx.resume.competencies[1] = a; }
    expect(codes(await run('R5', ctx))).toContain('COMPETENCY_LABELS');
  });
});

describe('R6 role titles', () => {
  it('fails when a title is unchanged from the base', async () => {
    const ctx = ctxFor();
    const first = ctx.resume.experience[0];
    if (first) first.title = 'Engineering Manager';
    expect(codes(await run('R6', ctx))).toEqual(['TITLE_UNCHANGED']);
  });
  it('fails when a new title shares no JD terms', async () => {
    const ctx = ctxFor();
    const first = ctx.resume.experience[0];
    if (first) first.title = 'Chef de Cuisine';
    expect(codes(await run('R6', ctx))).toEqual(['TITLE_NO_JD_TERMS']);
  });
});

describe('R7 roster', () => {
  it('fails on company, date and order changes', async () => {
    const ctx = ctxFor();
    const [a, b] = ctx.resume.experience;
    if (a && b) {
      ctx.resume.experience = [b, a];
    }
    expect(codes(await run('R7', ctx)).length).toBeGreaterThan(0);

    const ctx2 = ctxFor();
    const first = ctx2.resume.experience[0];
    if (first) first.startDate = '2021-06';
    expect(codes(await run('R7', ctx2))).toEqual(['START_DATE_CHANGED']);
  });
  it('treats null and "Present" end dates as equal', async () => {
    const ctx = ctxFor();
    const first = ctx.resume.experience[0];
    if (first) first.endDate = 'Present';
    expect(await run('R7', ctx)).toEqual([]);
  });
});

describe('R8 / R11 flagship and point counts', () => {
  it('R8 requires a flagship line', async () => {
    const ctx = ctxFor();
    const first = ctx.resume.experience[0];
    if (first) first.flagship = '';
    expect(codes(await run('R8', ctx))).toEqual(['FLAGSHIP_MISSING']);
  });
  it('R11 requires eight points including the flagship', async () => {
    const ctx = ctxFor();
    const first = ctx.resume.experience[0];
    if (first) first.bullets = first.bullets.slice(0, 5); // 1 + 5 = 6
    expect(codes(await run('R11', ctx))).toEqual(['TOO_FEW_POINTS']);
  });
});

describe('R13 / R14 / R15 / R16', () => {
  it('R13 fails when education changes', async () => {
    const ctx = ctxFor();
    const first = ctx.resume.education[0];
    if (first) first.endYear = 2013;
    expect(codes(await run('R13', ctx))).toEqual(['ENTRY_CHANGED']);
  });
  it('R14 needs 150 distinct keywords', async () => {
    const ctx = ctxFor();
    ctx.resume.keywords = ctx.resume.keywords.slice(0, 100);
    expect(codes(await run('R14', ctx))).toContain('TOO_FEW_KEYWORDS');
  });
  it('R14 counts distinct terms, not duplicates', async () => {
    const ctx = ctxFor();
    ctx.resume.keywords = Array.from({ length: 200 }, () => 'same');
    expect(codes(await run('R14', ctx))).toContain('TOO_FEW_KEYWORDS');
  });
  it('R15 fails when the block equals the base block', async () => {
    const ctx = ctxFor();
    ctx.resume.keywords = [...ctx.base.keywords];
    expect(codes(await run('R15', ctx))).toEqual(['KEYWORD_BLOCK_UNCHANGED']);
  });
  it('R16 needs exactly seven distinct companies with details', async () => {
    const ctx = ctxFor();
    ctx.resume.targetCompanies = ctx.resume.targetCompanies.slice(0, 6);
    expect(codes(await run('R16', ctx))).toContain('TARGET_COMPANY_COUNT');

    const ctx2 = ctxFor();
    const t = ctx2.resume.targetCompanies[3];
    if (t) t.department = '';
    expect(codes(await run('R16', ctx2))).toEqual(['TARGET_COMPANY_DEPARTMENT']);
  });
});

describe('R18 file name', () => {
  it('accepts the authoritative pattern', async () => {
    expect(await run('R18', ctxFor())).toEqual([]);
  });
  it('rejects names that do not match', async () => {
    for (const bad of ['resume.docx', 'Jane Doe_Role.docx', 'Jane.Doe_Role_Co.docx']) {
      expect(codes(await run('R18', ctxFor({ fileName: bad })))).toEqual(['FILENAME_PATTERN']);
    }
  });
});

describe('R19 no leftover base text', () => {
  it('fails on a bullet copied from the base', async () => {
    const ctx = ctxFor();
    const first = ctx.resume.experience[0];
    if (first) first.bullets[0] = 'Built the billing service.';
    expect(codes(await run('R19', ctx))).toEqual(['BASE_TEXT_CARRIED_OVER']);
  });
});

describe('R20 writing style', () => {
  it('rejects em dashes always', async () => {
    const ctx = ctxFor({ toggles: { ...DEFAULT_TOGGLES, banHyphensInProse: false } });
    ctx.resume.summary[0] = 'Product leader — owns the roadmap.';
    expect(codes(await run('R20', ctx))).toEqual(['DASH_IN_PROSE']);
  });
  it('rejects hyphens when the toggle is on, allows them when off', async () => {
    const withHyphen = (toggles: RuleToggles) => {
      const ctx = ctxFor({ toggles });
      ctx.resume.summary[0] = 'A cross-functional leader of fintech roadmap work.';
      return ctx;
    };
    expect(codes(await run('R20', withHyphen(DEFAULT_TOGGLES)))).toEqual(['HYPHEN_IN_PROSE']);
    expect(await run('R20', withHyphen({ ...DEFAULT_TOGGLES, banHyphensInProse: false })))
      .toEqual([]);
  });
  it('warns on long sentences without blocking', async () => {
    const ctx = ctxFor();
    ctx.resume.summary[0] = `${'word '.repeat(40).trim()}.`;
    const flags = await run('R20', ctx);
    expect(codes(flags)).toEqual(['LONG_SENTENCE']);
    expect(flags[0]?.blocking).toBe(false);
  });
});

describe('FACTS', () => {
  const bank: FactBankEntry[] = [
    { id: 'f1', kind: 'metric', value: '40%', numeric: 40, unit: '%', verified: true },
    { id: 'f2', kind: 'metric', value: '12 engineers', numeric: 12, unit: 'engineers', verified: false },
  ];
  const withBullet = (text: string, toggles = DEFAULT_TOGGLES) => {
    const ctx = ctxFor({ factBank: bank, toggles });
    const first = ctx.resume.experience[0];
    if (first) first.bullets[0] = text;
    return ctx;
  };

  it('accepts a verified number', async () => {
    expect(await run('FACTS', withBullet('Cut onboarding time by 40%.'))).toEqual([]);
  });
  it('blocks an unknown number in strict mode', async () => {
    const flags = await run('FACTS', withBullet('Grew revenue by 73%.'));
    expect(codes(flags)).toEqual(['FACT_BANK_MISS']);
    expect(flags[0]?.blocking).toBe(true);
  });
  it('blocks an unverified fact in strict mode, warns otherwise', async () => {
    const text = 'Led 12 engineers.';
    const strict = await run('FACTS', withBullet(text));
    expect(codes(strict)).toEqual(['FACT_BANK_UNVERIFIED']);
    expect(strict[0]?.blocking).toBe(true);

    const loose = await run('FACTS', withBullet(text, { ...DEFAULT_TOGGLES, strictFactsMode: false }));
    expect(loose[0]?.blocking).toBe(false);
    expect(loose[0]?.severity).toBe('warn');
  });
  it('does not let a short number be grounded by a longer one (no substring matching)', async () => {
    const flags = await run('FACTS', withBullet('Cut onboarding time by 4%.'));
    expect(codes(flags)).toEqual(['FACT_BANK_MISS']);
  });
  it('matches a magnitude suffix through an alias', async () => {
    const ctx = withBullet('Reached 2M users.');
    ctx.factBank = [{ id: 'f9', kind: 'metric', value: '2 million users', numeric: 2, unit: 'users',
      aliases: ['2M'], verified: true }];
    expect(await run('FACTS', ctx)).toEqual([]);
  });
  it('ignores bare years', async () => {
    expect(await run('FACTS', withBullet('Joined in 2019 to lead delivery.'))).toEqual([]);
  });
});

/* ---------------------------- non-blocking contract ------------------------- */

describe('non-blocking rules (Victor sign-off)', () => {
  it('R9 warns on a low LLM score and never blocks', async () => {
    const ctx = ctxFor({
      llmJudgement: { bulletScores: [{ path: 'experience[0].bullets[0]', score: 0.2 }] },
    });
    const flags = await run('R9', ctx);
    expect(codes(flags)).toEqual(['LLM_BULLET_STRUCTURE']);
    expect(flags[0]).toMatchObject({ severity: 'warn', blocking: false });
  });

  it('R10 warns on duplicate opening verbs across the whole resume', async () => {
    const ctx = ctxFor();
    const [a, b] = ctx.resume.experience;
    if (a && b) { a.bullets[0] = 'Directed one thing.'; b.bullets[0] = 'Directed another thing.'; }
    const flags = await run('R10', ctx);
    expect(flags.some((f) => f.code === 'DUPLICATE_VERB')).toBe(true);
    expect(flags.every((f) => f.severity === 'warn' && !f.blocking)).toBe(true);
  });

  it('R12 only warns about bullet count drift', async () => {
    const flags = await run('R12', ctxFor());
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.every((f) => !f.blocking)).toBe(true);
  });

  it('the validator coerces any flag from a non-blocking rule to non-blocking', async () => {
    const rogue: Rule = {
      id: 'R10', name: 'rogue', severity: 'warn', blocking: false,
      evaluate: () => [{ ruleId: 'R10', code: 'X', severity: 'error', blocking: true, message: 'm' }],
    };
    const result = await new RuleValidator().override(rogue).validate(ctxFor());
    const f = result.flags.find((x) => x.code === 'X');
    expect(f?.blocking).toBe(false);
    expect(result.passed).toBe(true);
  });

  it('a crashing rule blocks instead of silently passing', async () => {
    const boom: Rule = {
      id: 'R2', name: 'boom', severity: 'error', blocking: true,
      evaluate: () => { throw new Error('kaput'); },
    };
    const result = await new RuleValidator().override(boom).validate(ctxFor());
    expect(result.passed).toBe(false);
    expect(codes(result.blockingFailures)).toContain('RULE_EXECUTION_ERROR');
  });
});

/* ------------------------------------ retry --------------------------------- */

describe('runWithRetry', () => {
  const baseOpts = () => {
    const c = ctxFor();
    return {
      validator: new RuleValidator(),
      base: c.base, jd: c.jd, toggles: c.toggles, factBank: c.factBank,
      fileName: c.fileName,
    };
  };

  it('regenerates once, then passes', async () => {
    const broken = resume();
    broken.headline = ['ONLY ONE LINE'];
    let calls = 0;
    const out = await runWithRetry({
      ...baseOpts(),
      initialResume: broken,
      regenerate: async () => { calls++; return resume(); },
    });
    expect(calls).toBe(1);
    expect(out.attempts).toBe(2);
    expect(out.exhausted).toBe(false);
  });

  it('allows 1 + 2 retries, then asks for human review', async () => {
    const broken = resume();
    broken.headline = ['ONLY ONE LINE'];
    let calls = 0;
    const out = await runWithRetry({
      ...baseOpts(),
      initialResume: broken,
      regenerate: async () => { calls++; return broken; },
    });
    expect(calls).toBe(2);
    expect(out.attempts).toBe(3);
    expect(out.exhausted).toBe(true);
    expect(out.requiresHumanReview).toBe(true);
  });
});
