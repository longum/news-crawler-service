import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import type { Article } from './types.js';

const ARTICLE_QUALITY_RULES = {
  minTextLength: 80,
  minParagraphCount: 2,
  minLongParagraphCount: 2,
  longParagraphLength: 55,
  maxLinkTextRatio: 0.45,
  maxNoiseTextRatio: 0.55,
  minTitleOverlap: 0.12,
  minBodyTextRatio: 0.35,
  maxShortLinkParagraphs: 18,
} as const;

const removableSelectors = 'script, iframe, object, embed, link[rel="preload"], link[rel="modulepreload"]';
const lowRiskNoiseSelectors =
  '[class*="share" i], [id*="share" i], [aria-label*="share" i], [class*="related" i], [id*="related" i], aside';
const urlAttributeNames = new Set(['href', 'src', 'action', 'formaction', 'poster', 'xlink:href']);
const dangerousUrlPattern = /^(?:javascript|data|vbscript):/i;
const excludedContainerPattern =
  /(?:header|footer|nav|aside|comment|share|related|recommend|ranking|menu|pagination|copyright|advertisement|ads?|selected[_-]?news|top[_-]?stories|more[_-]?news|card|list)/i;
const noiseTextPattern =
  /(?:copyright|all rights reserved|未经授权|禁止转载|转载|摘编|复制|镜像|版权|责任编辑|编辑[:：]|来源[:：]|网站声明|刊用本网站稿件|联系我们|联系方式|登录|注册|分享|客户端|导航|频道|栏目|subscribe|sign in|log in|share this|related|recommended|advertisement)/i;
const articleDatePatterns = [
  /(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/,
  /(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/,
  /(\d{4})\/(\d{1,2})\/(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/,
];
const dateFieldPattern =
  /["'](?:datePublished|dateCreated|uploadDate|pubDate|publishDate|publishedTime|published_at|publish_time|publishTime|pubtime|releaseTime|created_at)["']\s*:\s*["']([^"']+)["']/gi;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hasExcludedContainerSignal(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  const value = [
    tagName,
    element.id,
    element.className,
    element.getAttribute('role'),
    element.getAttribute('aria-label'),
  ]
    .join(' ')
    .toLowerCase();
  return excludedContainerPattern.test(value);
}

function isInsideExcludedContainer(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (hasExcludedContainerSignal(current)) return true;
  }
  return false;
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeArticleDate(value: unknown): string | null {
  const parsed = normalizeDate(value);
  if (parsed) return parsed;
  if (typeof value !== 'string') return null;

  for (const pattern of articleDatePatterns) {
    const match = value.match(pattern);
    if (!match) continue;
    const [, year, month, day, hour, minute, second = '0'] = match;
    const date = new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
      ),
    );
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

function findDateInJsonLd(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const date = findDateInJsonLd(item);
      if (date) return date;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of [
    'datePublished',
    'dateCreated',
    'uploadDate',
    'pubDate',
    'publishDate',
    'publishedTime',
    'published_at',
    'publish_time',
    'publishTime',
    'pubtime',
    'releaseTime',
    'created_at',
  ]) {
    const date = normalizeArticleDate(record[key]);
    if (date) return date;
  }

  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'about']) {
    const date = findDateInJsonLd(record[key]);
    if (date) return date;
  }

  return null;
}

function extractPublishedAt(document: Document): string | null {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const date = findDateInJsonLd(JSON.parse(script.textContent ?? ''));
      if (date) return date;
    } catch {
      // Ignore invalid JSON-LD and continue with lower-confidence metadata.
    }
  }

  const metaSelectors = [
    'meta[property="article:published_time"]',
    'meta[property="og:published_time"]',
    'meta[name="pubdate"]',
    'meta[name="publishdate"]',
    'meta[name="publishDate"]',
    'meta[name="publishedTime"]',
    'meta[name="pubDate"]',
    'meta[name="publish_time"]',
    'meta[name="publishTime"]',
    'meta[name="date"]',
    'meta[name="dc.date"]',
    'meta[name="dcterms.created"]',
    'meta[itemprop="datePublished"]',
  ];
  for (const selector of metaSelectors) {
    const date = normalizeArticleDate(document.querySelector(selector)?.getAttribute('content'));
    if (date) return date;
  }

  for (const time of document.querySelectorAll('time')) {
    const date = normalizeArticleDate(time.getAttribute('datetime') ?? time.textContent);
    if (date) return date;
  }

  const scriptText = [...document.querySelectorAll('script')]
    .map((script) => script.textContent ?? '')
    .join('\n')
    .slice(0, 200_000);
  for (const match of scriptText.matchAll(dateFieldPattern)) {
    const date = normalizeArticleDate(match[1]);
    if (date) return date;
  }

  const headerText = normalizeText(
    [
      document.querySelector('article')?.querySelector('h1, h2')?.textContent,
      document.querySelector('article')?.textContent?.slice(0, 1200),
      document.querySelector('main')?.textContent?.slice(0, 1200),
      document.body?.textContent?.slice(0, 1200),
    ]
      .filter(Boolean)
      .join(' '),
  );
  const headerDate = normalizeArticleDate(headerText);
  if (headerDate) return headerDate;

  return null;
}

export function sanitizeContentHtml(contentHtml: string, baseUrl: string): string {
  const dom = new JSDOM(`<main>${contentHtml}</main>`, { url: baseUrl });
  const { document } = dom.window;

  document.querySelectorAll(removableSelectors).forEach((element) => element.remove());
  document.querySelectorAll(lowRiskNoiseSelectors).forEach((element) => element.remove());
  document.querySelectorAll('*').forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const attributeName = attribute.name.toLowerCase();
      if (attributeName.startsWith('on') || attributeName === 'srcdoc') {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (!urlAttributeNames.has(attributeName)) continue;
      if (attributeName === 'href' && /^#[\w-]+$/i.test(attribute.value)) {
        element.removeAttribute(attribute.name);
        continue;
      }
      try {
        const url = new URL(attribute.value, baseUrl);
        if (dangerousUrlPattern.test(url.protocol)) {
          element.removeAttribute(attribute.name);
        }
      } catch {
        element.removeAttribute(attribute.name);
      }
    }
  });
  document.querySelectorAll('figure').forEach((figure) => {
    if (!normalizeText(figure.textContent ?? '') && figure.querySelectorAll('img, picture, video').length === 0) {
      figure.remove();
    }
  });

  return document.querySelector('main')?.innerHTML.trim() ?? '';
}

function getParagraphTexts(contentHtml: string, baseUrl: string): string[] {
  const dom = new JSDOM(`<main>${contentHtml}</main>`, { url: baseUrl });
  return [...dom.window.document.querySelectorAll('p')].map((paragraph) =>
    normalizeText(paragraph.textContent ?? ''),
  );
}

function countParagraphs(contentHtml: string, baseUrl: string): number {
  return getParagraphTexts(contentHtml, baseUrl).filter((text) => text.length >= 20).length;
}

function countLongParagraphs(contentHtml: string, baseUrl: string): number {
  return getParagraphTexts(contentHtml, baseUrl).filter(
    (text) => text.length >= ARTICLE_QUALITY_RULES.longParagraphLength,
  ).length;
}

function countWords(textContent: string): number {
  return textContent.match(/\S+/g)?.length ?? 0;
}

function countCjkCharacters(value: string): number {
  return value.match(/[\p{Script=Han}]/gu)?.length ?? 0;
}

function tokenizeTitle(value: string): string[] {
  const normalized = value.toLowerCase();
  const words = normalized.match(/[a-z0-9]{4,}/g) ?? [];
  const cjk = normalized.match(/[\p{Script=Han}]/gu) ?? [];
  return [...new Set([...words, ...cjk])].filter((token) => !noiseTextPattern.test(token));
}

function calculateTitleOverlap(title: string, textContent: string): number {
  const tokens = tokenizeTitle(title);
  if (tokens.length === 0) return title.trim() ? 1 : 0;
  const body = textContent.toLowerCase();
  const matches = tokens.filter((token) => body.includes(token)).length;
  return matches / tokens.length;
}

function getQualityDom(article: Article): Document {
  return new JSDOM(`<main>${article.contentHtml}</main>`, { url: article.finalUrl }).window.document;
}

function calculateLinkTextRatio(document: Document, textLength: number): number {
  if (textLength <= 0) return 0;
  const linkTextLength = [...document.querySelectorAll('a')]
    .map((anchor) => normalizeText(anchor.textContent ?? '').length)
    .reduce((total, length) => total + length, 0);
  return linkTextLength / textLength;
}

function calculateElementLinkTextRatio(element: Element, textLength: number): number {
  if (textLength <= 0) return 0;
  const linkTextLength = [...element.querySelectorAll('a')]
    .map((anchor) => normalizeText(anchor.textContent ?? '').length)
    .reduce((total, length) => total + length, 0);
  return linkTextLength / textLength;
}

function calculateElementNoiseTextRatio(texts: string[], textLength: number): number {
  if (textLength <= 0) return 0;
  const noiseLength = texts
    .filter((text) => noiseTextPattern.test(text))
    .reduce((total, text) => total + text.length, 0);
  return Math.min(noiseLength / textLength, 1);
}

function calculateNoiseTextRatio(article: Article, document: Document): number {
  const paragraphTexts = [...document.querySelectorAll('p, li, figcaption')]
    .map((element) => normalizeText(element.textContent ?? ''))
    .filter(Boolean);
  const noiseLength = paragraphTexts
    .filter((text) => noiseTextPattern.test(text))
    .reduce((total, text) => total + text.length, 0);
  return article.textLength > 0 ? Math.min(noiseLength / article.textLength, 1) : 0;
}

function calculateBodyTextRatio(document: Document, textLength: number): number {
  if (textLength <= 0) return 0;
  const paragraphTextLength = [...document.querySelectorAll('p')]
    .map((paragraph) => normalizeText(paragraph.textContent ?? '').length)
    .filter((length) => length >= 20)
    .reduce((total, length) => total + length, 0);
  return paragraphTextLength / textLength;
}

function countShortLinkParagraphs(document: Document): number {
  return [...document.querySelectorAll('p, li')]
    .map((element) => {
      const text = normalizeText(element.textContent ?? '');
      const linkText = [...element.querySelectorAll('a')]
        .map((anchor) => normalizeText(anchor.textContent ?? ''))
        .join('');
      return { text, linkText };
    })
    .filter(({ text, linkText }) => text.length > 0 && text.length <= 80 && linkText.length / text.length >= 0.6)
    .length;
}

export interface ArticleQualityResult {
  usable: boolean;
  reasons: string[];
  metrics: {
    textLength: number;
    paragraphCount: number;
    longParagraphCount: number;
    linkTextRatio: number;
    noiseTextRatio: number;
  };
}

export function evaluateArticleQuality(article: Article | null): ArticleQualityResult {
  if (!article) {
    return {
      usable: false,
      reasons: ['readability did not return an article'],
      metrics: {
        textLength: 0,
        paragraphCount: 0,
        longParagraphCount: 0,
        linkTextRatio: 0,
        noiseTextRatio: 0,
      },
    };
  }

  const document = getQualityDom(article);
  const paragraphCount = article.paragraphCount;
  const longParagraphCount = article.longParagraphCount ?? countLongParagraphs(article.contentHtml, article.finalUrl);
  const linkTextRatio = calculateLinkTextRatio(document, article.textLength);
  const noiseTextRatio = calculateNoiseTextRatio(article, document);
  const bodyTextRatio = calculateBodyTextRatio(document, article.textLength);
  const shortLinkParagraphCount = countShortLinkParagraphs(document);
  const titleOverlap = calculateTitleOverlap(article.title, article.textContent);
  const cjkLength = countCjkCharacters(article.textContent);
  const minTextLength =
    article.extractorUsed === 'dom-fallback' && cjkLength >= 20
      ? 28
      : cjkLength >= 40
        ? 60
        : ARTICLE_QUALITY_RULES.minTextLength;
  const shortDomFallback =
    article.extractorUsed === 'dom-fallback' &&
    Boolean(article.title.trim()) &&
    article.textLength >= minTextLength &&
    paragraphCount >= 1 &&
    linkTextRatio <= 0.05 &&
    noiseTextRatio <= 0.1 &&
    titleOverlap > 0 &&
    bodyTextRatio >= ARTICLE_QUALITY_RULES.minBodyTextRatio;
  const reasons: string[] = [];

  if (!article.title.trim()) reasons.push('missing title');
  if (article.textLength < minTextLength) reasons.push('text is too short');
  if (!shortDomFallback && paragraphCount < ARTICLE_QUALITY_RULES.minParagraphCount) {
    reasons.push('too few useful paragraphs');
  }
  if (!shortDomFallback && longParagraphCount < ARTICLE_QUALITY_RULES.minLongParagraphCount) {
    reasons.push('too few long paragraphs');
  }
  if (linkTextRatio > ARTICLE_QUALITY_RULES.maxLinkTextRatio) {
    reasons.push('link text dominates extracted content');
  }
  if (shortLinkParagraphCount > ARTICLE_QUALITY_RULES.maxShortLinkParagraphs) {
    reasons.push('too many short link-like paragraphs');
  }
  if (noiseTextRatio > ARTICLE_QUALITY_RULES.maxNoiseTextRatio) {
    reasons.push('noise text dominates extracted content');
  }
  if (!shortDomFallback && titleOverlap < ARTICLE_QUALITY_RULES.minTitleOverlap) {
    reasons.push('title is weakly related to extracted text');
  }
  if (bodyTextRatio < ARTICLE_QUALITY_RULES.minBodyTextRatio) {
    reasons.push('main paragraph text is too small within extracted content');
  }

  return {
    usable: reasons.length === 0,
    reasons,
    metrics: {
      textLength: article.textLength,
      paragraphCount,
      longParagraphCount,
      linkTextRatio,
      noiseTextRatio,
    },
  };
}

function closestPreviousText(element: Element, selector: string): string {
  for (let current: Element | null = element; current; current = current.parentElement) {
    let sibling = current.previousElementSibling;
    while (sibling) {
      const found = sibling.matches(selector) ? sibling : sibling.querySelector(selector);
      const text = normalizeText(found?.textContent ?? '');
      if (text) return text;
      sibling = sibling.previousElementSibling;
    }
  }
  return '';
}

function nearbyPreviousText(element: Element, maxLength = 900): string {
  const parts: string[] = [];
  for (let current: Element | null = element; current && parts.join(' ').length < maxLength; current = current.parentElement) {
    let sibling = current.previousElementSibling;
    while (sibling && parts.join(' ').length < maxLength) {
      parts.push(normalizeText(sibling.textContent ?? ''));
      sibling = sibling.previousElementSibling;
    }
  }
  return normalizeText(parts.join(' ')).slice(0, maxLength);
}

function getMainTitle(document: Document): string {
  return normalizeText(
    document.querySelector('article h1, main h1, h1')?.textContent ??
      document.querySelector('meta[property="og:title"]')?.getAttribute('content') ??
      document.title.replace(/[-_|].*$/, ''),
  );
}

function isNearTitleOrMetadata(element: Element, title: string): boolean {
  const ownText = normalizeText(element.textContent ?? '');
  if (title && ownText.includes(title)) return true;
  const previousText = closestPreviousText(element, 'h1, h2, time, [datetime]');
  if (previousText && (!title || previousText.includes(title) || normalizeArticleDate(previousText))) return true;
  const parentText = normalizeText(element.parentElement?.textContent?.slice(0, 600) ?? '');
  return Boolean((title && parentText.includes(title)) || normalizeArticleDate(parentText));
}

function hasNearbyMetadata(element: Element): boolean {
  const nearbyText = normalizeText(
    [
      closestPreviousText(element, 'time, [datetime], .meta, .source, .author, .byline'),
      nearbyPreviousText(element),
      element.parentElement?.textContent?.slice(0, 500),
    ].join(' '),
  );
  return Boolean(
    normalizeArticleDate(nearbyText) ||
      /(?:来源|作者|责任编辑|发布|时间|date|source|author|byline)/i.test(nearbyText),
  );
}

function directParagraphTexts(element: Element): string[] {
  return [...element.querySelectorAll('p')]
    .filter((paragraph) => !isInsideExcludedContainer(paragraph))
    .map((paragraph) => normalizeText(paragraph.textContent ?? ''))
    .filter((text) => text.length >= 12 && !noiseTextPattern.test(text));
}

interface DomFallbackCandidate {
  element: Element;
  textContent: string;
  paragraphTexts: string[];
  textLength: number;
  paragraphCount: number;
  longParagraphCount: number;
  linkTextRatio: number;
  noiseTextRatio: number;
  childLinkCount: number;
  nearTitle: boolean;
  hasMetadata: boolean;
  listLike: boolean;
  score: number;
}

function buildDomFallbackCandidate(element: Element, title: string): DomFallbackCandidate | null {
  if (isInsideExcludedContainer(element)) return null;
  const paragraphTexts = directParagraphTexts(element);
  if (paragraphTexts.length === 0) return null;
  const textContent = normalizeText(paragraphTexts.join(' '));
  const textLength = textContent.length;
  const paragraphCount = paragraphTexts.length;
  const longParagraphCount = paragraphTexts.filter((text) => text.length >= ARTICLE_QUALITY_RULES.longParagraphLength).length;
  const linkTextRatio = calculateElementLinkTextRatio(element, textLength);
  const noiseTextRatio = calculateElementNoiseTextRatio(paragraphTexts, textLength);
  const childLinkCount = element.querySelectorAll('a').length;
  const listItemCount = element.querySelectorAll('li').length;
  const shortParagraphCount = paragraphTexts.filter((text) => text.length < 45).length;
  const listLike =
    listItemCount >= 3 ||
    (childLinkCount >= 3 && linkTextRatio > 0.2) ||
    (paragraphCount >= 3 && shortParagraphCount / paragraphCount > 0.75 && childLinkCount >= paragraphCount);
  const nearTitle = isNearTitleOrMetadata(element, title);
  const hasMetadata = hasNearbyMetadata(element);
  const titleOverlap = calculateTitleOverlap(title, textContent);
  const singleShortArticle =
    paragraphCount === 1 &&
    textLength >= 28 &&
    linkTextRatio <= 0.05 &&
    noiseTextRatio <= 0.1 &&
    nearTitle &&
    hasMetadata &&
    !listLike &&
    titleOverlap > 0 &&
    normalizeText(title) !== textContent;
  const multiParagraphArticle =
    paragraphCount >= 2 &&
    textLength >= 80 &&
    linkTextRatio <= ARTICLE_QUALITY_RULES.maxLinkTextRatio &&
    noiseTextRatio <= ARTICLE_QUALITY_RULES.maxNoiseTextRatio &&
    !listLike &&
    (nearTitle || hasMetadata);

  if (!singleShortArticle && !multiParagraphArticle) return null;

  const score =
    (singleShortArticle ? 20 : 0) +
    Math.min(textLength, 600) / 30 +
    longParagraphCount * 3 +
    (nearTitle ? 8 : 0) +
    (hasMetadata ? 6 : 0) -
    childLinkCount * 1.5 -
    linkTextRatio * 20 -
    noiseTextRatio * 30 -
    element.outerHTML.length / 5000;

  return {
    element,
    textContent,
    paragraphTexts,
    textLength,
    paragraphCount,
    longParagraphCount,
    linkTextRatio,
    noiseTextRatio,
    childLinkCount,
    nearTitle,
    hasMetadata,
    listLike,
    score,
  };
}

function chooseBestDomFallbackCandidate(document: Document, title: string): DomFallbackCandidate | null {
  const candidates = [...document.querySelectorAll('article, main, section, div')]
    .map((element) => buildDomFallbackCandidate(element, title))
    .filter((candidate): candidate is DomFallbackCandidate => Boolean(candidate))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.noiseTextRatio - right.noiseTextRatio ||
        left.linkTextRatio - right.linkTextRatio ||
        left.element.outerHTML.length - right.element.outerHTML.length,
    );

  const best = candidates[0];
  if (!best) return null;

  for (const candidate of candidates.slice(1)) {
    if (!best.element.contains(candidate.element)) continue;
    if (
      candidate.paragraphCount === best.paragraphCount &&
      candidate.linkTextRatio <= best.linkTextRatio &&
      candidate.noiseTextRatio <= best.noiseTextRatio &&
      candidate.element.outerHTML.length < best.element.outerHTML.length
    ) {
      return candidate;
    }
  }

  return best;
}

function extractNearbyByline(element: Element): string | null {
  const text = normalizeText(
    [
      closestPreviousText(element, '.author, .byline'),
      element.parentElement?.textContent?.slice(0, 500),
    ].join(' '),
  );
  const match = text.match(/(?:作者|byline|author)[:：]?\s*([\p{Script=Han}\w\s,，·.-]{2,40})/iu);
  return match ? normalizeText(match[1]) : null;
}

function extractArticleWithDomFallback(
  html: string,
  requestedUrl: string,
  finalUrl: string,
  publishedAt: string | null,
): Article | null {
  const dom = new JSDOM(html, { url: finalUrl });
  const { document } = dom.window;
  const title = getMainTitle(document);
  const candidate = chooseBestDomFallbackCandidate(document, title);
  if (!candidate) return null;

  const contentHtml = sanitizeContentHtml(
    `<div>${candidate.paragraphTexts.map((text) => `<p>${escapeHtml(text)}</p>`).join('')}</div>`,
    finalUrl,
  );
  const textContent = normalizeText(stripHtmlText(contentHtml, finalUrl));

  return {
    title,
    byline: extractNearbyByline(candidate.element),
    siteName: null,
    excerpt: null,
    contentHtml,
    textContent,
    textLength: textContent.length,
    wordCount: countWords(textContent),
    paragraphCount: countParagraphs(contentHtml, finalUrl),
    longParagraphCount: countLongParagraphs(contentHtml, finalUrl),
    publishedAt:
      publishedAt ??
      normalizeArticleDate(
        `${nearbyPreviousText(candidate.element)} ${candidate.element.parentElement?.textContent?.slice(0, 800) ?? ''}`,
      ),
    requestedUrl,
    finalUrl,
    extractorUsed: 'dom-fallback',
  };
}

function stripHtmlText(contentHtml: string, baseUrl: string): string {
  const dom = new JSDOM(`<main>${contentHtml}</main>`, { url: baseUrl });
  return normalizeText(dom.window.document.querySelector('main')?.textContent ?? '');
}

export function extractArticleFromHtml(
  html: string,
  requestedUrl: string,
  finalUrl = requestedUrl,
): Article | null {
  const metadataDom = new JSDOM(html, { url: finalUrl });
  const publishedAt = extractPublishedAt(metadataDom.window.document);
  const readabilityDom = new JSDOM(html, { url: finalUrl });
  const parsed = new Readability(readabilityDom.window.document).parse();
  if (!parsed) return extractArticleWithDomFallback(html, requestedUrl, finalUrl, publishedAt);

  const contentHtml = sanitizeContentHtml(parsed.content ?? '', finalUrl);
  const textContent = normalizeText(parsed.textContent ?? '');
  const readabilityArticle: Article = {
    title: normalizeText(parsed.title ?? ''),
    byline: parsed.byline ? normalizeText(parsed.byline) : null,
    siteName: parsed.siteName ? normalizeText(parsed.siteName) : null,
    excerpt: parsed.excerpt ? normalizeText(parsed.excerpt) : null,
    contentHtml,
    textContent,
    textLength: textContent.length,
    wordCount: countWords(textContent),
    paragraphCount: countParagraphs(contentHtml, finalUrl),
    longParagraphCount: countLongParagraphs(contentHtml, finalUrl),
    publishedAt,
    requestedUrl,
    finalUrl,
    extractorUsed: 'readability',
  };

  if (evaluateArticleQuality(readabilityArticle).usable) return readabilityArticle;

  const fallbackArticle = extractArticleWithDomFallback(html, requestedUrl, finalUrl, publishedAt);
  return fallbackArticle ?? readabilityArticle;
}

export function isUsableArticle(article: Article | null): article is Article {
  return evaluateArticleQuality(article).usable;
}
