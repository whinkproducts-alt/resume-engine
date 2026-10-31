// apps/api/src/admin/admin.controller.ts
import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { AdminGuard } from '../auth/admin.guard';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { AdminReadService } from './admin-read.service';
import { Admin2faService } from './admin-2fa.service';
import { AdminOrBootstrapGuard, type AdminRequest } from './admin-or-bootstrap.guard';

class TwoFaTargetDto {
  /** Required only when authenticating with X-Bootstrap-Token. */
  @IsOptional()
  @IsUUID()
  adminId?: string;
}

class TwoFaVerifyDto extends TwoFaTargetDto {
  @IsString()
  @Length(6, 8)
  code!: string;
}

class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsUUID() cursor?: string;
  @IsOptional() @IsString() status?: string;
}

@Controller('admin')
export class AdminController {
  constructor(
    private readonly twoFa: Admin2faService,
    private readonly read: AdminReadService,
  ) {}

  /* ------------------------ panel data: admin JWT only ------------------------ */

  @Get('users')
  @UseGuards(AdminGuard)
  users(@Query() q: PageQuery) { return this.read.users(q); }

  @Get('runs')
  @UseGuards(AdminGuard)
  runs(@Query() q: PageQuery) { return this.read.runs(q); }

  @Get('runs/:id')
  @UseGuards(AdminGuard)
  runDetail(@Param('id', ParseUUIDPipe) id: string) { return this.read.runDetail(id); }

  @Post('runs/:id/reproduce')
  @HttpCode(202)
  @UseGuards(AdminGuard)
  reproduce(@Req() req: AdminRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.read.reproduce((req.user as { id: string }).id, id, meta(req));
  }

  @Get('audit')
  @UseGuards(AdminGuard)
  audit(@Query() q: PageQuery) { return this.read.auditLog(q); }

  /* ------------- 2FA: admin JWT, or the X-Bootstrap-Token header ------------- */

  /** POST /admin/2fa/enroll (not GET: Victor sign-off). */
  @Post('2fa/enroll')
  @UseGuards(AdminOrBootstrapGuard)
  @HttpCode(201)
  enroll(@Req() req: AdminRequest, @Body() _dto: TwoFaTargetDto) {
    return this.twoFa.enroll(req.adminTargetId as string, meta(req));
  }

  @Post('2fa/verify')
  @UseGuards(AdminOrBootstrapGuard)
  @HttpCode(200)
  verify(@Req() req: AdminRequest, @Body() dto: TwoFaVerifyDto) {
    return this.twoFa.verify(req.adminTargetId as string, dto.code, meta(req));
  }
}

function meta(req: AdminRequest) {
  const ua = req.headers['user-agent'];
  return { ...(req.ip ? { ip: req.ip } : {}), ...(ua ? { userAgent: ua } : {}) };
}
