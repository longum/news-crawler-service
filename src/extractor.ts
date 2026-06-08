import { load, type Cheerio, type CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { HubItem } from './types.js';

const MAX_ITEMS = 30;
const MIN_TITLE_LENGTH = 15;
const DATE_PATTERN =
  /\b(?:\d{4}-\d{1,2}-\d{1,2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4})\b/i;

const unwantedTextPattern =
  /^(?:home|about|contact|menu|search|next|previous|older|newer|read more|learn more|view all|see all|subscribe|sign in|log in|share|print)$/i;
const unwantedTitlePhrasePattern = /(?:skip to|learn more|subscribe|main content)/i;
const unwantedContextSelector = 'nav, footer, header, [role="navigation"], [aria-label*="breadcrumb" i]';
const unwantedUrlPattern =
  /(?:facebook\.com|twitter\.com|x\.com|linkedin\.com|instagram\.com|youtube\.com|mailto:|javascript:|\/share(?:\/|$)|[?&](?:page|sort|filter)=)/i;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function toAbsoluteHttpUrl(href: string, baseUrl: string): URL | null {
  try {
    const url = new URL(href, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (unwantedUrlPattern.test(url.href)) return null;
    if (/\.(?:jpg|jpeg|png|gif|svg|webp|pdf|zip)(?:$|\?)/i.test(url.pathname)) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function normalizeDate(value: string): string | null {
  const match = value.match(DATE_PATTERN);
  if (!match) return null;

  const isoParts = match[0].match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoParts) {
    return `${isoParts[1]}-${isoParts[2].padStart(2, '0')}-${isoParts[3].padStart(2, '0')}`;
  }

  const monthNames = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];
  const englishParts = match[0].replace(',', '').split(/\s+/);
  const month = monthNames.findIndex((name) => name.startsWith(englishParts[0].toLowerCase()));
  if (month < 0) return null;

  return `${englishParts[2]}-${String(month + 1).padStart(2, '0')}-${englishParts[1].padStart(2, '0')}`;
}

function extractNearbyDate($: CheerioAPI, anchor: Cheerio<AnyNode>): string | null {
  const container = anchor.closest('article, li, .card, .item, .news, .result').first();
  const parent = anchor.parent();
  const parentTag = parent.prop('tagName')?.toLowerCase();
  const scope =
    container.length || !['body', 'html', 'main'].includes(parentTag ?? '') ? container.add(parent).first() : null;
  if (!scope?.length) return null;

  const time = scope.find('time').first();
  const explicit = time.attr('datetime') ?? time.text();

  return normalizeDate(explicit) ?? normalizeDate(scope.text());
}

export function extractCandidateItems(html: string, pageUrl: string): HubItem[] {
  const $ = load(html);
  const base = new URL(pageUrl);
  base.hash = '';
  const seen = new Set<string>();
  const candidates: Array<HubItem & { sameHost: boolean; newsPath: boolean }> = [];

  $('a[href]').each((_, element) => {
    const anchor = $(element);
    const title = normalizeText(anchor.text() || anchor.attr('aria-label') || '');
    if (
      title.length < MIN_TITLE_LENGTH ||
      unwantedTextPattern.test(title) ||
      unwantedTitlePhrasePattern.test(title)
    ) {
      return;
    }
    if (anchor.closest(unwantedContextSelector).length) return;
    if (/\b(?:share|follow us|pagination|breadcrumb)\b/i.test(title)) return;

    const url = toAbsoluteHttpUrl(anchor.attr('href') ?? '', pageUrl);
    if (!url || url.href === base.href || seen.has(url.href)) return;

    seen.add(url.href);
    candidates.push({
      title,
      url: url.href,
      published_at: extractNearbyDate($, anchor),
      sameHost: url.hostname === base.hostname,
      newsPath: url.pathname.includes('/news/'),
    });
  });

  return candidates
    .sort(
      (left, right) =>
        Number(right.newsPath) - Number(left.newsPath) ||
        Number(Boolean(right.published_at)) - Number(Boolean(left.published_at)) ||
        Number(right.sameHost) - Number(left.sameHost),
    )
    .slice(0, MAX_ITEMS)
    .map(({ sameHost: _sameHost, newsPath: _newsPath, ...item }) => item);
}

export function extractNextUrl(html: string, pageUrl: string): string | null {
  const $ = load(html);
  const currentUrl = new URL(pageUrl);
  currentUrl.hash = '';

  const anchors = $('a[href]')
    .toArray()
    .filter((element) => !$(element).is('[aria-current="page"], [title*="current page" i]'));
  const priorityMatchers = [
    (anchor: Cheerio<AnyNode>) => (anchor.attr('rel') ?? '').toLowerCase().split(/\s+/).includes('next'),
    (anchor: Cheerio<AnyNode>) => /(?:next|›|下一页)/i.test(normalizeText(anchor.text())),
  ];

  const resolveAnchorUrl = (anchor: Cheerio<AnyNode>): URL | null => {
    try {
      const nextUrl = new URL(anchor.attr('href') ?? '', pageUrl);
      nextUrl.hash = '';
      if (!['http:', 'https:'].includes(nextUrl.protocol) || nextUrl.href === currentUrl.href) return null;
      return nextUrl;
    } catch {
      return null;
    }
  };

  for (const matches of priorityMatchers) {
    for (const element of anchors) {
      const anchor = $(element);
      if (!matches(anchor)) continue;

      const nextUrl = resolveAnchorUrl(anchor);
      if (nextUrl) return nextUrl.href;
    }
  }

  const currentPage = Number(currentUrl.searchParams.get('page') ?? 0);
  const pageUrls = anchors
    .map((element) => resolveAnchorUrl($(element)))
    .filter((url): url is URL => Boolean(url?.searchParams.has('page')));
  const nextNumberedUrl = pageUrls
    .map((url) => ({ url, page: Number(url.searchParams.get('page')) }))
    .filter(({ page }) => Number.isInteger(page) && page > currentPage)
    .sort((left, right) => left.page - right.page)[0]?.url;

  if (nextNumberedUrl) return nextNumberedUrl.href;
  const unnumberedPageUrl = pageUrls.find((url) => Number.isNaN(Number(url.searchParams.get('page'))));
  if (unnumberedPageUrl) return unnumberedPageUrl.href;

  return null;
}
