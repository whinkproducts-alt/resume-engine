// apps/api/src/routes/admin-2fa.ts
// Victor sign-off item 5: enrollment is POST /admin/2fa/enroll (not GET).
// Victor sign-off item 6: the bootstrap token arrives in X-Bootstrap-Token.

import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { authenticator } from 'otplib';
import { toDataURL } from 'qrcode';

export interface TwoFaStore {
  findAdmin(adminId: string): Promise<{ id: string; email: string; totpSecret?: string | null } | null>;
  saveEnrollment(adminId: string, secret: string, recoveryCodes: string[]): Promise<void>;
}

export interface Admin2faDeps {
  admins: TwoFaStore;
  bootstrapToken: string;
  issuer?: string;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Header-based bootstrap authentication for first-run 2FA enrollment. */
export function requireBootstrapToken(expected: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const provided = req.header('X-Bootstrap-Token');
    if (!provided || !safeEqual(provided, expected)) {
      res.status(401).json({
        error: {
          code: 'INVALID_BOOTSTRAP_TOKEN',
          message: 'X-Bootstrap-Token header missing or invalid.',
        },
      });
      return;
    }
    next();
  };
}

function generateRecoveryCodes(count = 8): string[] {
  const out: string[] = [];
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < count; i++) {
    let code = '';
    for (let j = 0; j < 10; j++) {
      if (j === 5) code += '-';
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    out.push(code);
  }
  return out;
}

export function createAdmin2faRouter(deps: Admin2faDeps): Router {
  const router = Router();
  const issuer = deps.issuer ?? 'Resume Engine';

  /** POST /admin/2fa/enroll */
  router.post(
    '/2fa/enroll',
    requireBootstrapToken(deps.bootstrapToken),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const adminId = String(req.body?.adminId ?? '');
        if (!adminId) {
          res.status(400).json({
            error: { code: 'ADMIN_ID_REQUIRED', message: 'adminId is required.' },
          });
          return;
        }

        const admin = await deps.admins.findAdmin(adminId);
        if (!admin) {
          res.status(404).json({
            error: { code: 'ADMIN_NOT_FOUND', message: `Admin ${adminId} not found.` },
          });
          return;
        }
        if (admin.totpSecret) {
          res.status(409).json({
            error: {
              code: 'ALREADY_ENROLLED',
              message: '2FA is already enrolled for this admin.',
            },
          });
          return;
        }

        const secret = authenticator.generateSecret();
        const otpauth = authenticator.keyuri(admin.email, issuer, secret);
        const qrDataUrl = await toDataURL(otpauth);
        const recoveryCodes = generateRecoveryCodes();

        await deps.admins.saveEnrollment(admin.id, secret, recoveryCodes);

        res.status(201).json({
          adminId: admin.id,
          issuer,
          account: admin.email,
          secret,
          otpauth,
          qrDataUrl,
          recoveryCodes,
          note: 'Store recovery codes offline. Secret is shown once.',
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
