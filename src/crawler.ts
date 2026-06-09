import { CheerioCrawler, MemoryStorage, PlaywrightCrawler, RequestQueue } from 'crawlee';
import { randomUUID } from 'node:crypto';
import { extractCandidateItems, extractItemsBySelectors, extractNextUrl } from './extractor.js';
import type { CrawlPage, CrawledPage } from './types.js';

const crawlerOptions = {
  maxConcurrency: 1,
  maxRequestRetries: 0,
  maxRequestsPerCrawl: 1,
  requestHandlerTimeoutSecs: 30,
  useSessionPool: false,
} as const;

export const crawlWithHttp: CrawlPage = async (url, selectors = {}) => {
  let result: CrawledPage = { items: [], nextUrl: null, statusCode: 0 };
  const requestQueue = await RequestQueue.open(`hub-http-${randomUUID()}`, {
    storageClient: new MemoryStorage({ persistStorage: false }),
  });
  await requestQueue.addRequest({ url });
  const crawler = new CheerioCrawler({
    ...crawlerOptions,
    ignoreHttpErrorStatusCodes: [403],
    requestQueue,
    requestHandler: ({ $, request, response }) => {
      const loadedUrl = request.loadedUrl ?? request.url;
      const html = $.html();
      result = {
        items: selectors.item
          ? extractItemsBySelectors(html, loadedUrl, selectors)
          : extractCandidateItems(html, loadedUrl),
        nextUrl: extractNextUrl(html, loadedUrl, selectors.next),
        statusCode: response.statusCode ?? 0,
      };
    },
  });

  await crawler.run();
  return result;
};

export const crawlWithPlaywright: CrawlPage = async (url, selectors = {}) => {
  let result: CrawledPage = { items: [], nextUrl: null, statusCode: 0 };
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
    requestHandler: async ({ page, request, response }) => {
      const loadedUrl = request.loadedUrl ?? request.url;
      const html = await page.content();
      result = {
        items: selectors.item
          ? extractItemsBySelectors(html, loadedUrl, selectors)
          : extractCandidateItems(html, loadedUrl),
        nextUrl: extractNextUrl(html, loadedUrl, selectors.next),
        statusCode: response?.status() ?? 0,
      };
    },
  });

  await crawler.run();
  return result;
};
