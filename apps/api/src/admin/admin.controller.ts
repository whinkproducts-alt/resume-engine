// apps/api/src/admin/admin.controller.ts
import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
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

@Controller('admin')
@UseGuards(AdminOrBootstrapGuard)
export class AdminController {
  constructor(private readonly twoFa: Admin2faService) {}

  /** POST /admin/2fa/enroll (not GET: Victor sign-off). */
  @Post('2fa/enroll')
  @HttpCode(201)
  enroll(@Req() req: AdminRequest, @Body() _dto: TwoFaTargetDto) {
    return this.twoFa.enroll(req.adminTargetId as string, meta(req));
  }

  @Post('2fa/verify')
  @HttpCode(200)
  verify(@Req() req: AdminRequest, @Body() dto: TwoFaVerifyDto) {
    return this.twoFa.verify(req.adminTargetId as string, dto.code, meta(req));
  }
}

function meta(req: AdminRequest) {
  const ua = req.headers['user-agent'];
  return { ...(req.ip ? { ip: req.ip } : {}), ...(ua ? { userAgent: ua } : {}) };
}
