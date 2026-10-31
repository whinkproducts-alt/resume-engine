// apps/api/src/common/crypto.ts
// AES-256-GCM for secrets at rest (TOTP seeds) and CSPRNG recovery codes.

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';
import { AppError } from './errors/app-error';

function key(): Buffer {
  const raw = process.env.TOTP_ENCRYPTION_KEY;
  if (!raw) {
    throw new AppError('TOTP_NOT_CONFIGURED', 500, 'TOTP_ENCRYPTION_KEY is not set.');
  }
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) {
    throw new AppError('TOTP_NOT_CONFIGURED', 500, 'TOTP_ENCRYPTION_KEY must be 32 bytes, base64 encoded.');
  }
  return k;
}

/** Output: base64(iv ‖ tag ‖ ciphertext). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decryptSecret(blob: string): string {
  const buf = Buffer.from(blob, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** e.g. "K7M2P-9XQ4R". randomInt is cryptographically secure. */
export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const pick = () => ALPHABET[randomInt(ALPHABET.length)] as string;
    return `${Array.from({ length: 5 }, pick).join('')}-${Array.from({ length: 5 }, pick).join('')}`;
  });
}
