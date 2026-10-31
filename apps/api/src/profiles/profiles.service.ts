import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as mammoth from 'mammoth';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import type { AuthUser } from '../auth/auth.types';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { BASE_FILENAME_REGEX } from './profiles.constants';

const PROFILE_LIMITS: Record<UserRole, number | null> = {
  USER: 1,
  PRO: 3,
  AGENCY: null,
  ADMIN: null,
};

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: AuthUser, dto: CreateProfileDto) {
    const limit = PROFILE_LIMITS[user.role];
    const count = await this.prisma.profile.count({
      where: { userId: user.id },
    });

    if (limit !== null && count >= limit) {
      throw new AppError(
        'PROFILE_LIMIT_REACHED',
        402,
        `Your plan allows ${limit} profile(s).`,
      );
    }

    const isDefault = dto.isDefault ?? count === 0;

    return this.prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.profile.updateMany({
          where: { userId: user.id, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.profile.create({
        data: {
          userId: user.id,
          name: dto.name,
          headerFullName: dto.headerFullName,
          headerCity: dto.headerCity,
          headerPhones: dto.headerPhones,
          headerEmail: dto.headerEmail,
          linkedIn: dto.linkedIn ?? null,
          isDefault,
        },
      });
    });
  }

  findAll(user: AuthUser) {
    return this.prisma.profile.findMany({
      where: { userId: user.id },
      orderBy: { id: 'asc' },
      include: { settings: true },
    });
  }

  async update(user: AuthUser, profileId: string, dto: UpdateProfileDto) {
    await this.getOwnedProfile(user, profileId);

    const data: Prisma.ProfileUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.headerFullName !== undefined) data.headerFullName = dto.headerFullName;
    if (dto.headerCity !== undefined) data.headerCity = dto.headerCity;
    if (dto.headerPhones !== undefined) data.headerPhones = dto.headerPhones;
    if (dto.headerEmail !== undefined) data.headerEmail = dto.headerEmail;
    if (dto.linkedIn !== undefined) data.linkedIn = dto.linkedIn;

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault === true) {
        await tx.profile.updateMany({
          where: { userId: user.id, isDefault: true },
          data: { isDefault: false },
        });
        data.isDefault = true;
      } else if (dto.isDefault === false) {
        data.isDefault = false;
      }

      return tx.profile.update({ where: { id: profileId }, data });
    });
  }

  async uploadBase(
    user: AuthUser,
    profileId: string,
    file?: Express.Multer.File,
  ) {
    if (!file) throw new AppError('FILE_REQUIRED', 400, 'A .docx file is required.');
    await this.getOwnedProfile(user, profileId);

    if (!BASE_FILENAME_REGEX.test(file.originalname)) {
      throw new AppError(
        'INVALID_FILENAME',
        422,
        'Filename must match: First_Last_Role.docx (R18).',
      );
    }

    const { value } = await mammoth.extractRawText({ buffer: file.buffer });
    const text = value.trim();
    if (!text) throw new AppError('EMPTY_DOCUMENT', 422, 'The document contains no extractable text.');

    const last = await this.prisma.baseResume.findFirst({
      where: { profileId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (last?.version ?? 0) + 1;

    return this.prisma.$transaction(async (tx) => {
      await tx.baseResume.updateMany({
        where: { profileId, isActive: true },
        data: { isActive: false },
      });

      const base = await tx.baseResume.create({
        data: {
          profileId,
          version,
          fileName: file.originalname,
          parsedJson: { text, chars: text.length },
          isActive: true,
        },
      });

      await tx.profile.update({
        where: { id: profileId },
        data: { activeBaseId: base.id },
      });

      return base;
    });
  }

  private async getOwnedProfile(user: AuthUser, profileId: string) {
    const profile = await this.prisma.profile.findFirst({
      where: { id: profileId, userId: user.id },
    });
    if (!profile) throw new AppError('PROFILE_NOT_FOUND', 404);
    return profile;
  }
}
