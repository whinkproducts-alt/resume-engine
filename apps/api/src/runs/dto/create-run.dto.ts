import { IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateRunDto {
  @IsUUID()
  profileId!: string;

  @IsOptional()
  @IsUUID()
  baseResumeId?: string;

  @IsUUID()
  jdId!: string;

  /** Any subset of the ten UserSettings toggles. Unknown keys are ignored. */
  @IsOptional()
  @IsObject()
  settingsOverride?: Record<string, boolean>;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  contactLocationOverride?: string;
}

export class ConfirmCompanyDto {
  @IsString()
  @MaxLength(200)
  companyName!: string;
}

export const SETTING_KEYS = [
  'strictFactsMode', 'flagAndInclude', 'lockCompanyNames', 'lockEmploymentDates',
  'blockOnUnusableJD', 'inferCompanyName', 'banHyphensInProse', 'consultingFraming',
  'whinkGroupFraming', 'heritageLineDefault',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

export function pickSettings(input: Record<string, unknown> | undefined): Partial<Record<SettingKey, boolean>> {
  const out: Partial<Record<SettingKey, boolean>> = {};
  for (const k of SETTING_KEYS) {
    const v = input?.[k];
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

