import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/;

export class RoleInput {
  @IsString() @MaxLength(200) companyName!: string;
  /** The title as shown on the base resume's roster. */
  @IsString() @MaxLength(200) title!: string;
  /** The title the rewrite must change away from (rule R6). */
  @IsString() @MaxLength(200) baseTitle!: string;
  @Matches(MONTH, { message: 'startDate must look like 2020-01' }) startDate!: string;
  @IsOptional() @Matches(MONTH, { message: 'endDate must look like 2020-01' }) endDate?: string | null;
  @IsOptional() @IsString() @MaxLength(200) location?: string | null;
  @IsOptional() @IsString() @MaxLength(500) baseFlagship?: string | null;
  @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) baseBullets!: string[];
}

export class ReplaceRolesDto {
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => RoleInput)
  roles!: RoleInput[];
}

export class EducationInput {
  @IsString() @MaxLength(200) institution!: string;
  @IsString() @MaxLength(200) degree!: string;
  @IsOptional() @IsString() @MaxLength(200) field?: string | null;
  @IsInt() @Min(1950) @Max(2100) startYear!: number;
  @IsOptional() @IsInt() @Min(1950) @Max(2100) endYear?: number | null;
}

export class ReplaceEducationDto {
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => EducationInput)
  education!: EducationInput[];
}

export class CertInput {
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(200) issuer?: string | null;
  @IsOptional() @IsInt() @Min(1950) @Max(2100) year?: number | null;
}

export class ReplaceCertsDto {
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => CertInput)
  certs!: CertInput[];
}

/** '2020-01' or '2020-01-15' to a UTC date (the pipeline reads back YYYY-MM in UTC). */
export function toMonthDate(v: string): Date {
  const [y, m, d] = v.split('-').map(Number) as [number, number, number | undefined];
  return new Date(Date.UTC(y, m - 1, d ?? 1));
}
