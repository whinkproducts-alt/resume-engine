// apps/api/src/facts/facts.service.ts
// Fact bank (01-SPEC-v3.md section 7.4). A fact is a claim the résumé may repeat.
// In strict mode every number in a generated résumé must match a verified fact
// (the FACTS check in packages/rules), so these entries are what unlock metrics.

import { Injectable } from '@nestjs/common';
import { isBareYear, scanNumericTokens, splitSentences } from '@resume-engine/rules';
import { AppError } from '../common/errors/app-error';
import type { AuthUser } from '../auth/auth.types';
import { isParsableMetric } from '../pipeline/facts';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateFactDto, FactKindName, UpdateFactDto } from './dto/fact.dto';

const MAX_IMPORT = 200;

export const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t ? t : null;
};

@Injectable()
export class FactsService {
  constructor(private readonly prisma: PrismaService) {}

  private async ownedProfile(user: AuthUser, profileId: string) {
    const p = await this.prisma.profile.findFirst({ where: { id: profileId, userId: user.id } });
    if (!p) throw new AppError('PROFILE_NOT_FOUND', 404);
    return p;
  }

  /** A fact is reached through its profile, so another user's fact is a 404. */
  private async ownedFact(user: AuthUser, factId: string) {
    const fact = await this.prisma.factBankEntry.findFirst({ where: { id: factId } });
    if (!fact) throw new AppError('FACT_NOT_FOUND', 404);
    const profile = await this.prisma.profile.findFirst({ where: { id: fact.profileId, userId: user.id } });
    if (!profile) throw new AppError('FACT_NOT_FOUND', 404);
    return fact;
  }

  private assertMetric(kind: string, value: string | null) {
    if (kind === 'metric' && !isParsableMetric(value)) {
      throw new AppError('INVALID_METRIC', 422,
        'A metric needs a metricValue that is a number, such as "40", "1.2" or "2M".');
    }
  }

  async list(user: AuthUser, profileId: string, q: { kind?: FactKindName; verified?: 'true' | 'false' }) {
    await this.ownedProfile(user, profileId);
    return this.prisma.factBankEntry.findMany({
      where: {
        profileId,
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.verified ? { verified: q.verified === 'true' } : {}),
      },
      orderBy: [{ verified: 'desc' }, { claimText: 'asc' }],
    });
  }

  async create(user: AuthUser, profileId: string, dto: CreateFactDto) {
    await this.ownedProfile(user, profileId);
    const metricValue = clean(dto.metricValue);
    this.assertMetric(dto.kind, metricValue);

    if (dto.roleId) {
      const role = await this.prisma.roleEntry.findFirst({ where: { id: dto.roleId, profileId } });
      if (!role) throw new AppError('ROLE_NOT_FOUND', 404, 'That role is not on this profile.');
    }
    return this.prisma.factBankEntry.create({
      data: {
        profileId,
        roleId: dto.roleId ?? null,
        kind: dto.kind,
        claimText: dto.claimText.trim(),
        metricValue,
        metricUnit: clean(dto.metricUnit),
        context: dto.context.trim(),
        employer: clean(dto.employer),
        verified: dto.verified ?? false,
        sourceNote: clean(dto.sourceNote),
      },
    });
  }

  /**
   * Editing what a fact says withdraws its verification, unless the caller says
   * otherwise in the same request. Otherwise a verified "40%" could be changed to
   * "90%" without anyone looking at it again.
   */
  async update(user: AuthUser, factId: string, dto: UpdateFactDto) {
    const fact = await this.ownedFact(user, factId);
    const kind = dto.kind ?? fact.kind;
    const metricValue = dto.metricValue !== undefined ? clean(dto.metricValue) : fact.metricValue;
    this.assertMetric(kind, metricValue);

    const changesClaim =
      (dto.claimText !== undefined && dto.claimText.trim() !== fact.claimText) ||
      (dto.metricValue !== undefined && metricValue !== fact.metricValue) ||
      (dto.metricUnit !== undefined && clean(dto.metricUnit) !== fact.metricUnit) ||
      (dto.kind !== undefined && dto.kind !== fact.kind);

    return this.prisma.factBankEntry.update({
      where: { id: factId },
      data: {
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
        ...(dto.claimText !== undefined ? { claimText: dto.claimText.trim() } : {}),
        ...(dto.metricValue !== undefined ? { metricValue } : {}),
        ...(dto.metricUnit !== undefined ? { metricUnit: clean(dto.metricUnit) } : {}),
        ...(dto.context !== undefined ? { context: dto.context.trim() } : {}),
        ...(dto.employer !== undefined ? { employer: clean(dto.employer) } : {}),
        ...(dto.sourceNote !== undefined ? { sourceNote: clean(dto.sourceNote) } : {}),
        verified: dto.verified !== undefined ? dto.verified : changesClaim ? false : fact.verified,
      },
    });
  }

  async remove(user: AuthUser, factId: string) {
    await this.ownedFact(user, factId);
    await this.prisma.factBankEntry.delete({ where: { id: factId } });
  }

  /** POST /profiles/:id/facts/verify. Ids that are not on this profile are reported, not guessed at. */
  async verify(user: AuthUser, profileId: string, factIds: string[]) {
    await this.ownedProfile(user, profileId);
    const ids = [...new Set(factIds)];
    const found = await this.prisma.factBankEntry.findMany({ where: { profileId, id: { in: ids } } });
    const foundIds = new Set(found.map((f) => f.id));
    if (foundIds.size > 0) {
      await this.prisma.factBankEntry.updateMany({
        where: { profileId, id: { in: [...foundIds] } },
        data: { verified: true },
      });
    }
    return { verified: foundIds.size, notFound: ids.filter((id) => !foundIds.has(id)) };
  }

  /**
   * POST /profiles/:id/facts/import-from-base. Proposes one unverified metric per
   * number found in the base résumé's text, with the sentence it came from. Nothing
   * counts as grounded until a person verifies it.
   */
  async importFromBase(user: AuthUser, profileId: string, baseResumeId: string) {
    await this.ownedProfile(user, profileId);
    const base = await this.prisma.baseResume.findFirst({ where: { id: baseResumeId, profileId } });
    if (!base) throw new AppError('BASE_RESUME_NOT_FOUND', 404);

    const text = ((base.parsedJson ?? {}) as { text?: unknown }).text;
    if (typeof text !== 'string' || !text.trim()) {
      throw new AppError('EMPTY_DOCUMENT', 422, 'The base résumé has no extracted text.');
    }

    const existing = await this.prisma.factBankEntry.findMany({ where: { profileId } });
    const seen = new Set(existing.map((f) => `${f.claimText}|${f.metricValue ?? ''}|${(f.metricUnit ?? '').toLowerCase()}`));

    const proposals: { claimText: string; metricValue: string; metricUnit: string | null }[] = [];
    for (const line of text.split(/\r?\n/)) {
      for (const sentence of splitSentences(line)) {
        const claimText = sentence.slice(0, 500);
        for (const token of scanNumericTokens(sentence)) {
          if (isBareYear(token)) continue;
          const metricValue = token.raw.replace(/\s+/g, '').replace(/[a-zA-Z%$]+$/, '').replace(/,/g, '') || String(token.numeric);
          const metricUnit = token.unit;
          const key = `${claimText}|${metricValue}|${(metricUnit ?? '').toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          proposals.push({ claimText, metricValue, metricUnit });
        }
      }
    }

    const toCreate = proposals.slice(0, MAX_IMPORT);
    if (toCreate.length > 0) {
      await this.prisma.factBankEntry.createMany({
        data: toCreate.map((p) => ({
          profileId,
          kind: 'metric',
          claimText: p.claimText,
          metricValue: p.metricValue,
          metricUnit: p.metricUnit,
          context: `Imported from base résumé v${base.version}`,
          verified: false,
          sourceNote: `${base.fileName} (v${base.version})`,
        })),
      });
    }
    return {
      created: toCreate.length,
      truncated: Math.max(0, proposals.length - MAX_IMPORT),
    };
  }
}
