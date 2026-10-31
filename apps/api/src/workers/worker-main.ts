// apps/api/src/workers/worker-main.ts
// Standalone BullMQ worker process:  pnpm --filter @resume-engine/api worker
// Importing this module has no side effects; main() runs only when executed.

import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { createLlmClientFromEnv, modelsFromEnv } from '../pipeline/llm';
import { ruleConfigFromEnv, storeFromEnv } from '../pipeline/env';
import { PrismaPipelineRepo } from '../pipeline/prisma-repo';
import { RUN_QUEUE } from '../pipeline/queue';
import { ensureDefaultRuleSet } from '../pipeline/rule-set';
import { runPipeline, type PipelineEnv } from '../pipeline/run-pipeline';
import type { RunJobData } from '../pipeline/types';

export async function startWorker(): Promise<{ close: () => Promise<void> }> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL is required');

  const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const prisma = new PrismaClient();
  const models = modelsFromEnv();
  const repo = new PrismaPipelineRepo(prisma);

  await ensureDefaultRuleSet(prisma, models);

  const env: PipelineEnv = {
    repo,
    llm: createLlmClientFromEnv(),
    models,
    store: storeFromEnv(),
    config: ruleConfigFromEnv(),
    ...(process.env.SOFFICE_PATH ? { sofficePath: process.env.SOFFICE_PATH } : {}),
  };

  const worker = new Worker<RunJobData>(
    RUN_QUEUE,
    (job) => runPipeline(env, job.data),
    {
      connection: redis,
      concurrency: Number(process.env.WORKER_CONCURRENCY ?? 3),
      lockDuration: 120_000,
    },
  );

  // Transient errors are retried by BullMQ. Only the last attempt fails the run.
  worker.on('failed', async (job, err) => {
    if (!job) return;
    const last = job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!last) return;
    try {
      await repo.logStep(job.data.runId, {
        step: 'worker', status: 'error', errorCode: 'PIPELINE_ERROR',
        errorMsg: err.message.slice(0, 500),
      });
      await repo.setStatus(job.data.runId, 'FAILED', {
        errorCode: 'PIPELINE_ERROR', finishedAt: new Date(),
      });
    } catch (e) {
      console.error('[worker] could not mark run failed', e);
    }
  });
  worker.on('error', (err) => console.error('[worker] error', err.message));

  return {
    close: async () => {
      await worker.close();
      await redis.quit().catch(() => undefined);
      await prisma.$disconnect().catch(() => undefined);
    },
  };
}

if (require.main === module) {
  startWorker()
    .then((w) => {
      const stop = () => { void w.close().then(() => process.exit(0)); };
      process.on('SIGTERM', stop);
      process.on('SIGINT', stop);
      console.log('[worker] listening on', RUN_QUEUE);
    })
    .catch((err) => { console.error('[worker] failed to start', err); process.exit(1); });
}
