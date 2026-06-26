import { evaluateArticleQuality, extractArticleFromHtml } from './article-extractor.js';
import { fetchArticleHtmlWithHttp, fetchArticleHtmlWithPlaywright } from './crawler.js';
import type {
  ArticleFetchPage,
  ArticleFetchedPage,
  ArticleTestResult,
  RenderMode,
  RenderModeUsed,
} from './types.js';
import { assertPublicHttpUrl } from './url-security.js';

interface ArticleDependencies {
  httpFetch: ArticleFetchPage;
  playwrightFetch: ArticleFetchPage;
  assertPublicUrl?: (url: string, label?: string) => Promise<string>;
}

const defaultDependencies: ArticleDependencies = {
  httpFetch: fetchArticleHtmlWithHttp,
  playwrightFetch: fetchArticleHtmlWithPlaywright,
};

async function extractFetchedPage(
  page: ArticleFetchedPage,
  assertPublicUrl: (url: string, label?: string) => Promise<string>,
) {
  await assertPublicUrl(page.finalUrl, 'finalUrl');
  return extractArticleFromHtml(page.html, page.requestedUrl, page.finalUrl);
}

export async function testArticlePage(
  url: string,
  renderMode: RenderMode,
  dependencies: ArticleDependencies = defaultDependencies,
): Promise<ArticleTestResult> {
  const assertPublicUrl = dependencies.assertPublicUrl ?? assertPublicHttpUrl;
  const requestedUrl = await assertPublicUrl(url, 'requestedUrl');

  const run = async (
    mode: RenderModeUsed,
    fetchPage: ArticleFetchPage,
  ): Promise<ArticleTestResult> => {
    const fetched = await fetchPage(requestedUrl);
    const article = await extractFetchedPage(fetched, assertPublicUrl);
    const quality = evaluateArticleQuality(article);
    if (!quality.usable || !article) {
      throw new Error(`Unable to extract usable article content: ${quality.reasons.join('; ')}`);
    }
    return { renderModeUsed: mode, article };
  };

  if (renderMode === 'http') {
    return run('http', dependencies.httpFetch);
  }

  if (renderMode === 'playwright') {
    return run('playwright', dependencies.playwrightFetch);
  }

  try {
    return await run('http', dependencies.httpFetch);
  } catch {
    return run('playwright', dependencies.playwrightFetch);
  }
}
