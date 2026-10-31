import { Injectable } from '@nestjs/common';
import { AppError } from '../errors/app-error';
import { RedisService } from './redis.service';

@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  async consume(key: string, limit: number, ttlSeconds: number): Promise<void> {
    const count = await this.redis.incrWithTtl(key, ttlSeconds);
    if (count !== null && count > limit) {
      throw new AppError('RATE_LIMITED', 429, 'Too many attempts. Try again later.');
    }
  }
}
