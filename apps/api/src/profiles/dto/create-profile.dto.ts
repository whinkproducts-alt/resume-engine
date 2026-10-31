import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateProfileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  headerFullName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  headerCity!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  headerPhones!: string[];

  @IsEmail()
  headerEmail!: string;

  @IsOptional()
  @IsString()
  linkedIn?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
