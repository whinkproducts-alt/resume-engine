import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { RateLimitService } from '../common/rate-limit/rate-limit.service';
import { LoginDto } from './dto/login.dto';
import { ensureAdmin } from './bootstrap-admin';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_DAYS,
  sha256,
} from './auth.constants';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async bootstrapAdmin(token?: string) {
    if (!token) {
      throw new AppError(
        'BOOTSTRAP_TOKEN_REQUIRED',
        401,
        'X-Bootstrap-Token header is required.',
      );
    }

    const count = await this.prisma.user.count();
    const expected = process.env.ADMIN_BOOTSTRAP_TOKEN;

    // Idempotent rule: succeeds when there are no users OR the token matches.
    if (count > 0 && (!expected || token !== expected)) {
      throw new AppError('FORBIDDEN', 403, 'Invalid bootstrap token.');
    }

    if (!process.env.ADMIN_EMAIL) {
      throw new AppError(
        'ADMIN_NOT_CONFIGURED',
        500,
        'ADMIN_EMAIL is not configured.',
      );
    }

    await ensureAdmin(this.prisma);
    return { ok: true, hadUsers: count > 0 };
  }

  async login(dto: LoginDto, ip?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Admin: 5 attempts / 15 min / IP. Standard: 10 attempts / 15 min / IP.
    await this.rateLimit.consume(
      `login:${ip ?? 'unknown'}`,
      user?.isAdmin ? 5 : 10,
      15 * 60,
    );

    if (!user) {
      throw new AppError('INVALID_CREDENTIALS', 401, 'Invalid email or password.');
    }

    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) {
      throw new AppError('INVALID_CREDENTIALS', 401, 'Invalid email or password.');
    }

    const tokens = await this.issueTokens(user, ip, userAgent);

    if (user.isAdmin) {
      await this.prisma.adminAction.create({
        data: {
          adminId: user.id, action: 'admin.login',
          ip: ip ?? null, userAgent: userAgent ?? null,
        },
      });
    }

    return { user: await this.me(user.id), ...tokens };
  }

  /**
   * Signs an access token and stores a fresh refresh session (the raw token is
   * returned once; only its SHA-256 is stored).
   */
  private async issueTokens(
    user: { id: string; role: string; isAdmin: boolean },
    ip?: string,
    userAgent?: string,
  ) {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role, isAdmin: user.isAdmin, jti: randomUUID() },
      { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    );
    const refreshToken = randomBytes(32).toString('base64url');
    await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshHash: sha256(refreshToken),
        userAgent: userAgent ?? null,
        ip: ip ?? null,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  /**
   * POST /auth/refresh. The refresh token is rotated on every use. Presenting a
   * token that was already rotated means it leaked: every session of that user
   * is revoked (01-SPEC-v3.md section 3.1).
   */
  async refresh(rawToken: string | undefined, ip?: string, userAgent?: string) {
    if (!rawToken) throw new AppError('UNAUTHORIZED', 401, 'Refresh token required.');

    const session = await this.prisma.session.findFirst({
      where: { refreshHash: sha256(rawToken) },
    });
    if (!session) throw new AppError('UNAUTHORIZED', 401, 'Invalid refresh token.');

    if (session.revokedAt) {
      await this.prisma.session.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new AppError('REFRESH_REUSED', 401, 'Refresh token was already used. Sign in again.');
    }
    if (session.expiresAt.getTime() < Date.now()) {
      throw new AppError('UNAUTHORIZED', 401, 'Refresh token expired.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) throw new AppError('UNAUTHORIZED', 401, 'Invalid refresh token.');

    // Compare-and-set: of two concurrent refreshes with the same token, only one wins.
    const claimed = await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) throw new AppError('UNAUTHORIZED', 401, 'Invalid refresh token.');

    return this.issueTokens(user, ip, userAgent);
  }

  /** POST /auth/logout: revokes the session behind this refresh token. Always succeeds. */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    await this.prisma.session.updateMany({
      where: { refreshHash: sha256(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        isAdmin: true,
        adminUnlimited: true,
        emailVerified: true,
        mustChangePassword: true,
        firstName: true,
        lastName: true,
        themePref: true,
        createdAt: true,
      },
    });
    if (!user) throw new AppError('UNAUTHORIZED', 401);
    return user;
  }
}
