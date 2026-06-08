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
