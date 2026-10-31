// apps/api/src/admin/admin-2fa.service.ts
// Admin TOTP enrollment (Victor sign-off: POST /admin/2fa/enroll, bootstrap token in
// the X-Bootstrap-Token header). Ported from Part 3's Express router.
//
// Differences from the Part 3 version:
//  - The seed is persisted (User.totpSecretEnc, AES-256-GCM) in a migration-backed column.
//  - Recovery codes come from a CSPRNG and are stored hashed.
//  - Enrollment is pending until a valid code is posted to /admin/2fa/verify.
//  - Every step is written to AdminAction.

import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import { toDataURL } from 'qrcode';
import { AppError } from '../common/errors/app-error';
import { decryptSecret, encryptSecret, generateRecoveryCodes, sha256Hex } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

export const TOTP_ISSUER = 'Resume Engine';

export interface RequestMeta { ip?: string; userAgent?: string }

@Injectable()
export class Admin2faService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async admin(adminId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!user || !user.isAdmin) {
      throw new AppError('ADMIN_NOT_FOUND', 404, `Admin ${adminId} not found.`);
    }
    return user;
  }

  async enroll(adminId: string, meta: RequestMeta = {}) {
    const user = await this.admin(adminId);
    if (user.totpEnabledAt) {
      throw new AppError('ALREADY_ENROLLED', 409, '2FA is already enrolled for this admin.');
    }

    const secret = authenticator.generateSecret();
    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        totpSecretEnc: encryptSecret(secret),
        totpRecoveryHashes: recoveryCodes.map(sha256Hex),
        totpEnabledAt: null,
      },
    });
    await this.audit.record({
      adminId: user.id, targetUserId: user.id, action: 'admin.2fa.enroll', ...meta,
    });

    const otpauth = authenticator.keyuri(user.email, TOTP_ISSUER, secret);
    return {
      adminId: user.id,
      issuer: TOTP_ISSUER,
      account: user.email,
      secret,
      otpauth,
      qrDataUrl: await toDataURL(otpauth),
      recoveryCodes,
      note: 'Store recovery codes offline. The secret is shown once. Confirm with POST /admin/2fa/verify.',
    };
  }

  async verify(adminId: string, code: string, meta: RequestMeta = {}) {
    const user = await this.admin(adminId);
    if (!user.totpSecretEnc) {
      throw new AppError('NOT_ENROLLED', 409, 'Start enrollment first (POST /admin/2fa/enroll).');
    }
    if (user.totpEnabledAt) {
      throw new AppError('ALREADY_ENROLLED', 409, '2FA is already enabled.');
    }
    const ok = authenticator.check(code.trim(), decryptSecret(user.totpSecretEnc));
    await this.audit.record({
      adminId: user.id, targetUserId: user.id,
      action: ok ? 'admin.2fa.verify' : 'admin.2fa.verify_failed', ...meta,
    });
    if (!ok) throw new AppError('INVALID_TOTP', 401, 'The code is not valid.');

    await this.prisma.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date() } });
    return { adminId: user.id, enabled: true };
  }
}
