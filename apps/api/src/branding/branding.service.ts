// apps/api/src/branding/branding.service.ts
// GET/PUT /me/branding (01-SPEC-v3.md section 7.10). Writing is Agency only.
// Logo upload (POST /me/branding/logo) is not implemented yet.

import { Injectable } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { AppError } from '../common/errors/app-error';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

export class UpdateBrandingDto {
  @IsString() @MinLength(1) @MaxLength(120) displayName!: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsString() @MaxLength(60) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(300) footerText?: string;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'primaryColor must look like #1F3864' })
  primaryColor?: string;
}

@Injectable()
export class BrandingService {
  constructor(private readonly prisma: PrismaService) {}

  get(userId: string) {
    return this.prisma.brandingConfig.findUnique({
      where: { userId },
      select: {
        displayName: true, logoUrl: true, contactEmail: true, contactPhone: true,
        footerText: true, primaryColor: true, updatedAt: true,
      },
    });
  }

  async put(user: AuthUser, dto: UpdateBrandingDto) {
    // assertAgencyOnly (01-SPEC-v3.md section 2.3): admins pass, everyone else needs AGENCY.
    if (!user.isAdmin && user.role !== 'AGENCY') {
      throw new AppError('FORBIDDEN', 403, 'White label branding is an Agency feature.');
    }
    const data = {
      displayName: dto.displayName,
      contactEmail: dto.contactEmail ?? null,
      contactPhone: dto.contactPhone ?? null,
      footerText: dto.footerText ?? null,
      ...(dto.primaryColor ? { primaryColor: dto.primaryColor.toUpperCase() } : {}),
    };
    await this.prisma.brandingConfig.upsert({
      where: { userId: user.id }, create: { userId: user.id, ...data }, update: data,
    });
    return this.get(user.id);
  }
}
