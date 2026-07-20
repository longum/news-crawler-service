import { afterEach, describe, expect, it, vi } from 'vitest';
import { CrawlScheduler } from './crawl-scheduler.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const flushMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('CrawlScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs one task, queues three in FIFO order, and rejects the fifth task', async () => {
    const scheduler = new CrawlScheduler({ maxConcurrent: 1, maxQueued: 3, maxQueueWaitMs: 300_000 });
    const completions = Array.from({ length: 4 }, () => deferred<number>());
    const started: number[] = [];

    const runs = completions.map((completion, index) =>
      scheduler.run(async () => {
        started.push(index + 1);
        return completion.promise;
      }),
    );
    const rejected = scheduler.run(async () => 5);

    await flushMicrotasks();
    expect(started).toEqual([1]);
    await expect(rejected).resolves.toEqual({ accepted: false, reason: 'queue_full' });

    for (let index = 0; index < completions.length; index += 1) {
      completions[index].resolve(index + 1);
      await expect(runs[index]).resolves.toEqual({ accepted: true, value: index + 1 });
      await flushMicrotasks();
      expect(started).toEqual(Array.from({ length: Math.min(index + 2, 4) }, (_, item) => item + 1));
    }
  });

  it('removes a task that waits 300 seconds and never executes it later', async () => {
    vi.useFakeTimers();
    const scheduler = new CrawlScheduler({ maxConcurrent: 1, maxQueued: 3, maxQueueWaitMs: 300_000 });
    const active = deferred<void>();
    const timedOutTask = vi.fn(async () => 'too late');
    const activeRun = scheduler.run(async () => active.promise);
    const queuedRun = scheduler.run(timedOutTask);

    await vi.advanceTimersByTimeAsync(299_999);
    expect(timedOutTask).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(queuedRun).resolves.toEqual({ accepted: false, reason: 'wait_timeout' });

    const replacementTask = vi.fn(async () => 'replacement');
    const replacementRun = scheduler.run(replacementTask);
    active.resolve();
    await expect(activeRun).resolves.toEqual({ accepted: true, value: undefined });
    await expect(replacementRun).resolves.toEqual({ accepted: true, value: 'replacement' });
    expect(timedOutTask).not.toHaveBeenCalled();
    expect(replacementTask).toHaveBeenCalledOnce();
  });

  it('releases the running slot when a task rejects', async () => {
    const scheduler = new CrawlScheduler({ maxConcurrent: 1, maxQueued: 3, maxQueueWaitMs: 300_000 });
    const first = deferred<void>();
    const secondTask = vi.fn(async () => 'second');
    const firstRun = scheduler.run(async () => first.promise);
    const secondRun = scheduler.run(secondTask);

    first.reject(new Error('runner failed'));
    await expect(firstRun).rejects.toThrow('runner failed');
    await expect(secondRun).resolves.toEqual({ accepted: true, value: 'second' });
    expect(secondTask).toHaveBeenCalledOnce();
  });
});
