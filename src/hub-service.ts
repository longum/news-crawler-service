import { crawlWithHttp, crawlWithPlaywright } from './crawler.js';
import type { CrawlPage, HubTestResult, RenderMode } from './types.js';

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
  dependencies: CrawlerDependencies = defaultDependencies,
): Promise<HubTestResult> {
  if (renderMode === 'playwright') {
    return {
      renderModeUsed: 'playwright',
      items: await dependencies.playwrightCrawl(url),
      rule: {},
    };
  }

  let httpItems;
  try {
    httpItems = await dependencies.httpCrawl(url);
  } catch (error) {
    if (renderMode === 'http') throw error;
    return {
      renderModeUsed: 'playwright',
      items: await dependencies.playwrightCrawl(url),
      rule: {},
    };
  }
  if (renderMode === 'http' || httpItems.length >= AUTO_HTTP_MIN_ITEMS) {
    return { renderModeUsed: 'http', items: httpItems, rule: {} };
  }

  return {
    renderModeUsed: 'playwright',
    items: await dependencies.playwrightCrawl(url),
    rule: {},
  };
}
