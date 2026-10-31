import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateJdDto {
  @IsUUID()
  profileId!: string;

  @IsOptional()
  @IsIn(['paste', 'url', 'file'])
  sourceType?: 'paste' | 'url' | 'file';

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  url?: string;
}
