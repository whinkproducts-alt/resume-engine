import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AppError } from '../common/errors/app-error';
import type { AuthUser } from './auth.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new AppError('UNAUTHORIZED', 401);
    }

    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        role: AuthUser['role'];
        isAdmin: boolean;
        jti?: string;
      }>(header.slice('Bearer '.length));

      req.user = {
        id: payload.sub,
        role: payload.role,
        isAdmin: payload.isAdmin,
        jti: payload.jti,
      };
      return true;
    } catch {
      throw new AppError('UNAUTHORIZED', 401);
    }
  }
}
