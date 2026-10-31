import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/auth.types';
import { BrandingService, UpdateBrandingDto } from './branding.service';

@Controller('me/branding')
@UseGuards(JwtAuthGuard)
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.branding.get(user.id);
  }

  @Put()
  put(@CurrentUser() user: AuthUser, @Body() dto: UpdateBrandingDto) {
    return this.branding.put(user, dto);
  }
}
