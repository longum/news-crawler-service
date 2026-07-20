import type { Page } from 'playwright';
import { MAX_HTML_BYTES, PAGE_TIMEOUT_MS } from './http-page-loader.js';
import { assertPublicHttpUrl } from './url-security.js';

type AssertPublicUrl = (url: string, label?: string) => Promise<string>;

export class PageDeadline {
  private readonly expiresAt: number;

  constructor(private readonly timeoutMs: number = PAGE_TIMEOUT_MS) {
    this.expiresAt = Date.now() + timeoutMs;
  }

  remainingMs(): number {
    return Math.max(0, this.expiresAt - Date.now());
  }

  run<T>(operation: Promise<T>, onTimeout?: () => void | Promise<void>): Promise<T> {
    const remainingMs = this.remainingMs();
    if (remainingMs <= 0) {
      return Promise.resolve(onTimeout?.()).then(
        () => Promise.reject<T>(this.timeoutError()),
        () => Promise.reject<T>(this.timeoutError()),
      );
    }

    return new Promise<T>((resolve, reject) => {
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        void Promise.resolve(onTimeout?.()).then(
          () => reject(this.timeoutError()),
          () => reject(this.timeoutError()),
        );
      }, remainingMs);

      operation.then(
        (value) => {
          if (timedOut) return;
          clearTimeout(timeout);
          resolve(value);
        },
        (error: unknown) => {
          if (timedOut) return;
          clearTimeout(timeout);
          reject(error);
        },
      );
    });
  }

  private timeoutError(): Error {
    return new Error(`Page request timed out after ${this.timeoutMs}ms`);
  }
}

export function assertHtmlWithinLimit(html: string, maxHtmlBytes: number = MAX_HTML_BYTES): void {
  if (Buffer.byteLength(html) > maxHtmlBytes) {
    throw new Error(`HTML response exceeds ${maxHtmlBytes} bytes`);
  }
}

export async function installPublicRouteGuard(
  page: Page,
  assertPublicUrl: AssertPublicUrl = assertPublicHttpUrl,
): Promise<void> {
  await page.route('**/*', async (route) => {
    try {
      await assertPublicUrl(route.request().url(), 'requestedUrl');
      await route.continue();
    } catch {
      await route.abort('blockedbyclient').catch(() => undefined);
    }
  });
}
