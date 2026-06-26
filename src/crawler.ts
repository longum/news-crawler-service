import { CheerioCrawler, MemoryStorage, PlaywrightCrawler, RequestQueue } from 'crawlee';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { extractCandidateItems, extractItemsBySelectors, extractNextUrl } from './extractor.js';
import type { ArticleFetchedPage, CrawlPage, CrawledPage } from './types.js';
import { assertPublicHttpUrl } from './url-security.js';

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

const ARTICLE_TIMEOUT_MS = 30_000;
const MAX_ARTICLE_REDIRECTS = 5;

export async function fetchArticleHtmlWithHttp(url: string): Promise<ArticleFetchedPage> {
  const requestedUrl = await assertPublicHttpUrl(url, 'requestedUrl');
  let currentUrl = requestedUrl;

  for (let redirectCount = 0; redirectCount <= MAX_ARTICLE_REDIRECTS; redirectCount += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ARTICLE_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': 'news-crawler-service/0.1',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Article HTTP redirect missing Location header');
      const nextUrl = new URL(location, currentUrl).href;
      currentUrl = await assertPublicHttpUrl(nextUrl, 'finalUrl');
      continue;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error(`Article HTTP response is not HTML: ${contentType}`);
    }

    return {
      requestedUrl,
      finalUrl: currentUrl,
      html: await response.text(),
      statusCode: response.status,
    };
  }

  throw new Error('Article HTTP request exceeded redirect limit');
}

export async function fetchArticleHtmlWithPlaywright(url: string): Promise<ArticleFetchedPage> {
  const requestedUrl = await assertPublicHttpUrl(url, 'requestedUrl');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.route('**/*', async (route) => {
      try {
        await assertPublicHttpUrl(route.request().url(), 'requestedUrl');
        await route.continue();
      } catch {
        await route.abort('blockedbyclient');
      }
    });

    const response = await page.goto(requestedUrl, {
      waitUntil: 'domcontentloaded',
      timeout: ARTICLE_TIMEOUT_MS,
    });
    const finalUrl = await assertPublicHttpUrl(response?.url() ?? page.url(), 'finalUrl');
    return {
      requestedUrl,
      finalUrl,
      html: await page.content(),
      statusCode: response?.status() ?? 0,
    };
  } finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
