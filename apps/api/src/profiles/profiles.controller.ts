import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { ProfilesService } from './profiles.service';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ReplaceCertsDto, ReplaceEducationDto, ReplaceRolesDto } from './dto/roster.dto';

@Controller('profiles')
@UseGuards(JwtAuthGuard)
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProfileDto) {
    return this.profiles.create(user, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.profiles.findAll(user);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.profiles.findOne(user, id);
  }

  @Put(':id/roles')
  replaceRoles(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceRolesDto,
  ) {
    return this.profiles.replaceRoles(user, id, dto);
  }

  @Put(':id/education')
  replaceEducation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceEducationDto,
  ) {
    return this.profiles.replaceEducation(user, id, dto);
  }

  @Put(':id/certs')
  replaceCerts(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceCertsDto,
  ) {
    return this.profiles.replaceCerts(user, id, dto);
  }

  @Patch(':id/bases/:baseId/activate')
  activateBase(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('baseId', ParseUUIDPipe) baseId: string,
  ) {
    return this.profiles.activateBase(user, id, baseId);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profiles.update(user, id, dto);
  }

  @Post(':id/bases')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  uploadBase(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.profiles.uploadBase(user, id, file);
  }
}
