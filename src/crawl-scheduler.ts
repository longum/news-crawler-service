export interface CrawlSchedulerOptions {
  maxConcurrent: number;
  maxQueued: number;
  maxQueueWaitMs: number;
}

export type CrawlScheduleResult<T> =
  | { accepted: true; value: T }
  | { accepted: false; reason: 'queue_full' | 'wait_timeout' };

export interface CrawlSchedulerLike {
  run<T>(task: () => Promise<T>): Promise<CrawlScheduleResult<T>>;
}

interface QueuedTask {
  task: () => Promise<unknown>;
  resolve: (result: CrawlScheduleResult<unknown>) => void;
  reject: (error: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class CrawlScheduler {
  private readonly options: CrawlSchedulerOptions;
  private readonly queue: QueuedTask[] = [];
  private activeCount = 0;

  constructor(options: CrawlSchedulerOptions) {
    this.options = options;
  }

  async run<T>(task: () => Promise<T>): Promise<CrawlScheduleResult<T>> {
    if (this.activeCount < this.options.maxConcurrent) {
      this.activeCount += 1;
      return this.execute(task);
    }

    if (this.queue.length >= this.options.maxQueued) {
      return { accepted: false, reason: 'queue_full' };
    }

    return new Promise<CrawlScheduleResult<T>>((resolve, reject) => {
      const queuedTask: QueuedTask = {
        task,
        resolve: resolve as (result: CrawlScheduleResult<unknown>) => void,
        reject,
        timeout: setTimeout(() => {
          const index = this.queue.indexOf(queuedTask);
          if (index < 0) return;
          this.queue.splice(index, 1);
          resolve({ accepted: false, reason: 'wait_timeout' });
        }, this.options.maxQueueWaitMs),
      };
      this.queue.push(queuedTask);
    });
  }

  private async execute<T>(task: () => Promise<T>): Promise<CrawlScheduleResult<T>> {
    try {
      return { accepted: true, value: await task() };
    } finally {
      this.release();
    }
  }

  private release(): void {
    const queuedTask = this.queue.shift();
    if (!queuedTask) {
      this.activeCount -= 1;
      return;
    }

    clearTimeout(queuedTask.timeout);
    void this.execute(queuedTask.task).then(queuedTask.resolve, queuedTask.reject);
  }
}

export const defaultCrawlScheduler = new CrawlScheduler({
  maxConcurrent: 1,
  maxQueued: 3,
  maxQueueWaitMs: 300_000,
});
