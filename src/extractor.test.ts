import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractCandidateItems, extractItemsBySelectors, extractNextUrl } from './extractor.js';

describe('extractCandidateItems', () => {
  it('returns useful absolute article links with nearby dates', () => {
    const html = `
      <nav><a href="/about">About USGS</a></nav>
      <main>
        <article>
          <time datetime="2026-06-05">June 5, 2026</time>
          <h2><a href="/news/featured-story/groundwater-update">New groundwater monitoring data released across the West</a></h2>
        </article>
        <article>
          <span>May 20, 2026</span>
          <a href="https://www.usgs.gov/news/science-snippet/river-flows">Scientists publish new river flow observations</a>
        </article>
        <a href="/news?page=2">Next</a>
        <a href="https://facebook.com/share">Share on Facebook</a>
      </main>
    `;

    expect(extractCandidateItems(html, 'https://www.usgs.gov/water/news')).toEqual([
      {
        title: 'New groundwater monitoring data released across the West',
        url: 'https://www.usgs.gov/news/featured-story/groundwater-update',
        published_at: '2026-06-05',
      },
      {
        title: 'Scientists publish new river flow observations',
        url: 'https://www.usgs.gov/news/science-snippet/river-flows',
        published_at: '2026-05-20',
      },
    ]);
  });

  it('deduplicates URLs and limits the result to 30 items', () => {
    const links = Array.from(
      { length: 35 },
      (_, index) => `<a href="/news/item-${index}">Candidate news headline number ${index}</a>`,
    ).join('');

    const items = extractCandidateItems(
      `${links}<a href="/news/item-0">Duplicate candidate headline</a>`,
      'https://example.com/news',
    );

    expect(items).toHaveLength(30);
    expect(new Set(items.map((item) => item.url)).size).toBe(30);
  });

  it('filters unwanted title phrases and the hub page itself', () => {
    const html = `
      <main>
        <a href="/mission-areas/water-resources/news">Water Resources News and Updates</a>
        <a href="#main-content">Skip to main content and page details</a>
        <a href="/learn">Learn more about water resources science</a>
        <a href="/subscribe">Subscribe to weekly water resources news</a>
        <a href="/main-content">Open main content for water resources</a>
        <a href="/news/featured-story/valid">Valid candidate news headline from USGS</a>
      </main>
    `;

    expect(
      extractCandidateItems(html, 'https://www.usgs.gov/mission-areas/water-resources/news'),
    ).toEqual([
      {
        title: 'Valid candidate news headline from USGS',
        url: 'https://www.usgs.gov/news/featured-story/valid',
        published_at: null,
      },
    ]);
  });

  it('prioritizes news paths and dated items before applying the limit', () => {
    const ordinaryLinks = Array.from(
      { length: 30 },
      (_, index) => `<a href="/science/item-${index}">Ordinary science candidate headline ${index}</a>`,
    ).join('');
    const html = `
      ${ordinaryLinks}
      <article>
        <a href="/news/no-date">Priority news candidate without a date</a>
      </article>
      <article>
        <time datetime="2026-06-08"></time>
        <a href="/news/dated">Priority news candidate with a date</a>
      </article>
      <article>
        <time datetime="2026-06-07"></time>
        <a href="/science/dated">Dated ordinary science candidate headline</a>
      </article>
    `;

    const items = extractCandidateItems(html, 'https://www.usgs.gov/mission-areas/water-resources/news');

    expect(items).toHaveLength(30);
    expect(items.slice(0, 3)).toEqual([
      {
        title: 'Priority news candidate with a date',
        url: 'https://www.usgs.gov/news/dated',
        published_at: '2026-06-08',
      },
      {
        title: 'Priority news candidate without a date',
        url: 'https://www.usgs.gov/news/no-date',
        published_at: null,
      },
      {
        title: 'Dated ordinary science candidate headline',
        url: 'https://www.usgs.gov/science/dated',
        published_at: '2026-06-07',
      },
    ]);
  });
});

describe('extractNextUrl', () => {
  it('recognizes the USGS next page from the saved HTML sample', () => {
    const html = readFileSync(new URL('../debug/usgs-news.html', import.meta.url), 'utf8');

    expect(
      extractNextUrl(html, 'https://www.usgs.gov/mission-areas/water-resources/news'),
    ).toBe('https://www.usgs.gov/mission-areas/water-resources/news?page=1');
  });

  it('recognizes next page text and page query fallbacks', () => {
    expect(
      extractNextUrl(
        '<a href="/archive?page=2">下一页</a>',
        'https://example.com/archive?page=1',
      ),
    ).toBe('https://example.com/archive?page=2');
    expect(
      extractNextUrl(
        '<a aria-current="page" href="?page=0">1</a><a href="?page=1">2</a>',
        'https://example.com/archive',
      ),
    ).toBe('https://example.com/archive?page=1');
    expect(
      extractNextUrl(
        '<a href="?page=0">1</a><a aria-current="page" href="?page=1">2</a><a href="?page=2">3</a>',
        'https://example.com/archive?page=1',
      ),
    ).toBe('https://example.com/archive?page=2');
  });

  it('prioritizes a manual next selector over automatic next detection', () => {
    const html = `
      <a rel="next" href="?page=1">Automatic next</a>
      <a class="load-more" href="?cursor=manual">More results</a>
    `;

    expect(
      extractNextUrl(html, 'https://example.com/archive', '.load-more'),
    ).toBe('https://example.com/archive?cursor=manual');
  });
});

describe('extractItemsBySelectors', () => {
  it('extracts and deduplicates items from fixture HTML', () => {
    const html = `
      <section class="result">
        <h2 class="headline">First selector news headline</h2>
        <a class="story-link" href="/news/first">Open</a>
        <time class="published" datetime="2026-06-08">June 8, 2026</time>
      </section>
      <section class="result">
        <h2 class="headline">Second selector news headline</h2>
        <a class="story-link" href="https://example.com/news/second">Open</a>
        <span class="published">June 7, 2026</span>
      </section>
      <section class="result">
        <h2 class="headline">Duplicate selector news headline</h2>
        <a class="story-link" href="/news/first">Open</a>
      </section>
    `;

    expect(
      extractItemsBySelectors(html, 'https://example.com/archive', {
        item: '.result',
        title: '.headline',
        link: '.story-link',
        date: '.published',
      }),
    ).toEqual([
      {
        title: 'First selector news headline',
        url: 'https://example.com/news/first',
        published_at: '2026-06-08',
      },
      {
        title: 'Second selector news headline',
        url: 'https://example.com/news/second',
        published_at: '2026-06-07',
      },
    ]);
  });
});
