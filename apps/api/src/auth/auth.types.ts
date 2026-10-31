import type { UserRole } from '@prisma/client';

export interface AuthUser {
  id: string;
  role: UserRole;
  isAdmin: boolean;
  jti?: string;
}
