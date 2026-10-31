import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateJdDto {
  @IsUUID()
  profileId!: string;

  @IsOptional()
  @IsIn(['paste', 'url', 'file'])
  sourceType?: 'paste' | 'url' | 'file';

  /** 01-SPEC-v3.md section 7.6 */
  @IsOptional()
  @IsString()
  rawText?: string;

  /** 01-SPEC-v3.md section 7.6 */
  @IsOptional()
  @IsString()
  sourceUrl?: string;

  /** Deprecated alias of rawText (Part 1 name). */
  @IsOptional()
  @IsString()
  text?: string;

  /** Deprecated alias of sourceUrl (Part 1 name). */
  @IsOptional()
  @IsString()
  url?: string;
}
