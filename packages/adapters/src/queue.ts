import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import type { JobBus, PatchPactJob } from "@patchpact/core";

export const PATCHPACT_QUEUE_NAME = "patchpact-jobs";

export class InlineJobBus implements JobBus {
  private readonly seen = new Set<string>();
  private handler?: (job: PatchPactJob, dedupeKey: string) => Promise<void>;

  setHandler(handler: (job: PatchPactJob, dedupeKey: string) => Promise<void>): void {
    this.handler = handler;
  }

  async enqueue(job: PatchPactJob, dedupeKey: string): Promise<boolean> {
    if (this.seen.has(dedupeKey)) {
      return false;
    }
    this.seen.add(dedupeKey);
    if (!this.handler) {
      throw new Error("InlineJobBus handler has not been registered.");
    }
    await this.handler(job, dedupeKey);
    return true;
  }
}

export class BullMQJobBus implements JobBus {
  private readonly queue: Queue<PatchPactJob>;

  constructor(redisUrl: string) {
    this.queue = new Queue<PatchPactJob>(PATCHPACT_QUEUE_NAME, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
    });
  }

  async enqueue(job: PatchPactJob, dedupeKey: string): Promise<boolean> {
    try {
      await this.queue.add(job.type, job, {
        jobId: dedupeKey,
        removeOnComplete: 100,
        removeOnFail: 500,
      });
      return true;
    } catch (error) {
      if (error instanceof Error && /jobid/i.test(error.message)) {
        return false;
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export function startBullWorker(
  redisUrl: string,
  handler: (job: PatchPactJob, dedupeKey: string) => Promise<void>,
): Worker<PatchPactJob> {
  return new Worker<PatchPactJob>(
    PATCHPACT_QUEUE_NAME,
    async (job) => {
      await handler(job.data, job.id ?? `${job.name}:${job.timestamp}`);
    },
    {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
    },
  );
}
