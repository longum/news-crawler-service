import { MemoryStorage, PlaywrightCrawler, RequestQueue } from 'crawlee';
import { load } from 'cheerio';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser } from 'playwright';
import { extractCandidateItems, extractItemsBySelectors, extractNextUrl } from './extractor.js';
import { loadHtmlWithHttp, MAX_HTML_BYTES, PAGE_TIMEOUT_MS } from './http-page-loader.js';
import { PageDeadline, assertHtmlWithinLimit, installPublicRouteGuard } from './page-safety.js';
import type { ArticleFetchPage, ArticleFetchedPage, CrawlPage, CrawledPage } from './types.js';
import { assertPublicHttpUrl } from './url-security.js';

const crawlerOptions = {
  maxConcurrency: 1,
  maxRequestRetries: 0,
  maxRequestsPerCrawl: 1,
  requestHandlerTimeoutSecs: 30,
  useSessionPool: false,
} as const;

type LoadHttpPage = (url: string) => Promise<ArticleFetchedPage>;

export function createHttpCrawler(loadPage: LoadHttpPage = loadHtmlWithHttp): CrawlPage {
  return async (url, selectors = {}) => {
    const page = await loadPage(url);
    const $ = load(page.html);
    const html = $.html();
    return {
      items: selectors.item
        ? extractItemsBySelectors(html, page.finalUrl, selectors)
        : extractCandidateItems(html, page.finalUrl),
      nextUrl: extractNextUrl(html, page.finalUrl, selectors.next),
      statusCode: page.statusCode,
    };
  };
}

export const crawlWithHttp: CrawlPage = createHttpCrawler();

export const crawlWithPlaywright: CrawlPage = async (url, selectors = {}) => {
  const deadline = new PageDeadline(PAGE_TIMEOUT_MS);
  const requestedUrl = await deadline.run(assertPublicHttpUrl(url, 'requestedUrl'));
  let result: CrawledPage = { items: [], nextUrl: null, statusCode: 0 };
  const requestQueue = await RequestQueue.open(`hub-playwright-${randomUUID()}`, {
    storageClient: new MemoryStorage({ persistStorage: false }),
  });
  await requestQueue.addRequest({ url: requestedUrl });
  const crawler = new PlaywrightCrawler({
    ...crawlerOptions,
    navigationTimeoutSecs: PAGE_TIMEOUT_MS / 1000,
    requestQueue,
    launchContext: {
      launchOptions: {
        headless: true,
      },
    },
    preNavigationHooks: [async ({ page }) => installPublicRouteGuard(page)],
    requestHandler: async ({ page, request, response }) => {
      const loadedUrl = request.loadedUrl ?? request.url;
      await deadline.run(assertPublicHttpUrl(loadedUrl, 'finalUrl'));
      const html = await deadline.run(page.content());
      assertHtmlWithinLimit(html);
      result = {
        items: selectors.item
          ? extractItemsBySelectors(html, loadedUrl, selectors)
          : extractCandidateItems(html, loadedUrl),
        nextUrl: extractNextUrl(html, loadedUrl, selectors.next),
        statusCode: response?.status() ?? 0,
      };
    },
  });

  await deadline.run(crawler.run(), () => crawler.teardown());
  return result;
};

export const fetchArticleHtmlWithHttp: ArticleFetchPage = loadHtmlWithHttp;

interface ArticlePlaywrightDependencies {
  launchBrowser: (timeoutMs: number) => Promise<Browser>;
  assertPublicUrl: (url: string, label?: string) => Promise<string>;
}

interface ArticlePlaywrightOptions {
  timeoutMs?: number;
  maxHtmlBytes?: number;
}

const defaultArticlePlaywrightDependencies: ArticlePlaywrightDependencies = {
  launchBrowser: (timeoutMs) => chromium.launch({ headless: true, timeout: timeoutMs }),
  assertPublicUrl: assertPublicHttpUrl,
};

export function createArticlePlaywrightFetcher(
  dependencies: ArticlePlaywrightDependencies = defaultArticlePlaywrightDependencies,
  options: ArticlePlaywrightOptions = {},
): ArticleFetchPage {
  return async (url) => {
    const timeoutMs = options.timeoutMs ?? PAGE_TIMEOUT_MS;
    const deadline = new PageDeadline(timeoutMs);
    const requestedUrl = await deadline.run(dependencies.assertPublicUrl(url, 'requestedUrl'));
    let browser: Browser | undefined;
    let page: Awaited<ReturnType<Browser['newPage']>> | undefined;

    try {
      const launchPromise = dependencies.launchBrowser(Math.max(1, deadline.remainingMs()));
      browser = await deadline.run(launchPromise, async () => {
        const lateBrowser = await launchPromise.catch(() => undefined);
        await lateBrowser?.close().catch(() => undefined);
      });
      const activeBrowser = browser;
      const newPagePromise = activeBrowser.newPage();
      page = await deadline.run(newPagePromise, async () => {
        await activeBrowser.close().catch(() => undefined);
        if (browser === activeBrowser) browser = undefined;
        const latePage = await newPagePromise.catch(() => undefined);
        await latePage?.close().catch(() => undefined);
      });
      await deadline.run(installPublicRouteGuard(page, dependencies.assertPublicUrl));
      const response = await deadline.run(
        page.goto(requestedUrl, {
          waitUntil: 'domcontentloaded',
          timeout: Math.max(1, deadline.remainingMs()),
        }),
      );
      const finalUrl = await deadline.run(
        dependencies.assertPublicUrl(response?.url() ?? page.url(), 'finalUrl'),
      );
      const html = await deadline.run(page.content());
      assertHtmlWithinLimit(html, options.maxHtmlBytes ?? MAX_HTML_BYTES);
      return {
        requestedUrl,
        finalUrl,
        html,
        statusCode: response?.status() ?? 0,
      };
    } finally {
      await page?.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
    }
  };
}

export const fetchArticleHtmlWithPlaywright: ArticleFetchPage = createArticlePlaywrightFetcher();
