import { crawlWithHttp, crawlWithPlaywright } from './crawler.js';
import type {
  CrawledPage,
  CrawlPage,
  HubItem,
  HubTestResult,
  RenderMode,
  RenderModeUsed,
} from './types.js';

const AUTO_HTTP_MIN_ITEMS = 5;

interface CrawlerDependencies {
  httpCrawl: CrawlPage;
  playwrightCrawl: CrawlPage;
}

const defaultDependencies: CrawlerDependencies = {
  httpCrawl: crawlWithHttp,
  playwrightCrawl: crawlWithPlaywright,
};

export async function testHubPage(
  url: string,
  renderMode: RenderMode,
  maxPages = 1,
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
      firstPage.items.length < AUTO_HTTP_MIN_ITEMS
    ) {
      renderModeUsed = 'playwright';
      firstPage = await dependencies.playwrightCrawl(url);
    }
  }

  const crawl = renderModeUsed === 'http' ? dependencies.httpCrawl : dependencies.playwrightCrawl;
  const visited = [url];
  const itemsByUrl = new Map<string, HubItem>();
  let page = firstPage;

  for (let pageNumber = 1; ; pageNumber += 1) {
    for (const item of page.items) itemsByUrl.set(item.url, item);

    if (pageNumber >= maxPages || !page.nextUrl || visited.includes(page.nextUrl)) break;
    visited.push(page.nextUrl);
    page = await crawl(page.nextUrl);
  }

  return {
    renderModeUsed,
    items: [...itemsByUrl.values()],
    rule: {},
    pages: { visited, nextUrl: page.nextUrl },
  };
}
