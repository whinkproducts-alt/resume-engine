import { describe, it, expect } from 'vitest';
import { QuotaService, currentPeriod, type QuotaUser } from '../src/runs/quota.service';
import { FakePrisma } from './fake-prisma';

const user = (over: Partial<QuotaUser> = {}): QuotaUser => ({
  id: 'u1', role: 'USER', isAdmin: false, adminUnlimited: false, ...over,
});

function setup() {
  const db = new FakePrisma();
  return { db, quota: new QuotaService(db.asService()) };
}

describe('QuotaService (stage 0)', () => {
  it('lets an unlimited admin and an AGENCY user through without touching counters', async () => {
    const { db, quota } = setup();
    await quota.assertCanRun(user({ role: 'ADMIN', isAdmin: true, adminUnlimited: true }));
    await quota.assertCanRun(user({ role: 'AGENCY' }));
    await quota.consume(user({ role: 'AGENCY' }), db as any);
    expect(db.usageCounter.rows).toEqual([]);
    expect(db.runCredit.rows).toEqual([]);
  });

  it('does not bypass for an admin without adminUnlimited', async () => {
    const { quota } = setup();
    await expect(quota.assertCanRun(user({ isAdmin: true }))).rejects.toMatchObject({ code: 'NO_CREDITS', status: 402 });
  });

  it('PRO: 10 runs a month, the 11th is refused', async () => {
    const { db, quota } = setup();
    const pro = user({ role: 'PRO' });
    for (let i = 0; i < 10; i++) {
      await quota.assertCanRun(pro);
      await quota.consume(pro, db as any);
    }
    expect(db.usageCounter.rows[0]).toMatchObject({ period: currentPeriod(), runsUsed: 10 });
    await expect(quota.assertCanRun(pro)).rejects.toMatchObject({ code: 'RUN_LIMIT_REACHED', status: 402 });
  });

  it('PRO: a new month starts a new counter', async () => {
    const { db, quota } = setup();
    db.usageCounter.rows.push({ userId: 'u1', period: '2020-01', runsUsed: 10 });
    await expect(quota.assertCanRun(user({ role: 'PRO' }))).resolves.toBeUndefined();
  });

  it('USER: needs a credit; spends the one that expires soonest; ignores expired credits', async () => {
    const { db, quota } = setup();
    const u = user();
    await expect(quota.assertCanRun(u)).rejects.toMatchObject({ code: 'NO_CREDITS' });

    const day = 86_400_000;
    db.runCredit.rows.push(
      { id: 'expired', userId: 'u1', remaining: 5, expiresAt: new Date(Date.now() - day), createdAt: new Date(0) },
      { id: 'later', userId: 'u1', remaining: 1, expiresAt: new Date(Date.now() + 10 * day), createdAt: new Date(1) },
      { id: 'soon', userId: 'u1', remaining: 1, expiresAt: new Date(Date.now() + day), createdAt: new Date(2) },
    );
    await expect(quota.remainingCredits('u1')).resolves.toBe(2);
    await quota.consume(u, db as any);
    expect(db.runCredit.rows.find((r) => r.id === 'soon')?.remaining).toBe(0);
    expect(db.runCredit.rows.find((r) => r.id === 'later')?.remaining).toBe(1);
    expect(db.runCredit.rows.find((r) => r.id === 'expired')?.remaining).toBe(5);
  });
});
