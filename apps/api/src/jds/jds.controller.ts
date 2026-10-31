import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { JdsService } from './jds.service';
import { CreateJdDto } from './dto/create-jd.dto';

@Controller('jds')
@UseGuards(JwtAuthGuard)
export class JdsController {
  constructor(private readonly jds: JdsService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateJdDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.jds.create(user, dto, file);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.jds.findOne(user, id);
  }
}
