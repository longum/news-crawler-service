import type { Browser, Page, Response as PlaywrightResponse } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createArticlePlaywrightFetcher, createHttpCrawler } from './crawler.js';

describe('createHttpCrawler', () => {
  it('extracts hub results from the shared bounded HTTP loader response', async () => {
    const loadPage = vi.fn().mockResolvedValue({
      requestedUrl: 'https://example.com/start',
      finalUrl: 'https://news.example/archive',
      statusCode: 200,
      html: `
        <article>
          <time datetime="2026-07-12"></time>
          <a href="/news/one">A sufficiently descriptive article headline</a>
        </article>
        <a rel="next" href="?page=2">Next page</a>
      `,
    });
    const crawl = createHttpCrawler(loadPage);

    const result = await crawl('https://example.com/start');

    expect(loadPage).toHaveBeenCalledWith('https://example.com/start');
    expect(result).toEqual({
      items: [
        {
          title: 'A sufficiently descriptive article headline',
          url: 'https://news.example/news/one',
          published_at: '2026-07-12',
        },
      ],
      nextUrl: 'https://news.example/archive?page=2',
      statusCode: 200,
    });
  });
});

describe('createArticlePlaywrightFetcher', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects oversized rendered HTML and always closes the page and browser', async () => {
    const response = {
      url: () => 'https://example.com/final',
      status: () => 200,
    } as PlaywrightResponse;
    const page = {
      route: vi.fn(async () => undefined),
      goto: vi.fn(async () => response),
      url: vi.fn(() => 'https://example.com/final'),
      content: vi.fn(async () => '123456'),
      close: vi.fn(async () => undefined),
    } as unknown as Page;
    const browser = {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    } as unknown as Browser;
    const fetchPage = createArticlePlaywrightFetcher(
      {
        launchBrowser: async () => browser,
        assertPublicUrl: async (url) => url,
      },
      { maxHtmlBytes: 5 },
    );

    await expect(fetchPage('https://example.com/start')).rejects.toThrow(
      'HTML response exceeds 5 bytes',
    );
    expect(page.close).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('closes a browser that finishes launching after the page deadline', async () => {
    vi.useFakeTimers();
    let resolveLaunch!: (browser: Browser) => void;
    const launch = new Promise<Browser>((resolve) => {
      resolveLaunch = resolve;
    });
    const browser = {
      close: vi.fn(async () => undefined),
    } as unknown as Browser;
    const fetchPage = createArticlePlaywrightFetcher(
      {
        launchBrowser: async () => launch,
        assertPublicUrl: async (url) => url,
      },
      { timeoutMs: 30_000 },
    );
    const fetchResult = fetchPage('https://example.com/start');
    let rejection: unknown;
    const observed = fetchResult.catch((error: unknown) => {
      rejection = error;
    });

    await vi.advanceTimersByTimeAsync(30_000);
    resolveLaunch(browser);

    await observed;
    expect(rejection).toEqual(new Error('Page request timed out after 30000ms'));
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('closes the browser before waiting for a timed out newPage call to settle', async () => {
    vi.useFakeTimers();
    let rejectNewPage!: (error: Error) => void;
    const newPage = new Promise<Page>((_resolve, reject) => {
      rejectNewPage = reject;
    });
    const browser = {
      newPage: vi.fn(async () => newPage),
      close: vi.fn(async () => {
        rejectNewPage(new Error('browser closed'));
      }),
    } as unknown as Browser;
    const fetchPage = createArticlePlaywrightFetcher(
      {
        launchBrowser: async () => browser,
        assertPublicUrl: async (url) => url,
      },
      { timeoutMs: 30_000 },
    );
    const fetchResult = fetchPage('https://example.com/start');
    const observed = fetchResult.catch(() => undefined);
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(browser.close).toHaveBeenCalledOnce();
    await observed;
  });
});
