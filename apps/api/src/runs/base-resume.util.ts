/**
 * Required by the Stage 1 schema contract:
 * Run.baseResumeId is required. When POST /runs is implemented (Stage 2),
 * call this helper so a missing baseResumeId defaults to the profile's
 * active BaseResume (isActive = true).
 */

import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors/app-error';

export async function resolveBaseResumeId(
  prisma: PrismaService,
  profileId: string,
  provided?: string | null,
): Promise<string> {
  if (provided) return provided;

  const active = await prisma.baseResume.findFirst({
    where: { profileId, isActive: true },
    orderBy: { version: 'desc' },
  });

  if (!active) {
    throw new AppError(
      'BASE_RESUME_REQUIRED',
      422,
      'No active base resume exists for this profile.',
    );
  }

  return active.id;
}
