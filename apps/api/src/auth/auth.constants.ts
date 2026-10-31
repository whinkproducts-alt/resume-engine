import * as argon2 from 'argon2';
import { createHash } from 'crypto';

export const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
};

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 30;

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function assertPasswordPolicy(password: string): void {
  const ok =
    password.length >= 12 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password);
  if (!ok) {
    throw new Error(
      'Password must be at least 12 characters and contain upper, lower, digit and symbol.',
    );
  }
}
