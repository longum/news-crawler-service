import { CheerioCrawler, MemoryStorage, PlaywrightCrawler, RequestQueue } from 'crawlee';
import { randomUUID } from 'node:crypto';
import { extractCandidateItems } from './extractor.js';
import type { CrawlPage, HubItem } from './types.js';

const crawlerOptions = {
  maxConcurrency: 1,
  maxRequestRetries: 0,
  maxRequestsPerCrawl: 1,
  requestHandlerTimeoutSecs: 30,
  useSessionPool: false,
} as const;

export const crawlWithHttp: CrawlPage = async (url) => {
  let items: HubItem[] = [];
  const requestQueue = await RequestQueue.open(`hub-http-${randomUUID()}`, {
    storageClient: new MemoryStorage({ persistStorage: false }),
  });
  await requestQueue.addRequest({ url });
  const crawler = new CheerioCrawler({
    ...crawlerOptions,
    requestQueue,
    requestHandler: ({ $, request }) => {
      items = extractCandidateItems($.html(), request.loadedUrl ?? request.url);
    },
  });

  await crawler.run();
  return items;
};

export const crawlWithPlaywright: CrawlPage = async (url) => {
  let items: HubItem[] = [];
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
      items = extractCandidateItems(await page.content(), request.loadedUrl ?? request.url);
    },
  });

  await crawler.run();
  return items;
};
