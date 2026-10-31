import { describe, it, expect, beforeEach } from 'vitest';
import { RunsService, presentFlag } from '../src/runs/runs.service';
import { QuotaService } from '../src/runs/quota.service';
import type { QueueService } from '../src/runs/queue.service';
import type { StorageService } from '../src/runs/storage.service';
import type { AuthUser } from '../src/auth/auth.types';
import { FakePrisma } from './fake-prisma';

const alice: AuthUser = { id: 'alice', role: 'PRO', isAdmin: false };
const bob: AuthUser = { id: 'bob', role: 'PRO', isAdmin: false };

function setup() {
  const db = new FakePrisma();
  const enqueued: unknown[] = [];
  const queue = { enqueue: async (d: unknown) => { enqueued.push(d); } } as unknown as QueueService;
  const storage = {
    ref: async (key: string) => ({ url: `https://signed.test/${key}`, expiresAt: '2026-10-31T00:15:00Z' }),
  } as unknown as StorageService;
  const svc = new RunsService(db.asService(), new QuotaService(db.asService()), queue, storage);

  db.user.rows.push(
    { id: 'alice', role: 'PRO', isAdmin: false, adminUnlimited: false },
    { id: 'bob', role: 'PRO', isAdmin: false, adminUnlimited: false },
  );
  // the database applies the schema defaults for UserSettings; the fake needs them seeded
  db.userSettings.rows.push({
    userId: 'alice', strictFactsMode: true, flagAndInclude: false, lockCompanyNames: true,
    lockEmploymentDates: true, blockOnUnusableJD: true, inferCompanyName: true,
    banHyphensInProse: true, consultingFraming: false, whinkGroupFraming: false, heritageLineDefault: false,
  });
  db.profile.rows.push({ id: 'p1', name: 'Primary', userId: 'alice', settings: null });
  db.baseResume.rows.push({ id: 'b1', profileId: 'p1', isActive: true, version: 1 });
  db.jobDescription.rows.push({ id: 'j1', userId: 'alice', profileId: 'p1', company: 'Acme' });
  return { db, svc, enqueued };
}

describe('RunsService.create', () => {
  it('creates a queued run, snapshots settings, spends quota, and enqueues', async () => {
    const { db, svc, enqueued } = setup();
    const out = await svc.create(alice, {
      profileId: 'p1', jdId: 'j1', contactLocationOverride: ' London, UK ',
      settingsOverride: { strictFactsMode: false, hacker: true as boolean, banHyphensInProse: 'yes' as unknown as boolean },
    });

    expect(out.status).toBe('QUEUED');
    expect(out.eventsUrl).toBe(`/v1/runs/${out.runId}/events`);
    expect(enqueued).toEqual([{ runId: out.runId }]);

    const run = db.run.rows[0]!;
    expect(run).toMatchObject({
      userId: 'alice', profileId: 'p1', baseResumeId: 'b1', ruleSetId: 'ruleset-1',
      jdId: 'j1', planTier: 'PRO', status: 'QUEUED', contactLocationOverride: 'London, UK',
    });
    // only known boolean toggles are honoured
    expect(run.settingsSnap.toggles.strictFactsMode).toBe(false);
    expect(run.settingsSnap.toggles.banHyphensInProse).toBe(true);
    expect(run.settingsSnap.userSettings.hacker).toBeUndefined();
    expect(db.usageCounter.rows[0]).toMatchObject({ userId: 'alice', runsUsed: 1 });
  });

  it('refuses at the quota with 402 and leaves nothing behind', async () => {
    const { db, svc, enqueued } = setup();
    db.usageCounter.rows.push({ userId: 'alice', period: new Date().toISOString().slice(0, 7), runsUsed: 10 });
    await expect(svc.create(alice, { profileId: 'p1', jdId: 'j1' }))
      .rejects.toMatchObject({ code: 'RUN_LIMIT_REACHED', status: 402 });
    expect(db.run.rows).toEqual([]);
    expect(enqueued).toEqual([]);
  });

  it('does not reveal other users profiles or job descriptions (404)', async () => {
    const { svc } = setup();
    await expect(svc.create(bob, { profileId: 'p1', jdId: 'j1' })).rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND', status: 404 });
  });

  it('requires an active base resume', async () => {
    const { db, svc } = setup();
    db.baseResume.rows.length = 0;
    await expect(svc.create(alice, { profileId: 'p1', jdId: 'j1' })).rejects.toMatchObject({ code: 'BASE_RESUME_REQUIRED' });
  });
});

describe('RunsService lifecycle', () => {
  let ctx: ReturnType<typeof setup>;
  let runId: string;
  beforeEach(async () => {
    ctx = setup();
    runId = (await ctx.svc.create(alice, { profileId: 'p1', jdId: 'j1' })).runId;
    ctx.enqueued.length = 0;
  });

  it("another user's run is a 404 on every read and action, never a 403", async () => {
    for (const call of [
      () => ctx.svc.get(bob, runId), () => ctx.svc.output(bob, runId), () => ctx.svc.validation(bob, runId),
      () => ctx.svc.artifact(bob, runId, 'pdf'), () => ctx.svc.cancel(bob, runId),
      () => ctx.svc.retry(bob, runId), () => ctx.svc.remove(bob, runId),
      () => ctx.svc.confirmCompany(bob, runId, 'Acme'),
    ]) {
      await expect(call()).rejects.toMatchObject({ status: 404 });
    }
  });

  it('confirm-company: only while awaiting, enqueues stage 4 once', async () => {
    await expect(ctx.svc.confirmCompany(alice, runId, 'Acme Corp')).rejects.toMatchObject({ code: 'RUN_NOT_AWAITING_CONFIRM', status: 409 });

    Object.assign(ctx.db.run.rows[0]!, { status: 'AWAITING_COMPANY_CONFIRM' });
    Object.assign(ctx.db.jobDescription.rows[0]!, { company: 'Strype', companyInferred: true });

    await expect(ctx.svc.confirmCompany(alice, runId, 'x')).rejects.toMatchObject({ code: 'INVALID_COMPANY' });
    await expect(ctx.svc.confirmCompany(alice, runId, ' Stripe ')).resolves.toEqual({ runId, status: 'REWRITING' });

    expect(ctx.enqueued).toEqual([{ runId, resumeFrom: 'rewrite' }]);
    expect(ctx.db.jobDescription.rows[0]).toMatchObject({ company: 'Stripe', companyInferred: false, companyConfidence: 1 });
    expect(ctx.db.run.rows[0]).toMatchObject({ companyConfirmed: true, status: 'REWRITING' });

    // a second click cannot enqueue again
    await expect(ctx.svc.confirmCompany(alice, runId, 'Stripe')).rejects.toMatchObject({ status: 409 });
    expect(ctx.enqueued).toHaveLength(1);
  });

  it('retry: only failed runs, does not spend another run', async () => {
    await expect(ctx.svc.retry(alice, runId)).rejects.toMatchObject({ code: 'RUN_NOT_RETRYABLE' });
    Object.assign(ctx.db.run.rows[0]!, { status: 'FAILED', errorCode: 'PIPELINE_ERROR' });
    await expect(ctx.svc.retry(alice, runId)).resolves.toEqual({ runId, status: 'QUEUED' });
    expect(ctx.db.run.rows[0]).toMatchObject({ status: 'QUEUED', errorCode: null });
    expect(ctx.enqueued).toEqual([{ runId }]);
    expect(ctx.db.usageCounter.rows[0]!.runsUsed).toBe(1);
  });

  it('cancel and delete', async () => {
    await expect(ctx.svc.remove(alice, runId)).rejects.toMatchObject({ code: 'RUN_IN_PROGRESS' });
    await expect(ctx.svc.cancel(alice, runId)).resolves.toEqual({ runId, status: 'CANCELLED' });
    await expect(ctx.svc.cancel(alice, runId)).rejects.toMatchObject({ code: 'RUN_NOT_CANCELLABLE' });
    await ctx.svc.remove(alice, runId);
    expect(ctx.db.run.rows).toEqual([]);
  });

  it('reads: pendingCompany only while awaiting; output and artifacts 409 until ready', async () => {
    expect((await ctx.svc.get(alice, runId)).pendingCompany).toBeNull();
    Object.assign(ctx.db.run.rows[0]!, { status: 'AWAITING_COMPANY_CONFIRM' });
    Object.assign(ctx.db.jobDescription.rows[0]!, { company: 'Strype', companyInferred: true, companyConfidence: 0.5 });
    expect((await ctx.svc.get(alice, runId)).pendingCompany).toEqual({ name: 'Strype', inferred: true, confidence: 0.5 });

    await expect(ctx.svc.output(alice, runId)).rejects.toMatchObject({ code: 'OUTPUT_NOT_READY', status: 409 });
    await expect(ctx.svc.artifact(alice, runId, 'docx')).rejects.toMatchObject({ code: 'DOCX_NOT_READY', status: 409 });
    await expect(ctx.svc.validation(alice, runId)).rejects.toMatchObject({ code: 'VALIDATION_NOT_READY' });

    Object.assign(ctx.db.run.rows[0]!, { docxKey: 'runs/x/a.docx', pdfKey: 'runs/x/a.pdf', outputJson: { ok: 1 }, validation: { passed: true } });
    await expect(ctx.svc.artifact(alice, runId, 'pdf')).resolves.toEqual({ url: 'https://signed.test/runs/x/a.pdf', expiresAt: '2026-10-31T00:15:00Z' });
    await expect(ctx.svc.output(alice, runId)).resolves.toMatchObject({ outputJson: { ok: 1 }, targetCompanies: [] });
  });

  it('list: paginates with a cursor and validates the status filter', async () => {
    for (let i = 0; i < 2; i++) await ctx.svc.create(alice, { profileId: 'p1', jdId: 'j1' });
    const first = await ctx.svc.list(alice, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = await ctx.svc.list(alice, { limit: 2, cursor: first.nextCursor as string });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    await expect(ctx.svc.list(alice, { status: 'NOPE' })).rejects.toMatchObject({ code: 'INVALID_STATUS' });
    await expect(ctx.svc.list(bob, {})).resolves.toMatchObject({ items: [] });
  });
});

describe('presentFlag', () => {
  it('splits the rule id out of the stored code', () => {
    expect(presentFlag({ id: '1', code: 'R2:HEADLINE_ROLE_MISMATCH', severity: 'error', field: 'headline[0]', message: 'm' }))
      .toEqual({ id: '1', ruleId: 'R2', code: 'HEADLINE_ROLE_MISMATCH', severity: 'error', blocking: true, field: 'headline[0]', message: 'm' });
    expect(presentFlag({ id: '2', code: 'QA:PAGE_OVERFLOW', severity: 'warn', field: null, message: 'm' }))
      .toMatchObject({ ruleId: 'QA', blocking: false });
    expect(presentFlag({ id: '3', code: 'LEGACY', severity: 'info', field: null, message: 'm' }).ruleId).toBeNull();
  });
});
