import { describe, expect, it } from 'vitest';
import { extractCandidateItems } from './extractor.js';

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
});
