import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength,
} from 'class-validator';

export const FACT_KINDS = ['metric', 'date', 'employer', 'title', 'education', 'skill', 'other'] as const;
export type FactKindName = (typeof FACT_KINDS)[number];

export class CreateFactDto {
  @IsIn(FACT_KINDS) kind!: FactKindName;
  @IsString() @MinLength(1) @MaxLength(500) claimText!: string;
  /** For metrics: the number as written, such as "40", "1.2" or "2M". */
  @IsOptional() @IsString() @MaxLength(40) metricValue?: string;
  /** For metrics: "%", "users", "hours", and so on. */
  @IsOptional() @IsString() @MaxLength(40) metricUnit?: string;
  @IsString() @MaxLength(1000) context!: string;
  @IsOptional() @IsString() @MaxLength(200) employer?: string;
  @IsOptional() @IsBoolean() verified?: boolean;
  @IsOptional() @IsString() @MaxLength(500) sourceNote?: string;
  @IsOptional() @IsUUID() roleId?: string;
}

export class UpdateFactDto {
  @IsOptional() @IsIn(FACT_KINDS) kind?: FactKindName;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(500) claimText?: string;
  @IsOptional() @IsString() @MaxLength(40) metricValue?: string | null;
  @IsOptional() @IsString() @MaxLength(40) metricUnit?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) context?: string;
  @IsOptional() @IsString() @MaxLength(200) employer?: string | null;
  @IsOptional() @IsBoolean() verified?: boolean;
  @IsOptional() @IsString() @MaxLength(500) sourceNote?: string | null;
}

export class VerifyFactsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsUUID(undefined, { each: true })
  factIds!: string[];
}

export class ImportFromBaseDto {
  @IsUUID() baseResumeId!: string;
}

export class ListFactsQuery {
  @IsOptional() @IsIn(FACT_KINDS) kind?: FactKindName;
  @IsOptional() @IsIn(['true', 'false']) verified?: 'true' | 'false';
}

