import type { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { ARGON2_OPTIONS } from './auth.constants';

export async function ensureAdmin(prisma: PrismaClient): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  if (!email) return;

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    if (!existing.isAdmin) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { isAdmin: true, adminUnlimited: true, role: 'ADMIN' },
      });
    }
    return;
  }

  const password = process.env.ADMIN_SEED_PASSWORD;
  if (!password) throw new Error('ADMIN_SEED_PASSWORD required on first boot');

  await prisma.user.create({
    data: {
      email,
      passwordHash: await argon2.hash(password, ARGON2_OPTIONS),
      firstName: 'Victor',
      lastName: 'Igboekwe',
      role: 'ADMIN',
      isAdmin: true,
      adminUnlimited: true,
      emailVerified: true,
      mustChangePassword: process.env.NODE_ENV === 'production',
    },
  });
}
