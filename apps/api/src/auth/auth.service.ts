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

    const jti = randomUUID();
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        role: user.role,
        isAdmin: user.isAdmin,
        jti,
      },
      { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    );

    const refreshToken = randomBytes(32).toString('base64url');
    await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshHash: sha256(refreshToken),
        userAgent,
        ip,
        expiresAt: new Date(
          Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
        ),
      },
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
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
