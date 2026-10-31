// apps/api/src/pipeline/queue.ts
import { Queue, type ConnectionOptions } from 'bullmq';
import type { RunJobData } from './types';

export const RUN_QUEUE = 'resume.run';

export function createRunQueue(connection: ConnectionOptions): Queue<RunJobData> {
  return new Queue<RunJobData>(RUN_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 3600, count: 1_000 },
      removeOnFail: { age: 86_400, count: 5_000 },
    },
  });
}

/**
 * No fixed jobId: BullMQ keeps finished jobs, so a repeated id would silently
 * swallow a legitimate retry. Double submits are prevented by checking Run.status
 * in the API (confirm needs AWAITING_COMPANY_CONFIRM, retry needs FAILED).
 */
export function enqueueRun(queue: Queue<RunJobData>, data: RunJobData) {
  return queue.add('pipeline', data);
}
