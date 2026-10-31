import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { authenticator } from 'otplib';
import { Admin2faService } from '../src/admin/admin-2fa.service';
import { AuditService } from '../src/admin/audit.service';
import { decryptSecret, encryptSecret, generateRecoveryCodes, sha256Hex } from '../src/common/crypto';
import { FakePrisma } from './fake-prisma';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('crypto', () => {
  const saved = process.env.TOTP_ENCRYPTION_KEY;
  beforeEach(() => { process.env.TOTP_ENCRYPTION_KEY = KEY; });
  afterEach(() => { process.env.TOTP_ENCRYPTION_KEY = saved; });

  it('round trips and uses a fresh IV each time', () => {
    const a = encryptSecret('JBSWY3DPEHPK3PXP');
    const b = encryptSecret('JBSWY3DPEHPK3PXP');
    expect(a).not.toEqual(b);
    expect(decryptSecret(a)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('detects tampering', () => {
    const buf = Buffer.from(encryptSecret('secret'), 'base64');
    buf[buf.length - 1] = (buf[buf.length - 1] ?? 0) ^ 1;
    expect(() => decryptSecret(buf.toString('base64'))).toThrow();
  });

  it('fails clearly without a valid key', () => {
    delete process.env.TOTP_ENCRYPTION_KEY;
    expect(() => encryptSecret('x')).toThrowError(/TOTP_ENCRYPTION_KEY/);
    process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
    expect(() => encryptSecret('x')).toThrowError(/32 bytes/);
  });

  it('generates distinct, well formed recovery codes', () => {
    const codes = generateRecoveryCodes(8);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
  });
});

describe('Admin2faService', () => {
  const saved = process.env.TOTP_ENCRYPTION_KEY;
  let db: FakePrisma;
  let svc: Admin2faService;

  beforeEach(() => {
    process.env.TOTP_ENCRYPTION_KEY = KEY;
    db = new FakePrisma();
    svc = new Admin2faService(db.asService(), new AuditService(db.asService()));
    db.user.rows.push(
      { id: 'admin1', email: 'admin@example.com', isAdmin: true, totpSecretEnc: null, totpEnabledAt: null, totpRecoveryHashes: [] },
      { id: 'user1', email: 'user@example.com', isAdmin: false },
    );
  });
  afterEach(() => { process.env.TOTP_ENCRYPTION_KEY = saved; });

  it('enrolls: returns the seed once, stores it encrypted and recovery codes hashed, audits', async () => {
    const out = await svc.enroll('admin1', { ip: '1.2.3.4' });
    expect(out.otpauth).toContain('otpauth://totp/');
    expect(out.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(out.recoveryCodes).toHaveLength(8);

    const row = db.user.rows[0]!;
    expect(row.totpSecretEnc).toBeTruthy();
    expect(row.totpSecretEnc).not.toContain(out.secret);
    expect(decryptSecret(row.totpSecretEnc)).toBe(out.secret);
    expect(row.totpRecoveryHashes).toEqual(out.recoveryCodes.map(sha256Hex));
    expect(JSON.stringify(row)).not.toContain(out.recoveryCodes[0]);
    expect(row.totpEnabledAt).toBeNull();
    expect(db.adminAction.rows[0]).toMatchObject({ adminId: 'admin1', action: 'admin.2fa.enroll', ip: '1.2.3.4' });
  });

  it('only admins can enroll', async () => {
    await expect(svc.enroll('user1')).rejects.toMatchObject({ code: 'ADMIN_NOT_FOUND', status: 404 });
    await expect(svc.enroll('missing')).rejects.toMatchObject({ status: 404 });
  });

  it('stays pending until a valid code is verified, then locks enrollment', async () => {
    const { secret } = await svc.enroll('admin1');
    await expect(svc.verify('admin1', '000000')).rejects.toMatchObject({ code: 'INVALID_TOTP', status: 401 });
    expect(db.user.rows[0]!.totpEnabledAt).toBeNull();
    expect(db.adminAction.rows.at(-1)).toMatchObject({ action: 'admin.2fa.verify_failed' });

    await expect(svc.verify('admin1', authenticator.generate(secret))).resolves.toEqual({ adminId: 'admin1', enabled: true });
    expect(db.user.rows[0]!.totpEnabledAt).toBeInstanceOf(Date);
    await expect(svc.enroll('admin1')).rejects.toMatchObject({ code: 'ALREADY_ENROLLED', status: 409 });
    await expect(svc.verify('admin1', authenticator.generate(secret))).rejects.toMatchObject({ code: 'ALREADY_ENROLLED' });
  });

  it('a pending enrollment can be restarted and the old seed stops working', async () => {
    const first = await svc.enroll('admin1');
    const second = await svc.enroll('admin1');
    expect(second.secret).not.toBe(first.secret);
    await expect(svc.verify('admin1', authenticator.generate(first.secret))).rejects.toMatchObject({ code: 'INVALID_TOTP' });
    await expect(svc.verify('admin1', authenticator.generate(second.secret))).resolves.toMatchObject({ enabled: true });
  });

  it('verify before enroll is a 409', async () => {
    await expect(svc.verify('admin1', '123456')).rejects.toMatchObject({ code: 'NOT_ENROLLED', status: 409 });
  });
});
