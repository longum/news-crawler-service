import { describe, expect, it, vi } from 'vitest';
import { testArticlePage } from './article-service.js';
import type { ArticleFetchPage } from './types.js';

const readableHtml = (title = 'Readable article title') => `
  <html>
    <head><title>${title}</title></head>
    <body>
      <article>
        <h1>${title}</h1>
        <p>This is the first paragraph with enough useful article text to pass the quality rule.</p>
        <p>This is the second paragraph with enough useful article text to pass the quality rule.</p>
      </article>
    </body>
  </html>
`;

const allowPublicTestUrls = async (url: string, label?: string) => {
  if (url.includes('127.0.0.1')) throw new Error(`${label ?? 'url'} resolves to a blocked address`);
  return url;
};

describe('testArticlePage', () => {
  it('uses HTTP first in auto mode when extraction is usable', async () => {
    const httpFetch = vi.fn<ArticleFetchPage>().mockResolvedValue({
      requestedUrl: 'https://example.com/story',
      finalUrl: 'https://example.com/canonical-story',
      html: readableHtml(),
      statusCode: 200,
    });
    const playwrightFetch = vi.fn<ArticleFetchPage>();

    const result = await testArticlePage('https://example.com/story', 'auto', {
      httpFetch,
      playwrightFetch,
      assertPublicUrl: allowPublicTestUrls,
    });

    expect(result.renderModeUsed).toBe('http');
    expect(result.article.requestedUrl).toBe('https://example.com/story');
    expect(result.article.finalUrl).toBe('https://example.com/canonical-story');
    expect(result.article.textContent).toContain('first paragraph');
    expect(playwrightFetch).not.toHaveBeenCalled();
  });

  it('falls back to Playwright when HTTP extraction is not usable', async () => {
    const httpFetch = vi.fn<ArticleFetchPage>().mockResolvedValue({
      requestedUrl: 'https://example.com/story',
      finalUrl: 'https://example.com/story',
      html: '<html><body><article><h1>Title only</h1><p>Short.</p></article></body></html>',
      statusCode: 200,
    });
    const playwrightFetch = vi.fn<ArticleFetchPage>().mockResolvedValue({
      requestedUrl: 'https://example.com/story',
      finalUrl: 'https://example.com/story',
      html: readableHtml('Rendered article title'),
      statusCode: 200,
    });

    const result = await testArticlePage('https://example.com/story', 'auto', {
      httpFetch,
      playwrightFetch,
      assertPublicUrl: allowPublicTestUrls,
    });

    expect(result.renderModeUsed).toBe('playwright');
    expect(result.article.title).toBe('Rendered article title');
    expect(httpFetch).toHaveBeenCalledTimes(1);
    expect(playwrightFetch).toHaveBeenCalledTimes(1);
  });

  it('does not fall back when HTTP mode is forced', async () => {
    const httpFetch = vi.fn<ArticleFetchPage>().mockResolvedValue({
      requestedUrl: 'https://example.com/story',
      finalUrl: 'https://example.com/story',
      html: '<html><body><article><h1>Title only</h1><p>Short.</p></article></body></html>',
      statusCode: 200,
    });

    await expect(
      testArticlePage('https://example.com/story', 'http', {
        httpFetch,
        playwrightFetch: vi.fn<ArticleFetchPage>(),
        assertPublicUrl: allowPublicTestUrls,
      }),
    ).rejects.toThrow('Unable to extract usable article content');
  });

  it('validates the requested and final URLs against SSRF-protected ranges', async () => {
    const httpFetch = vi.fn<ArticleFetchPage>().mockResolvedValue({
      requestedUrl: 'https://example.com/story',
      finalUrl: 'http://127.0.0.1/private',
      html: readableHtml(),
      statusCode: 200,
    });

    await expect(
      testArticlePage('https://example.com/story', 'http', {
        httpFetch,
        playwrightFetch: vi.fn<ArticleFetchPage>(),
        assertPublicUrl: allowPublicTestUrls,
      }),
    ).rejects.toThrow('finalUrl resolves to a blocked address');
  });
});
