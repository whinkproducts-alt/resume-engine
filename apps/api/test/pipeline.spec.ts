import { describe, it, expect } from 'vitest';
import { runPipeline, needsCompanyConfirmation, type PipelineEnv } from '../src/pipeline/run-pipeline';
import { buildFileName, dedupeKeywords, sectionForPath, groupFeedback } from '../src/pipeline/sections';
import { toEngineFact, factsForPrompt } from '../src/pipeline/facts';
import { MemoryRepo, MemoryStore, ScriptedLlm, fixtureContext, type LlmScript } from './helpers';

const models = { analyze: 'test-analyze', write: 'test-write' };

function setup(script: LlmScript = {}, ctxOver = {}) {
  const repo = new MemoryRepo(fixtureContext(ctxOver));
  const llm = new ScriptedLlm(script);
  const store = new MemoryStore();
  const env: PipelineEnv = { repo, llm, models, store };
  return { repo, llm, store, env };
}

describe('pipeline: happy path (real validator, renderer and LibreOffice)', () => {
  it('runs all stages and completes', async () => {
    const { repo, llm, store, env } = setup();
    const outcome = await runPipeline(env, { runId: 'run_test_1' });

    expect(outcome).toBe('COMPLETE');
    expect(repo.statuses).toEqual([
      'READING_JD', 'ANALYZING', 'REWRITING', 'REWRITING', 'REWRITING', 'REWRITING', 'REWRITING',
      'REWRITING', 'REWRITING', 'REWRITING', 'VALIDATING', 'RENDERING', 'EXPORTING_PDF', 'COMPLETE',
    ]);
    // one LLM call per section: analyze, headline, summary, competencies, 2 roles, keywords, targets
    expect(llm.calls).toMatchObject({
      jd_analysis: 1, headline: 1, summary: 1, competencies: 1, role: 2, keywords: 1, targets: 1,
    });

    expect(repo.completion?.status).toBe('COMPLETE');
    expect(repo.completion?.validation.blockingFailures).toEqual([]);
    expect(repo.completion?.pageCount).toBeGreaterThanOrEqual(1);
    expect(repo.completion?.keywordCount).toBeGreaterThanOrEqual(150);
    expect(repo.completion?.outputJson.meta.fileName).toBe('Jane Doe_Senior Product Manager_Stripe.docx');
    expect(repo.completion?.outputJson.experience.map((e) => e.company)).toEqual(['Acme', 'Globex']);
    expect(repo.completion?.outputJson.header.fullName).toBe('Jane Doe');

    const keys = store.puts.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining([
      'runs/run_test_1/Jane-Doe_Senior-Product-Manager_Stripe.docx',
      'runs/run_test_1/Jane-Doe_Senior-Product-Manager_Stripe.pdf',
      'runs/run_test_1/validation.json',
    ]));
    expect(store.puts.find((p) => p.key.endsWith('.pdf'))?.size).toBeGreaterThan(1000);
    expect(repo.logs.filter((l) => l.status === 'error')).toEqual([]);
  }, 120_000);

  it('applies the contact location override to the header city only', async () => {
    const { repo, env } = setup({}, {});
    repo.ctx.run.contactLocationOverride = 'London, UK';
    expect(await runPipeline(env, { runId: 'run_test_1' })).toBe('COMPLETE');
    expect(repo.completion?.outputJson.header.city).toBe('London, UK');
  }, 120_000);
});

describe('pipeline: company confirmation (stage 3)', () => {
  it('pauses, then resumes at stage 4 without re-analysing', async () => {
    const { repo, llm, env } = setup({ analysis: { companyInferred: true, companyConfidence: 0.5, company: 'Strype' } });

    expect(await runPipeline(env, { runId: 'run_test_1' })).toBe('AWAITING_COMPANY_CONFIRM');
    expect(llm.calls).toEqual({ jd_analysis: 1 });
    expect(repo.completion).toBeNull();

    // what POST /runs/:id/confirm-company does
    repo.ctx.jd = { ...repo.ctx.jd, company: 'Stripe', companyInferred: false };
    repo.ctx.run.companyConfirmed = true;

    expect(await runPipeline(env, { runId: 'run_test_1', resumeFrom: 'rewrite' })).toBe('COMPLETE');
    expect(llm.calls['jd_analysis']).toBe(1);               // not analysed a second time
    expect(repo.completion?.outputJson.meta.company).toBe('Stripe');
  }, 120_000);

  it('decides on inferred company or confidence under 0.75', () => {
    expect(needsCompanyConfirmation({ companyInferred: true, companyConfidence: 0.99 })).toBe(true);
    expect(needsCompanyConfirmation({ companyInferred: false, companyConfidence: 0.74 })).toBe(true);
    expect(needsCompanyConfirmation({ companyInferred: false, companyConfidence: 0.75 })).toBe(false);
  });
});

describe('pipeline: validation and retry (stage 6)', () => {
  it('regenerates only the failing section, then passes', async () => {
    const { repo, llm, env } = setup({
      headline: (n) => n === 1
        ? { roleLine: 'PRODUCT MANAGER', industryLine: 'Fintech platforms and payments — global' }
        : { roleLine: 'PRODUCT MANAGER', industryLine: 'Fintech platforms and payments' },
    });
    expect(await runPipeline(env, { runId: 'run_test_1' })).toBe('COMPLETE');
    expect(llm.calls['headline']).toBe(2);                  // regenerated once
    expect(llm.calls['summary']).toBe(1);                   // untouched
    expect(llm.calls['role']).toBe(2);
    expect(repo.completion?.validation.attempt).toBe(2);
    const retryReq = llm.requests.filter((r) => r.schema.name === 'headline')[1];
    expect(retryReq?.user).toContain('DASH_IN_PROSE');       // the failure was fed back
  }, 120_000);

  it('gives up after 1 + 2 attempts: FAILED, nothing rendered or uploaded', async () => {
    const { repo, store, env } = setup({
      headline: () => ({ roleLine: 'PRODUCT MANAGER', industryLine: 'Fintech — payments' }),
    });
    expect(await runPipeline(env, { runId: 'run_test_1' })).toBe('FAILED');
    expect(repo.errorCode).toBe('VALIDATION_FAILED');
    expect(repo.completion?.validation.attempt).toBe(3);
    expect(repo.completion?.docxKey).toBeNull();
    expect(store.puts).toEqual([]);
    expect(repo.flags.some((f) => f.blocking)).toBe(true);
  }, 120_000);
});

describe('pipeline: guards', () => {
  it('fails a too short job description', async () => {
    const { repo, env } = setup();
    repo.ctx.jd.rawText = 'too short';
    expect(await runPipeline(env, { runId: 'run_test_1' })).toBe('FAILED');
    expect(repo.errorCode).toBe('JD_UNUSABLE');
  });

  it('fails clearly when the profile has no roster', async () => {
    const { repo, llm, env } = setup();
    repo.ctx.profile.roles = [];
    expect(await runPipeline(env, { runId: 'run_test_1' })).toBe('FAILED');
    expect(repo.errorCode).toBe('PROFILE_ROSTER_MISSING');
    expect(llm.requests).toEqual([]);
  });

  it('does nothing for a cancelled run', async () => {
    const { repo, llm, env } = setup();
    repo.cancelled = true;
    expect(await runPipeline(env, { runId: 'run_test_1' })).toBe('CANCELLED');
    expect(llm.requests).toEqual([]);
  });

  it('rethrows unexpected errors so BullMQ can retry', async () => {
    const { env } = setup();
    env.llm = { completeJson: async () => { throw new Error('network down'); } };
    await expect(runPipeline(env, { runId: 'run_test_1' })).rejects.toThrow('network down');
  });
});

describe('helpers', () => {
  it('buildFileName always satisfies the R18 pattern', () => {
    const re = /^[a-zA-Z0-9\s\-_]+_[a-zA-Z0-9\s\-_]+_[a-zA-Z0-9\s\-_]+\.docx$/;
    for (const [a, b, c] of [['Jane Doe', 'Senior PM', 'Acme'], ['Zoë O\'Neil', 'VP, Eng_Ops', 'AT&T'], ['', '', '']]) {
      expect(buildFileName(a ?? '', b ?? '', c ?? '')).toMatch(re);
    }
  });

  it('dedupes keywords case insensitively, keeping order', () => {
    expect(dedupeKeywords(['Agile', 'agile', ' SQL ', 'sql', 'Go'])).toEqual(['Agile', 'SQL', 'Go']);
  });

  it('routes a flag path to the section that can fix it', () => {
    expect(sectionForPath('headline[1]')).toBe('headline');
    expect(sectionForPath('experience[3].bullets[2]')).toBe('role:3');
    expect(sectionForPath('targetCompanies[0].name')).toBe('targets');
    expect(sectionForPath('header.fullName')).toBeNull();
    expect(sectionForPath('meta.fileName')).toBeNull();
    const m = groupFeedback([
      { ruleId: 'R3', code: 'X', severity: 'error', blocking: true, message: 'm', path: 'headline' },
      { ruleId: 'R8', code: 'Y', severity: 'error', blocking: true, message: 'm', path: 'experience[0].flagship' },
    ]);
    expect([...m.keys()]).toEqual(['headline', 'role:0']);
  });

  it('maps database facts to engine facts', () => {
    const f = toEngineFact({ id: 'f1', kind: 'metric', claimText: 'Cut churn by 40 percent',
      metricValue: '40', metricUnit: 'percent', context: 'c', employer: null, verified: true });
    expect(f).toMatchObject({ kind: 'metric', numeric: 40, unit: '%', verified: true });
    expect(f.aliases).toContain('40percent');

    const m = toEngineFact({ id: 'f2', kind: 'metric', claimText: '2M users', metricValue: '2M',
      metricUnit: null, context: 'c', employer: null, verified: false });
    expect(m.numeric).toBe(2);
    expect(m.aliases).toContain('2M');

    expect(toEngineFact({ id: 'f3', kind: 'weird', claimText: 'x', metricValue: null,
      metricUnit: null, context: 'c', employer: null, verified: true }).kind).toBe('other');
    expect(factsForPrompt([f, m], true)).toBe('- Cut churn by 40 percent');
    expect(factsForPrompt([f, m], false)).toContain('(unverified)');
  });
});
