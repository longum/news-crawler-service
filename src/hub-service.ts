import { crawlWithHttp, crawlWithPlaywright } from './crawler.js';
import type {
  CrawledPage,
  CrawlPage,
  HubItem,
  HubTestOptions,
  HubTestResult,
  RenderMode,
  RenderModeUsed,
} from './types.js';

const AUTO_HTTP_MIN_ITEMS = 5;

interface CrawlerDependencies {
  httpCrawl: CrawlPage;
  playwrightCrawl: CrawlPage;
  sleep?: (delayMs: number) => Promise<void>;
}

const defaultDependencies: CrawlerDependencies = {
  httpCrawl: crawlWithHttp,
  playwrightCrawl: crawlWithPlaywright,
};

const defaultOptions: HubTestOptions = {
  maxPages: 1,
  delayMs: 0,
  stopOn403: true,
  stopWhenNoNewItems: true,
};

const sleep = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export async function testHubPage(
  url: string,
  renderMode: RenderMode,
  options: HubTestOptions = defaultOptions,
  dependencies: CrawlerDependencies = defaultDependencies,
): Promise<HubTestResult> {
  let renderModeUsed: RenderModeUsed;
  let firstPage: CrawledPage;

  if (renderMode === 'playwright') {
    renderModeUsed = 'playwright';
    firstPage = await dependencies.playwrightCrawl(url);
  } else {
    try {
      firstPage = await dependencies.httpCrawl(url);
      renderModeUsed = 'http';
    } catch (error) {
      if (renderMode === 'http') throw error;
      renderModeUsed = 'playwright';
      firstPage = await dependencies.playwrightCrawl(url);
    }

    if (
      renderMode === 'auto' &&
      renderModeUsed === 'http' &&
      firstPage.statusCode !== 403 &&
      firstPage.items.length < AUTO_HTTP_MIN_ITEMS
    ) {
      renderModeUsed = 'playwright';
      firstPage = await dependencies.playwrightCrawl(url);
    }
  }

  const crawl = renderModeUsed === 'http' ? dependencies.httpCrawl : dependencies.playwrightCrawl;
  const visited = [url];
  const itemsByUrl = new Map<string, HubItem>();
  const wait = dependencies.sleep ?? sleep;
  let page = firstPage;
  let stoppedReason: HubTestResult['pages']['stoppedReason'] = null;

  for (let pageNumber = 1; ; pageNumber += 1) {
    let newItemCount = 0;
    for (const item of page.items) {
      if (!itemsByUrl.has(item.url)) newItemCount += 1;
      itemsByUrl.set(item.url, item);
    }

    if (options.stopOn403 && page.statusCode === 403) {
      stoppedReason = 'http_403';
      break;
    }
    if (options.stopWhenNoNewItems && newItemCount === 0) {
      stoppedReason = 'no_new_items';
      break;
    }
    if (
      pageNumber >= options.maxPages ||
      !page.nextUrl ||
      visited.includes(page.nextUrl)
    ) {
      break;
    }

    if (options.delayMs > 0) await wait(options.delayMs);
    visited.push(page.nextUrl);
    page = await crawl(page.nextUrl);
  }

  return {
    renderModeUsed,
    items: [...itemsByUrl.values()],
    rule: {},
    pages: { visited, nextUrl: page.nextUrl, stoppedReason },
  };
}
