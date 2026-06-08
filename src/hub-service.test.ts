import { describe, expect, it, vi } from 'vitest';
import { testHubPage } from './hub-service.js';
import type { CrawlPage, CrawledPage } from './types.js';

const item = (index: number) => ({
  title: `Candidate news headline ${index}`,
  url: `https://example.com/news/${index}`,
  published_at: null,
});

const page = (items: ReturnType<typeof item>[], nextUrl: string | null = null): CrawledPage => ({
  items,
  nextUrl,
});

describe('testHubPage', () => {
  it('uses only HTTP when renderMode is http', async () => {
    const httpCrawl = vi.fn<CrawlPage>().mockResolvedValue(page([item(1)]));
    const playwrightCrawl = vi.fn<CrawlPage>();

    const result = await testHubPage('https://example.com/news', 'http', 1, {
      httpCrawl,
      playwrightCrawl,
    });

    expect(result.renderModeUsed).toBe('http');
    expect(playwrightCrawl).not.toHaveBeenCalled();
  });

  it('falls back to Playwright when auto HTTP results are too few', async () => {
    const httpCrawl = vi.fn<CrawlPage>().mockResolvedValue(page([item(1)]));
    const playwrightCrawl = vi.fn<CrawlPage>().mockResolvedValue(page([item(2), item(3)]));

    const result = await testHubPage('https://example.com/news', 'auto', 1, {
      httpCrawl,
      playwrightCrawl,
    });

    expect(result.renderModeUsed).toBe('playwright');
    expect(result.items).toHaveLength(2);
  });

  it('falls back to Playwright when the auto HTTP request fails', async () => {
    const httpCrawl = vi.fn<CrawlPage>().mockRejectedValue(new Error('HTTP request failed'));
    const playwrightCrawl = vi.fn<CrawlPage>().mockResolvedValue(page([item(1)]));

    const result = await testHubPage('https://example.com/news', 'auto', 1, {
      httpCrawl,
      playwrightCrawl,
    });

    expect(result.renderModeUsed).toBe('playwright');
    expect(result.items).toHaveLength(1);
  });

  it('forces Playwright without making an HTTP request', async () => {
    const httpCrawl = vi.fn<CrawlPage>();
    const playwrightCrawl = vi.fn<CrawlPage>().mockResolvedValue(page([item(1)]));

    const result = await testHubPage('https://example.com/news', 'playwright', 1, {
      httpCrawl,
      playwrightCrawl,
    });

    expect(result.renderModeUsed).toBe('playwright');
    expect(httpCrawl).not.toHaveBeenCalled();
  });

  it('visits up to maxPages and deduplicates items by URL', async () => {
    const duplicate = item(1);
    const httpCrawl = vi
      .fn<CrawlPage>()
      .mockResolvedValueOnce(page([duplicate], 'https://example.com/news?page=2'))
      .mockResolvedValueOnce(page([duplicate, item(2)], 'https://example.com/news?page=3'));

    const result = await testHubPage('https://example.com/news', 'http', 2, {
      httpCrawl,
      playwrightCrawl: vi.fn<CrawlPage>(),
    });

    expect(result.items).toEqual([item(1), item(2)]);
    expect(result.pages).toEqual({
      visited: ['https://example.com/news', 'https://example.com/news?page=2'],
      nextUrl: 'https://example.com/news?page=3',
    });
  });
});
