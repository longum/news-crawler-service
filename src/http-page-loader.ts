import type { ArticleFetchedPage } from './types.js';
import { assertPublicHttpUrl } from './url-security.js';

export const PAGE_TIMEOUT_MS = 30_000;
export const MAX_HTML_BYTES = 5 * 1024 * 1024;
export const MAX_HTTP_REDIRECTS = 5;

export interface HttpPageLoadOptions {
  timeoutMs?: number;
  maxHtmlBytes?: number;
  maxRedirects?: number;
}

export interface HttpPageLoaderDependencies {
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
  assertPublicUrl: (url: string, label?: string) => Promise<string>;
}

const defaultDependencies: HttpPageLoaderDependencies = {
  fetchImpl: fetch,
  assertPublicUrl: assertPublicHttpUrl,
};

function timeoutError(timeoutMs: number): Error {
  return new Error(`Page request timed out after ${timeoutMs}ms`);
}

function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  if (signal.aborted) return Promise.reject(timeoutError(timeoutMs));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(timeoutError(timeoutMs));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);

    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(signal.aborted ? timeoutError(timeoutMs) : error);
      },
    );
  });
}

async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function readHtmlBody(
  response: Response,
  maxHtmlBytes: number,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxHtmlBytes) {
    await cancelResponseBody(response);
    throw new Error(`HTML response exceeds ${maxHtmlBytes} bytes`);
  }

  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await waitWithSignal(reader.read(), signal, timeoutMs);
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxHtmlBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`HTML response exceeds ${maxHtmlBytes} bytes`);
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function loadHtmlWithHttp(
  url: string,
  options: HttpPageLoadOptions = {},
  dependencies: HttpPageLoaderDependencies = defaultDependencies,
): Promise<ArticleFetchedPage> {
  const timeoutMs = options.timeoutMs ?? PAGE_TIMEOUT_MS;
  const maxHtmlBytes = options.maxHtmlBytes ?? MAX_HTML_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_HTTP_REDIRECTS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const { signal } = controller;

  try {
    const requestedUrl = await waitWithSignal(
      dependencies.assertPublicUrl(url, 'requestedUrl'),
      signal,
      timeoutMs,
    );
    let currentUrl = requestedUrl;

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const response = await waitWithSignal(
        dependencies.fetchImpl(currentUrl, {
          redirect: 'manual',
          signal,
          headers: {
            'user-agent': 'news-crawler-service/0.1',
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        }),
        signal,
        timeoutMs,
      );

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await cancelResponseBody(response);
        if (!location) throw new Error('HTTP redirect missing Location header');

        const nextUrl = new URL(location, currentUrl).href;
        currentUrl = await waitWithSignal(
          dependencies.assertPublicUrl(nextUrl, 'finalUrl'),
          signal,
          timeoutMs,
        );
        continue;
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        await cancelResponseBody(response);
        throw new Error(`HTTP response is not HTML: ${contentType}`);
      }

      return {
        requestedUrl,
        finalUrl: currentUrl,
        html: await readHtmlBody(response, maxHtmlBytes, signal, timeoutMs),
        statusCode: response.status,
      };
    }

    throw new Error('HTTP request exceeded redirect limit');
  } finally {
    clearTimeout(timeout);
  }
}
