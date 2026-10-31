// packages/rules/tests/rules.spec.ts
import { describe, it, expect } from 'vitest';
import {
  RuleValidator,
  DEFAULT_RULE_CONFIG,
  ResumeDoc,
  FactBankEntry,
} from '../src';
import { R2, R9, R10, R18, R20 } from '../src/rules';

const baseResume = (over: Partial<ResumeDoc> = {}): ResumeDoc => ({
  meta: {
    runId: 'run_abc123',
    fileName: 'Jane Doe_CTO_Acme.docx',
    candidateName: 'Jane Doe',
    targetRole: 'Chief Technology Officer',
    generatedAt: new Date().toISOString(),
  },
  contact: {
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '+1 555 010 2000',
    location: 'Lagos, NG',
  },
  headline: 'Chief Technology Officer',
  summary:
    'Technology executive with fifteen years leading platform engineering, ' +
    'cloud migration, and developer productivity programmes across fintech.',
  skills: [
    { category: 'Leadership', items: ['Org design', 'Hiring', 'Roadmapping'] },
    { category: 'Platform', items: ['Kubernetes', 'AWS', 'Terraform', 'Go', 'TypeScript'] },
    { category: 'Data', items: ['Postgres', 'Kafka', 'dbt'] },
  ],
  experience: [
    {
      id: 'exp1',
      company: 'Acme',
      title: 'VP Engineering',
      startDate: '2019-01',
      endDate: null,
      current: true,
      bullets: [
        'Led platform team of 40 engineers across three time zones.',
        'Cut p95 checkout latency by 42% via query and cache rework.',
        'Scaled Kubernetes estate to 1,200 services on AWS.',
      ],
    },
  ],
  education: [
    {
      id: 'edu1',
      institution: 'University of Lagos',
      degree: 'BSc',
      field: 'Computer Science',
      startDate: '2004-09',
      endDate: '2008-06',
    },
  ],
  ...over,
});

const bank: FactBankEntry[] = [
  { id: 'f1', kind: 'metric', value: '40', numeric: 40, unit: 'engineers', verified: true },
  { id: 'f2', kind: 'metric', value: '42%', numeric: 42, unit: '%', verified: true },
  { id: 'f3', kind: 'metric', value: '1200', numeric: 1200, unit: null, verified: true },
  { id: 'f4', kind: 'metric', value: '1200', numeric: 1200, unit: 'services', verified: true },
];

function ctx(over: Partial<Parameters<RuleValidator['validate']>[0]> = {}) {
  return {
    resume: baseResume(),
    factBank: bank,
    targetRole: 'Chief Technology Officer',
    fileName: 'Jane Doe_CTO_Acme.docx',
    ...over,
  };
}

describe('R2 — role alignment', () => {
  it('passes on exact headline match', async () => {
    expect(await R2.evaluate({ ...ctx(), config: DEFAULT_RULE_CONFIG } as any)).toHaveLength(0);
  });

  it('warns (non-blocking) on a 70%+ close variant', async () => {
    const flags = await R2.evaluate({
      ...ctx({
        resume: baseResume({ headline: 'Technology Officer' }),
      }),
      config: DEFAULT_RULE_CONFIG,
    } as any);
    expect(flags).toHaveLength(1);
    expect(flags[0].code).toBe('ROLE_CLOSE_VARIANT');
    expect(flags[0].blocking).toBe(false);
  });

  it('blocks on an unrelated headline', async () => {
    const flags = await R2.evaluate({
      ...ctx({ resume: baseResume({ headline: 'Retail Store Manager' }) }),
      config: DEFAULT_RULE_CONFIG,
    } as any);
    expect(flags[0].code).toBe('ROLE_MISMATCH');
    expect(flags[0].blocking).toBe(true);
  });
});

describe('R18 — filename regex', () => {
  it('accepts Candidate_Role_Company.docx', async () => {
    expect(await R18.evaluate({ ...ctx(), config: DEFAULT_RULE_CONFIG } as any))
      .toHaveLength(0);
  });

  it('rejects two-segment names', async () => {
    const flags = await R18.evaluate({
      ...ctx({ fileName: 'Jane Doe_CTO.docx' }),
      config: DEFAULT_RULE_CONFIG,
    } as any);
    expect(flags[0].code).toBe('FILENAME_REGEX');
    expect(flags[0].blocking).toBe(true);
  });

  it('rejects non-docx extensions', async () => {
    const flags = await R18.evaluate({
      ...ctx({ fileName: 'Jane Doe_CTO_Acme.pdf' }),
      config: DEFAULT_RULE_CONFIG,
    } as any);
    expect(flags).toHaveLength(1);
  });
});

describe('R9 — LLM judged is never blocking', () => {
  it('emits warn-only flags even at a terrible score', async () => {
    const flags = await R9.evaluate({
      ...ctx(),
      config: DEFAULT_RULE_CONFIG,
      llmJudgement: {
        bulletScores: [{ path: 'experience[0].bullets[0]', score: 0.1 }],
        overallScore: 0.2,
      },
    } as any);
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.every((f) => !f.blocking && f.severity === 'warn')).toBe(true);
  });
});

describe('R10 — duplicate verbs are warnings only', () => {
  it('flags repeated leading verbs without blocking', async () => {
    const resume = baseResume();
    resume.experience[0].bullets = [
      'Led platform team of 40 engineers.',
      'Led cloud migration to AWS.',
      'Led hiring for the data org.',
    ];
    const flags = await R10.evaluate({ ...ctx({ resume }), config: DEFAULT_RULE_CONFIG } as any);
    expect(flags).toHaveLength(1);
    expect(flags[0].code).toBe('DUPLICATE_VERB');
    expect(flags[0].blocking).toBe(false);
  });
});

describe('R20 — Fact Bank grounding', () => {
  it('passes when every numeric claim is grounded', async () => {
    expect(await R20.evaluate({ ...ctx(), config: DEFAULT_RULE_CONFIG } as any))
      .toHaveLength(0);
  });

  it('blocks on an ungrounded numeric claim', async () => {
    const resume = baseResume();
    resume.experience[0].bullets.push('Increased revenue by 87%.');
    const flags = await R20.evaluate({ ...ctx({ resume }), config: DEFAULT_RULE_CONFIG } as any);
    expect(flags).toHaveLength(1);
    expect(flags[0].code).toBe('FACT_BANK_MISS');
    expect(flags[0].blocking).toBe(true);
  });

  it('blocks on an unverified matching entry when requireVerified', async () => {
    const unverified: FactBankEntry[] = [
      ...bank,
      { id: 'f9', kind: 'metric', value: '87%', numeric: 87, unit: '%', verified: false },
    ];
    const resume = baseResume();
    resume.experience[0].bullets.push('Increased revenue by 87%.');
    const flags = await R20.evaluate({
      ...ctx({ resume, factBank: unverified }),
      config: DEFAULT_RULE_CONFIG,
    } as any);
    expect(flags[0].code).toBe('FACT_BANK_UNVERIFIED');
    expect(flags[0].blocking).toBe(true);
  });
});

describe('Validator — full pass', () => {
  it('returns passed=true and no blocking failures on a clean resume', async () => {
    const v = new RuleValidator();
    const result = await v.validate(ctx());
    expect(result.blockingFailures).toHaveLength(0);
    expect(result.passed).toBe(true);
    expect(result.ruleResults).toHaveLength(20);
  });
});
