import type { Page, Route } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageDeadline, assertHtmlWithinLimit, installPublicRouteGuard } from './page-safety.js';

describe('PageDeadline', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses one 30 second budget across multiple stages', async () => {
    vi.useFakeTimers();
    const deadline = new PageDeadline(30_000);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(deadline.remainingMs()).toBe(10_000);

    let finishCleanup!: () => void;
    const cleanupFinished = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const cleanup = vi.fn(async () => cleanupFinished);
    const pending = deadline.run(new Promise<never>(() => undefined), cleanup);
    let rejection: unknown;
    let settled = false;
    const observed = pending.catch((error: unknown) => {
      rejection = error;
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(cleanup).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(settled).toBe(false);

    finishCleanup();
    await observed;
    expect(rejection).toEqual(new Error('Page request timed out after 30000ms'));
  });

  it('waits for cleanup when a stage starts after the deadline already expired', async () => {
    vi.useFakeTimers();
    const deadline = new PageDeadline(1);
    await vi.advanceTimersByTimeAsync(1);
    let finishCleanup!: () => void;
    const cleanupFinished = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    let settled = false;
    const observed = deadline
      .run(Promise.resolve('late'), async () => cleanupFinished)
      .catch(() => {
        settled = true;
      });

    await Promise.resolve();
    expect(settled).toBe(false);
    finishCleanup();
    await observed;
    expect(settled).toBe(true);
  });
});

describe('assertHtmlWithinLimit', () => {
  it('measures UTF-8 bytes and rejects content above the limit', () => {
    expect(() => assertHtmlWithinLimit('你好a', 7)).not.toThrow();
    expect(() => assertHtmlWithinLimit('你好ab', 7)).toThrow('HTML response exceeds 7 bytes');
  });
});

describe('installPublicRouteGuard', () => {
  it('continues public requests and aborts blocked requests', async () => {
    let handler: ((route: Route) => Promise<void>) | undefined;
    const page = {
      route: vi.fn(async (_pattern: string, routeHandler: (route: Route) => Promise<void>) => {
        handler = routeHandler;
      }),
    } as unknown as Page;
    const assertPublicUrl = vi.fn(async (url: string) => {
      if (url.includes('127.0.0.1')) throw new Error('blocked');
      return url;
    });
    await installPublicRouteGuard(page, assertPublicUrl);

    const publicRoute = {
      request: () => ({ url: () => 'https://example.com/app.js' }),
      continue: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    } as unknown as Route;
    const privateRoute = {
      request: () => ({ url: () => 'http://127.0.0.1/private' }),
      continue: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    } as unknown as Route;

    await handler?.(publicRoute);
    await handler?.(privateRoute);

    expect(publicRoute.continue).toHaveBeenCalledOnce();
    expect(publicRoute.abort).not.toHaveBeenCalled();
    expect(privateRoute.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(privateRoute.continue).not.toHaveBeenCalled();
  });
});
