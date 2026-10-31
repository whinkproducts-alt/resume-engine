import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { REFRESH_TOKEN_TTL_DAYS } from './auth.constants';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { AuthUser } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('bootstrap-admin')
  bootstrapAdmin(@Headers('x-bootstrap-token') token?: string) {
    return this.auth.bootstrapAdmin(token);
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.auth.login(dto, req.ip, req.headers['user-agent']);
    setRefreshCookie(res, out.refreshToken);
    return shape(out, req);
  }

  /** The refresh token comes from the HttpOnly cookie (web) or the body (native clients). */
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: { refreshToken?: string } | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = readCookie(req.headers.cookie, REFRESH_COOKIE) ?? body?.refreshToken;
    const out = await this.auth.refresh(raw, req.ip, req.headers['user-agent']);
    setRefreshCookie(res, out.refreshToken);
    return shape(out, req);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body() body: { refreshToken?: string } | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(readCookie(req.headers.cookie, REFRESH_COOKIE) ?? body?.refreshToken);
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthUser) {
    return { user: await this.auth.me(user.id) };
  }
}

/* ------------------------------ cookie helpers ------------------------------ */

export const REFRESH_COOKIE = 're_refresh';

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/v1/auth',
  };
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...cookieOptions(),
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return undefined;
}

const NATIVE_CLIENTS = new Set(['ios', 'android', 'desktop']);

/**
 * 01-SPEC-v3.md section 7.1: web clients get { user?, accessToken } and the cookie.
 * Native clients (X-Client-Platform: ios|android|desktop) also receive the
 * refresh token in the body, because they keep it in the Keychain / keystore.
 */
function shape(
  out: { user?: unknown; accessToken: string; refreshToken: string; expiresIn: number },
  req: Request,
) {
  const native = NATIVE_CLIENTS.has(String(req.headers['x-client-platform'] ?? '').toLowerCase());
  return {
    ...(out.user ? { user: out.user } : {}),
    accessToken: out.accessToken,
    tokenType: 'Bearer',
    expiresIn: out.expiresIn,
    ...(native ? { refreshToken: out.refreshToken } : {}),
  };
}
