import { describe, expect, it } from 'vitest';
import { evaluateArticleQuality, extractArticleFromHtml, isUsableArticle } from './article-extractor.js';

describe('extractArticleFromHtml', () => {
  it('extracts readable content, sanitized HTML, and published time metadata', () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <title>Ignored browser title</title>
          <meta property="og:title" content="Readable article title from metadata">
          <meta property="article:published_time" content="2026-06-25T10:30:00+08:00">
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "NewsArticle",
              "headline": "Readable article title from JSON-LD",
              "datePublished": "2026-06-25T09:00:00+08:00"
            }
          </script>
        </head>
        <body>
          <article>
            <h1>Readable article title from page</h1>
            <time datetime="2026-06-24T08:00:00+08:00">June 24, 2026</time>
            <p>First useful paragraph with enough words to look like article text for extraction.</p>
            <p onclick="alert('x')">Second useful paragraph keeps structure and removes event attributes.</p>
            <p><a href="javascript:alert('x')">Dangerous link</a><a href="https://example.com/safe">Safe link</a></p>
            <script>alert('remove me')</script>
            <iframe src="https://example.com/embed"></iframe>
          </article>
        </body>
      </html>
    `;

    const article = extractArticleFromHtml(html, 'https://example.com/news/story');

    expect(article).toMatchObject({
      title: 'Readable article title from JSON-LD',
      publishedAt: '2026-06-25T01:00:00.000Z',
      requestedUrl: 'https://example.com/news/story',
      finalUrl: 'https://example.com/news/story',
    });
    expect(article?.textContent).toContain('First useful paragraph');
    expect(article?.textLength).toBeGreaterThan(100);
    expect(article?.paragraphCount).toBeGreaterThanOrEqual(2);
    expect(article?.contentHtml).toContain('<p>');
    expect(article?.contentHtml).not.toContain('<script');
    expect(article?.contentHtml).not.toContain('<iframe');
    expect(article?.contentHtml).not.toContain('onclick=');
    expect(article?.contentHtml).not.toContain('javascript:');
    expect(article?.contentHtml).toContain('href="https://example.com/safe"');
  });

  it('falls back through meta and time tags when JSON-LD date is unavailable', () => {
    const metaArticle = extractArticleFromHtml(
      `
        <html>
          <head><meta name="pubdate" content="2026-06-23T12:00:00Z"></head>
          <body><article><h1>Meta dated article</h1><p>Useful paragraph one.</p><p>Useful paragraph two.</p></article></body>
        </html>
      `,
      'https://example.com/meta',
    );
    const timeArticle = extractArticleFromHtml(
      `
        <html>
          <body>
            <article>
              <h1>Time dated article</h1>
              <time datetime="2026-06-22T12:00:00Z"></time>
              <p>Useful paragraph one.</p><p>Useful paragraph two.</p>
            </article>
          </body>
        </html>
      `,
      'https://example.com/time',
    );

    expect(metaArticle?.publishedAt).toBe('2026-06-23T12:00:00.000Z');
    expect(timeArticle?.publishedAt).toBe('2026-06-22T12:00:00.000Z');
  });

  it('extracts dates from nested JSON-LD arrays and Chinese date formats', () => {
    const jsonLdArticle = extractArticleFromHtml(
      `
        <html>
          <head>
            <title>Nested JSON-LD date article</title>
            <script type="application/ld+json">
              [{
                "@context": "https://schema.org",
                "@graph": [{
                  "@type": "NewsArticle",
                  "headline": "Nested JSON-LD date article",
                  "datePublished": "2026-06-21T08:30:00Z"
                }]
              }]
            </script>
          </head>
          <body><article><h1>Nested JSON-LD date article</h1><p>Useful article paragraph one with enough body text.</p><p>Useful article paragraph two with enough body text.</p></article></body>
        </html>
      `,
      'https://example.com/json-ld',
    );
    const chineseDateArticle = extractArticleFromHtml(
      `
        <html>
          <head><title>中文日期格式文章</title></head>
          <body>
            <article>
              <h1>中文日期格式文章</h1>
              <div class="meta">来源：中国新闻网 2026年6月26日 09:15</div>
              <p>这是一段正常中文新闻正文，包含足够的信息用于判断正文结构。</p>
              <p>这是第二段正常中文新闻正文，继续描述事件背景和更多细节。</p>
            </article>
          </body>
        </html>
      `,
      'https://example.com/chinese-date',
    );

    expect(jsonLdArticle?.publishedAt).toBe('2026-06-21T08:30:00.000Z');
    expect(chineseDateArticle?.publishedAt).toBe('2026-06-26T09:15:00.000Z');
  });

  it('uses DOM fallback to recover a single-paragraph news bulletin after Readability chooses boilerplate', () => {
    const article = extractArticleFromHtml(
      `
        <html>
          <head><title>习近平会见孟加拉国总理塔里克-中新网</title></head>
          <body>
            <div class="main_content">
              <div class="con_left">
                <div class="content">
                  <div class="content_maincontent_more">
                    <h1 class="content_left_title">习近平会见孟加拉国总理塔里克</h1>
                    <div class="meta">2026年06月26日 10:30 来源：新华社 作者：胡寒笑</div>
                    <div class="content_maincontent_content">
                      <div class="left_zw">
                        <p>新华社快讯：6月26日，国家主席习近平在北京会见孟加拉国总理塔里克。</p>
                        <div class="adEditor"><span>【编辑:胡寒笑】</span></div>
                      </div>
                    </div>
                    <div class="comment_wrapper">发表评论 文明上网理性发言</div>
                    <div class="selected_news_wrapper">
                      <a href="/news/a">两岸媒体走进四川 台资企业参与乡村振兴引关注</a>
                      <a href="/news/b">机器人钻进血管能干啥</a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="pagebottom">
              <div class="pagebottom_nr">
                <p>本网站所刊载信息，不代表中新社和中新网观点。刊用本网站稿件，务经书面授权。</p>
                <p>未经授权禁止转载、摘编、复制及建立镜像，违者将依法追究法律责任。</p>
                <p>Copyright ©1999-2026 chinanews.com. All Rights Reserved</p>
              </div>
            </div>
          </body>
        </html>
      `,
      'https://example.com/brief-news',
    );

    expect(article?.extractorUsed).toBe('dom-fallback');
    expect(article?.title).toBe('习近平会见孟加拉国总理塔里克');
    expect(article?.publishedAt).toBe('2026-06-26T10:30:00.000Z');
    expect(article?.textContent).toBe('新华社快讯：6月26日，国家主席习近平在北京会见孟加拉国总理塔里克。');
    expect(article?.contentHtml).toContain('<p>');
    expect(article?.contentHtml).not.toContain('Copyright');
    expect(article?.contentHtml).not.toContain('selected_news_wrapper');
    expect(evaluateArticleQuality(article).usable).toBe(true);
  });

  it('does not use DOM fallback for a normal long article already handled by Readability', () => {
    const article = extractArticleFromHtml(
      `
        <html>
          <head><title>Useful title about storm recovery</title></head>
          <body>
            <article>
              <h1>Useful title about storm recovery</h1>
              <p>Useful title reporting explains how storm recovery teams restored power across several districts after the evening outage.</p>
              <p>Officials said transport routes reopened as crews removed damaged trees and repaired signals through the morning.</p>
              <p>Residents described steady progress while emergency shelters continued to provide meals and phone charging.</p>
            </article>
          </body>
        </html>
      `,
      'https://example.com/long-news',
    );

    expect(article?.extractorUsed).toBe('readability');
    expect(evaluateArticleQuality(article).usable).toBe(true);
  });

  it('keeps rejecting a news home page with many cards after DOM fallback', () => {
    const cards = Array.from(
      { length: 30 },
      (_, index) => `<li><a href="/news/${index}">Breaking update headline ${index}</a></li>`,
    ).join('');
    const article = extractArticleFromHtml(
      `
        <html>
          <head><title>BBC News - Breaking news and latest stories</title></head>
          <body>
            <header><nav><a href="/">Home</a><a href="/world">World</a></nav></header>
            <main>
              <h1>BBC News</h1>
              <section class="top-stories"><ul>${cards}</ul></section>
              <section class="more-news"><ul>${cards}</ul></section>
            </main>
          </body>
        </html>
      `,
      'https://example.com/news',
    );

    const quality = evaluateArticleQuality(article);
    expect(quality.usable).toBe(false);
    expect(quality.reasons).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/link text dominates|too many short link-like paragraphs|too few long paragraphs/),
      ]),
    );
  });
});

describe('isUsableArticle', () => {
  it('passes a normal long article and reports quality metrics', () => {
    const article = {
        title: 'Useful title',
        byline: null,
        siteName: null,
        excerpt: null,
        contentHtml:
          '<p>This is a useful long paragraph that clearly discusses the same useful title subject in detail.</p><p>Another long paragraph continues the useful title story with facts and context for readers.</p>',
        textContent:
          'This is a useful long paragraph that clearly discusses the same useful title subject in detail. Another long paragraph continues the useful title story with facts and context for readers.',
        textLength: 166,
        wordCount: 15,
        paragraphCount: 2,
        publishedAt: null,
        requestedUrl: 'https://example.com/story',
        finalUrl: 'https://example.com/story',
    };
    const quality = evaluateArticleQuality(article);

    expect(quality.usable).toBe(true);
    expect(quality.reasons).toEqual([]);
    expect(quality.metrics).toMatchObject({
      textLength: 166,
      paragraphCount: 2,
      longParagraphCount: 2,
    });
    expect(isUsableArticle(article)).toBe(true);
  });

  it('rejects content when copyright and source notices are the main body', () => {
    const article = {
      title: '习近平会见孟加拉国总理塔里克',
      byline: 'chinanews',
      siteName: null,
      excerpt: null,
      contentHtml:
        '<p>本网站所刊载信息，不代表中新网观点。刊用本网站稿件，务经书面授权。</p><p>未经授权禁止转载、摘编、复制及建立镜像，违者将依法追究法律责任。</p><p>Copyright ©1999-2026 All Rights Reserved</p>',
      textContent:
        '本网站所刊载信息，不代表中新网观点。刊用本网站稿件，务经书面授权。未经授权禁止转载、摘编、复制及建立镜像，违者将依法追究法律责任。Copyright ©1999-2026 All Rights Reserved',
      textLength: 111,
      wordCount: 4,
      paragraphCount: 3,
      publishedAt: null,
      requestedUrl: 'https://example.com/copyright',
      finalUrl: 'https://example.com/copyright',
    };
    const quality = evaluateArticleQuality(article);

    expect(quality.usable).toBe(false);
    expect(quality.reasons).toContain('noise text dominates extracted content');
  });

  it('rejects copyright-only content even when it has multiple paragraphs', () => {
    const article = extractArticleFromHtml(
      `
        <html>
          <head><title>Copyright notice page</title></head>
          <body>
            <main>
              <h1>Copyright notice page</h1>
              <p>本网站所刊载信息，不代表本站观点。刊用本网站稿件，务经书面授权。</p>
              <p>未经授权禁止转载、摘编、复制及建立镜像，违者将依法追究法律责任。</p>
              <p>Copyright ©1999-2026 All Rights Reserved</p>
            </main>
          </body>
        </html>
      `,
      'https://example.com/copyright-only',
    );

    const quality = evaluateArticleQuality(article);
    expect(quality.usable).toBe(false);
    expect(quality.reasons).toContain('noise text dominates extracted content');
  });

  it('does not treat a single card in a news list as a short article', () => {
    const article = extractArticleFromHtml(
      `
        <html>
          <head><title>Latest updates</title></head>
          <body>
            <main>
              <h1>Latest updates</h1>
              <section class="recommend-list">
                <div class="card"><a href="/news/1"><p>Short headline about a policy decision</p></a></div>
                <div class="card"><a href="/news/2"><p>Another short headline about a public event</p></a></div>
                <div class="card"><a href="/news/3"><p>Third short headline about a market change</p></a></div>
              </section>
            </main>
          </body>
        </html>
      `,
      'https://example.com/news-list',
    );

    expect(evaluateArticleQuality(article).usable).toBe(false);
  });

  it('keeps a normal article when copyright or source text only appears at the end', () => {
    const article = {
      title: 'Venezuela earthquakes rescue teams search for survivors',
      byline: null,
      siteName: null,
      excerpt: null,
      contentHtml:
        '<p>Venezuela earthquakes rescue teams searched collapsed buildings for survivors through the night as hospitals treated thousands of injured residents.</p><p>Officials said emergency crews opened routes into coastal neighborhoods and delivered medical supplies while families waited for news.</p><p>Source: staff report. Copyright notice.</p>',
      textContent:
        'Venezuela earthquakes rescue teams searched collapsed buildings for survivors through the night as hospitals treated thousands of injured residents. Officials said emergency crews opened routes into coastal neighborhoods and delivered medical supplies while families waited for news. Source: staff report. Copyright notice.',
      textLength: 298,
      wordCount: 38,
      paragraphCount: 3,
      publishedAt: null,
      requestedUrl: 'https://example.com/normal-with-footer',
      finalUrl: 'https://example.com/normal-with-footer',
    };
    const quality = evaluateArticleQuality(article);

    expect(quality.usable).toBe(true);
    expect(quality.metrics.noiseTextRatio).toBeLessThan(0.3);
  });

  it('rejects home pages or list pages with dense short links and few long paragraphs', () => {
    const links = Array.from(
      { length: 35 },
      (_, index) => `<p><a href="/section/${index}">News Section ${index}</a></p>`,
    ).join('');
    const text = Array.from({ length: 35 }, (_, index) => `News Section ${index}`).join(' ');
    const quality = evaluateArticleQuality({
      title: 'Breaking news, video and latest top stories',
      byline: null,
      siteName: null,
      excerpt: null,
      contentHtml: `<nav><a href="/">Home</a><a href="/world">World</a><a href="/sport">Sport</a></nav>${links}`,
      textContent: `Home World Sport ${text}`,
      textLength: 560,
      wordCount: 80,
      paragraphCount: 35,
      publishedAt: null,
      requestedUrl: 'https://example.com/news',
      finalUrl: 'https://example.com/news',
    });

    expect(quality.usable).toBe(false);
    expect(quality.reasons).toContain('link text dominates extracted content');
    expect(quality.reasons).toContain('too many short link-like paragraphs');
  });

  it('does not reject a short but structured article because of a fixed 500 character threshold', () => {
    const article = {
      title: 'Brief storm update',
      byline: null,
      siteName: null,
      excerpt: null,
      contentHtml:
        '<p>Brief storm update: officials reopened the bridge after crews cleared fallen trees from the route.</p><p>The city said buses resumed service and no serious injuries were reported.</p>',
      textContent:
        'Brief storm update: officials reopened the bridge after crews cleared fallen trees from the route. The city said buses resumed service and no serious injuries were reported.',
      textLength: 157,
      wordCount: 25,
      paragraphCount: 2,
      publishedAt: null,
      requestedUrl: 'https://example.com/brief',
      finalUrl: 'https://example.com/brief',
    };

    expect(evaluateArticleQuality(article).usable).toBe(true);
  });

  it('rejects an article without a title', () => {
    expect(
      isUsableArticle({
        title: '',
        byline: null,
        siteName: null,
        excerpt: null,
        contentHtml: '<p>Long but untitled content.</p><p>Second paragraph.</p>',
        textContent:
          'This article has enough readable text to pass the first simple quality check with multiple paragraphs.',
        textLength: 98,
        wordCount: 15,
        paragraphCount: 2,
        publishedAt: null,
        requestedUrl: 'https://example.com/story',
        finalUrl: 'https://example.com/story',
      }),
    ).toBe(false);
  });
});
