import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadHtmlWithHttp } from './http-page-loader.js';

const htmlHeaders = { 'content-type': 'text/html; charset=utf-8' };

describe('loadHtmlWithHttp', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('validates the requested URL and every redirect before fetching the next hop', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: '/final' },
        }),
      )
      .mockResolvedValueOnce(new Response('<html>final</html>', { status: 200, headers: htmlHeaders }));
    const assertPublicUrl = vi.fn(async (url: string) => url);

    const page = await loadHtmlWithHttp(
      'https://example.com/start',
      {},
      { fetchImpl, assertPublicUrl },
    );

    expect(page).toEqual({
      requestedUrl: 'https://example.com/start',
      finalUrl: 'https://example.com/final',
      html: '<html>final</html>',
      statusCode: 200,
    });
    expect(assertPublicUrl).toHaveBeenNthCalledWith(1, 'https://example.com/start', 'requestedUrl');
    expect(assertPublicUrl).toHaveBeenNthCalledWith(2, 'https://example.com/final', 'finalUrl');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not fetch a redirect target rejected by the public URL policy', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/private' },
      }),
    );
    const assertPublicUrl = vi.fn(async (url: string, label?: string) => {
      if (url.includes('127.0.0.1')) throw new Error(`${label} resolves to a blocked address`);
      return url;
    });

    await expect(
      loadHtmlWithHttp('https://example.com/start', {}, { fetchImpl, assertPublicUrl }),
    ).rejects.toThrow('finalUrl resolves to a blocked address');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('times out while reading a response body and cancels the stream', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body, { status: 200, headers: htmlHeaders }));
    const load = loadHtmlWithHttp(
      'https://example.com/slow',
      { timeoutMs: 30_000 },
      { fetchImpl, assertPublicUrl: async (url) => url },
    );
    const rejection = expect(load).rejects.toThrow('Page request timed out after 30000ms');

    await vi.advanceTimersByTimeAsync(30_000);

    await rejection;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects an oversized Content-Length before reading the body', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { ...htmlHeaders, 'content-length': '6' },
      }),
    );

    await expect(
      loadHtmlWithHttp(
        'https://example.com/large',
        { maxHtmlBytes: 5 },
        { fetchImpl, assertPublicUrl: async (url) => url },
      ),
    ).rejects.toThrow('HTML response exceeds 5 bytes');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels a chunked response as soon as its decoded body exceeds the byte limit', async () => {
    const cancel = vi.fn();
    const chunks = [new TextEncoder().encode('123'), new TextEncoder().encode('456')];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
      },
      cancel,
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body, { status: 200, headers: htmlHeaders }));

    await expect(
      loadHtmlWithHttp(
        'https://example.com/chunked',
        { maxHtmlBytes: 5 },
        { fetchImpl, assertPublicUrl: async (url) => url },
      ),
    ).rejects.toThrow('HTML response exceeds 5 bytes');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('accepts a response whose UTF-8 body is exactly the byte limit', async () => {
    const html = '你好a';
    const maxHtmlBytes = new TextEncoder().encode(html).byteLength;
    const fetchImpl = vi.fn().mockResolvedValue(new Response(html, { status: 200, headers: htmlHeaders }));

    const page = await loadHtmlWithHttp(
      'https://example.com/exact',
      { maxHtmlBytes },
      { fetchImpl, assertPublicUrl: async (url) => url },
    );

    expect(page.html).toBe(html);
  });

  it('uses one timeout budget across redirects instead of resetting it per hop', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            setTimeout(
              () => resolve(new Response(null, { status: 302, headers: { location: '/final' } })),
              20_000,
            );
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            setTimeout(
              () => resolve(new Response('late', { status: 200, headers: htmlHeaders })),
              20_000,
            );
          }),
      );
    const load = loadHtmlWithHttp(
      'https://example.com/start',
      { timeoutMs: 30_000 },
      { fetchImpl, assertPublicUrl: async (url) => url },
    );
    const rejection = expect(load).rejects.toThrow('Page request timed out after 30000ms');

    await vi.advanceTimersByTimeAsync(30_000);

    await rejection;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
