// apps/api/src/settings/settings.service.ts
// GET/PUT /settings: the ten UserSettings toggles (01-SPEC-v3.md section 7.5).

import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { SETTING_KEYS, type SettingKey } from '../runs/dto/create-run.dto';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string) {
    const row = await this.prisma.userSettings.upsert({
      where: { userId }, create: { userId }, update: {},
    });
    return Object.fromEntries(SETTING_KEYS.map((k) => [k, row[k]])) as Record<SettingKey, boolean>;
  }

  /** Any subset of the toggles. An unknown key or a non-boolean value is a 400. */
  async put(userId: string, body: Record<string, unknown>) {
    const data: Partial<Record<SettingKey, boolean>> = {};
    for (const [k, v] of Object.entries(body ?? {})) {
      if (!(SETTING_KEYS as readonly string[]).includes(k)) {
        throw new AppError('UNKNOWN_SETTING', 400, `Unknown setting "${k}".`);
      }
      if (typeof v !== 'boolean') {
        throw new AppError('INVALID_SETTING', 400, `Setting "${k}" must be true or false.`);
      }
      data[k as SettingKey] = v;
    }
    await this.prisma.userSettings.upsert({
      where: { userId }, create: { userId, ...data }, update: data,
    });
    return this.get(userId);
  }
}
