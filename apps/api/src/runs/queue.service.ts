// apps/api/src/runs/queue.service.ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { AppError } from '../common/errors/app-error';
import { createRunQueue, enqueueRun } from '../pipeline/queue';
import type { RunJobData } from '../pipeline/types';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private queue: Queue<RunJobData> | null = null;
  private redis: IORedis | null = null;

  private get(): Queue<RunJobData> {
    if (!this.queue) {
      const url = process.env.REDIS_URL;
      if (!url) throw new AppError('QUEUE_NOT_CONFIGURED', 503, 'REDIS_URL is not set.');
      this.redis = new IORedis(url, { maxRetriesPerRequest: null });
      this.queue = createRunQueue(this.redis);
    }
    return this.queue;
  }

  async enqueue(data: RunJobData): Promise<void> {
    await enqueueRun(this.get(), data);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close().catch(() => undefined);
    await this.redis?.quit().catch(() => undefined);
  }
}
