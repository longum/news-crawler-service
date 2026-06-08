import { CheerioCrawler, MemoryStorage, PlaywrightCrawler, RequestQueue } from 'crawlee';
import { randomUUID } from 'node:crypto';
import { extractCandidateItems, extractNextUrl } from './extractor.js';
import type { CrawlPage, CrawledPage } from './types.js';

const crawlerOptions = {
  maxConcurrency: 1,
  maxRequestRetries: 0,
  maxRequestsPerCrawl: 1,
  requestHandlerTimeoutSecs: 30,
  useSessionPool: false,
} as const;

export const crawlWithHttp: CrawlPage = async (url) => {
  let result: CrawledPage = { items: [], nextUrl: null };
  const requestQueue = await RequestQueue.open(`hub-http-${randomUUID()}`, {
    storageClient: new MemoryStorage({ persistStorage: false }),
  });
  await requestQueue.addRequest({ url });
  const crawler = new CheerioCrawler({
    ...crawlerOptions,
    requestQueue,
    requestHandler: ({ $, request }) => {
      const loadedUrl = request.loadedUrl ?? request.url;
      const html = $.html();
      result = {
        items: extractCandidateItems(html, loadedUrl),
        nextUrl: extractNextUrl(html, loadedUrl),
      };
    },
  });

  await crawler.run();
  return result;
};

export const crawlWithPlaywright: CrawlPage = async (url) => {
  let result: CrawledPage = { items: [], nextUrl: null };
  const requestQueue = await RequestQueue.open(`hub-playwright-${randomUUID()}`, {
    storageClient: new MemoryStorage({ persistStorage: false }),
  });
  await requestQueue.addRequest({ url });
  const crawler = new PlaywrightCrawler({
    ...crawlerOptions,
    requestQueue,
    launchContext: {
      launchOptions: {
        headless: true,
      },
    },
    requestHandler: async ({ page, request }) => {
      const loadedUrl = request.loadedUrl ?? request.url;
      const html = await page.content();
      result = {
        items: extractCandidateItems(html, loadedUrl),
        nextUrl: extractNextUrl(html, loadedUrl),
      };
    },
  });

  await crawler.run();
  return result;
};
