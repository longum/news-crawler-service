import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { CrawlScheduler, type CrawlScheduleResult } from './crawl-scheduler.js';
import type { ArticleTestRunner, HubTestRunner } from './types.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('app', () => {
  it('returns health status', async () => {
    const app = createApp(vi.fn<HubTestRunner>());

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('keeps health public when API key authentication is enabled', async () => {
    const app = createApp(vi.fn<HubTestRunner>(), 'secret-key');

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('rejects protected routes without a valid API key', async () => {
    const runner = vi.fn<HubTestRunner>();
    const app = createApp(runner, 'secret-key');

    const missing = await request(app).post('/hub/test').send({ url: 'https://example.com/news' });
    const invalid = await request(app)
      .post('/hub/test')
      .set('x-api-key', 'wrong-key')
      .send({ url: 'https://example.com/news' });

    expect(missing.status).toBe(401);
    expect(missing.body).toEqual({ ok: false, error: 'unauthorized' });
    expect(invalid.status).toBe(401);
    expect(invalid.body).toEqual({ ok: false, error: 'unauthorized' });
    expect(runner).not.toHaveBeenCalled();
  });

  it('authenticates protected routes before parsing their body', async () => {
    const app = createApp(vi.fn<HubTestRunner>(), 'secret-key');

    const response = await request(app)
      .post('/hub/test')
      .set('Content-Type', 'application/json')
      .send('{"invalid"');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('accepts x-api-key and Bearer authentication', async () => {
    const runner = vi.fn<HubTestRunner>().mockResolvedValue({
      renderModeUsed: 'http',
      items: [],
      rule: { selectors: {} },
      pages: { visited: [], nextUrl: null, stoppedReason: null },
    });
    const app = createApp(runner, 'secret-key');

    const apiKeyResponse = await request(app)
      .post('/hub/test')
      .set('x-api-key', 'secret-key')
      .send({ url: 'https://example.com/news' });
    const bearerResponse = await request(app)
      .post('/hub/test')
      .set('Authorization', 'Bearer secret-key')
      .send({ url: 'https://example.com/news' });

    expect(apiKeyResponse.status).toBe(200);
    expect(bearerResponse.status).toBe(200);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('reads the API key from CRAWLER_API_KEY by default', async () => {
    vi.stubEnv('CRAWLER_API_KEY', 'environment-key');
    try {
      const runner = vi.fn<HubTestRunner>().mockResolvedValue({
        renderModeUsed: 'http',
        items: [],
        rule: { selectors: {} },
        pages: { visited: [], nextUrl: null, stoppedReason: null },
      });
      const app = createApp(runner);

      const response = await request(app)
        .post('/hub/test')
        .set('x-api-key', 'environment-key')
        .send({ url: 'https://example.com/news' });

      expect(response.status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('rejects invalid URLs as JSON', async () => {
    const app = createApp(vi.fn<HubTestRunner>());

    const response = await request(app).post('/hub/test').send({ url: 'not-a-url' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ ok: false, error: 'url must be a valid http or https URL' });
  });

  it('rejects an obvious private hub URL before invoking the runner', async () => {
    const runner = vi.fn<HubTestRunner>();
    const app = createApp(runner);

    const response = await request(app).post('/hub/test').send({ url: 'http://127.0.0.1/private' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      ok: false,
      error: 'url must be a valid public http or https URL',
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it('uses auto mode by default and returns the runner result', async () => {
    const runner = vi.fn<HubTestRunner>().mockResolvedValue({
      renderModeUsed: 'http',
      items: [],
      rule: { selectors: {} },
      pages: { visited: ['https://example.com/news'], nextUrl: null, stoppedReason: null },
    });
    const app = createApp(runner);

    const response = await request(app).post('/hub/test').send({ url: 'https://example.com/news' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      url: 'https://example.com/news',
      renderModeUsed: 'http',
      items: [],
      rule: { selectors: {} },
      pages: { visited: ['https://example.com/news'], nextUrl: null, stoppedReason: null },
    });
    expect(runner).toHaveBeenCalledWith('https://example.com/news', 'auto', {
      maxPages: 1,
      delayMs: 0,
      stopOn403: true,
      stopWhenNoNewItems: true,
      selectors: {},
    });
  });

  it('adds article test route with auto mode by default', async () => {
    const hubRunner = vi.fn<HubTestRunner>();
    const articleRunner = vi.fn<ArticleTestRunner>().mockResolvedValue({
      renderModeUsed: 'http',
      article: {
        title: 'Readable article title',
        byline: null,
        siteName: 'Example',
        excerpt: null,
        contentHtml: '<p>Readable article body.</p>',
        textContent: 'Readable article body.',
        textLength: 22,
        wordCount: 3,
        paragraphCount: 1,
        publishedAt: null,
        requestedUrl: 'https://example.com/story',
        finalUrl: 'https://example.com/story',
      },
    });
    const app = createApp(hubRunner, undefined, articleRunner);

    const response = await request(app).post('/article/test').send({ url: 'https://example.com/story' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      url: 'https://example.com/story',
      renderModeUsed: 'http',
      article: {
        title: 'Readable article title',
        byline: null,
        siteName: 'Example',
        excerpt: null,
        contentHtml: '<p>Readable article body.</p>',
        textContent: 'Readable article body.',
        textLength: 22,
        wordCount: 3,
        paragraphCount: 1,
        publishedAt: null,
        requestedUrl: 'https://example.com/story',
        finalUrl: 'https://example.com/story',
      },
    });
    expect(articleRunner).toHaveBeenCalledWith('https://example.com/story', 'auto');
  });

  it('validates article test URL and render mode', async () => {
    const app = createApp(vi.fn<HubTestRunner>(), undefined, vi.fn<ArticleTestRunner>());

    const invalidUrl = await request(app).post('/article/test').send({ url: 'http://localhost/story' });
    const invalidMode = await request(app)
      .post('/article/test')
      .send({ url: 'https://example.com/story', renderMode: 'browser' });

    expect(invalidUrl.status).toBe(400);
    expect(invalidUrl.body).toEqual({
      ok: false,
      error: 'url must be a valid public http or https URL',
    });
    expect(invalidMode.status).toBe(400);
    expect(invalidMode.body).toEqual({
      ok: false,
      error: 'renderMode must be auto, http, or playwright',
    });
  });

  it('validates maxPages and passes values up to 5 to the runner', async () => {
    const runner = vi.fn<HubTestRunner>().mockResolvedValue({
      renderModeUsed: 'http',
      items: [],
      rule: { selectors: {} },
      pages: { visited: [], nextUrl: null, stoppedReason: null },
    });
    const app = createApp(runner);

    const invalid = await request(app)
      .post('/hub/test')
      .send({ url: 'https://example.com/news', maxPages: 6 });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({ ok: false, error: 'maxPages must be an integer from 1 to 5' });

    await request(app).post('/hub/test').send({ url: 'https://example.com/news', maxPages: 5 });
    expect(runner).toHaveBeenLastCalledWith('https://example.com/news', 'auto', {
      maxPages: 5,
      delayMs: 0,
      stopOn403: true,
      stopWhenNoNewItems: true,
      selectors: {},
    });
  });

  it('validates and passes friendly crawl options', async () => {
    const runner = vi.fn<HubTestRunner>().mockResolvedValue({
      renderModeUsed: 'http',
      items: [],
      rule: { selectors: {} },
      pages: { visited: [], nextUrl: null, stoppedReason: null },
    });
    const app = createApp(runner);

    const invalidDelay = await request(app)
      .post('/hub/test')
      .send({ url: 'https://example.com/news', delayMs: 60001 });
    expect(invalidDelay.status).toBe(400);
    expect(invalidDelay.body).toEqual({
      ok: false,
      error: 'delayMs must be an integer from 0 to 60000',
    });

    const invalidStop = await request(app)
      .post('/hub/test')
      .send({ url: 'https://example.com/news', stopOn403: 'yes' });
    expect(invalidStop.status).toBe(400);
    expect(invalidStop.body).toEqual({ ok: false, error: 'stopOn403 must be a boolean' });

    await request(app).post('/hub/test').send({
      url: 'https://example.com/news',
      delayMs: 1500,
      stopOn403: false,
      stopWhenNoNewItems: false,
    });
    expect(runner).toHaveBeenLastCalledWith('https://example.com/news', 'auto', {
      maxPages: 1,
      delayMs: 1500,
      stopOn403: false,
      stopWhenNoNewItems: false,
      selectors: {},
    });
  });

  it('validates and passes selectors', async () => {
    const runner = vi.fn<HubTestRunner>().mockResolvedValue({
      renderModeUsed: 'http',
      items: [],
      rule: { selectors: { item: '.result', link: '.story' } },
      pages: { visited: [], nextUrl: null, stoppedReason: null },
    });
    const app = createApp(runner);

    const invalid = await request(app)
      .post('/hub/test')
      .send({ url: 'https://example.com/news', selectors: { item: '' } });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({
      ok: false,
      error: 'selectors.item must be a non-empty string',
    });

    await request(app).post('/hub/test').send({
      url: 'https://example.com/news',
      selectors: { item: '.result', link: '.story' },
    });
    expect(runner).toHaveBeenLastCalledWith('https://example.com/news', 'auto', {
      maxPages: 1,
      delayMs: 0,
      stopOn403: true,
      stopWhenNoNewItems: true,
      selectors: { item: '.result', title: '.story', link: '.story' },
    });
  });

  it('shares one crawl slot across hub and article routes and returns 429 when the queue is full', async () => {
    const active = deferred<void>();
    const hubRunner = vi.fn<HubTestRunner>().mockImplementation(async () => {
      await active.promise;
      return {
        renderModeUsed: 'http',
        items: [],
        rule: { selectors: {} },
        pages: { visited: [], nextUrl: null, stoppedReason: null },
      };
    });
    const articleRunner = vi.fn<ArticleTestRunner>();
    const scheduler = new CrawlScheduler({ maxConcurrent: 1, maxQueued: 0, maxQueueWaitMs: 300_000 });
    const app = createApp(hubRunner, undefined, articleRunner, scheduler);

    const activeRequest = request(app)
      .post('/hub/test')
      .send({ url: 'https://example.com/news' })
      .then((response) => response);
    await vi.waitFor(() => expect(hubRunner).toHaveBeenCalledOnce());

    const rejected = await request(app)
      .post('/article/test')
      .send({ url: 'https://example.com/story' });

    expect(rejected.status).toBe(429);
    expect(rejected.body).toEqual({ ok: false, error: 'crawler queue is full' });
    expect(rejected.headers['retry-after']).toBe('300');
    expect(articleRunner).not.toHaveBeenCalled();

    active.resolve();
    expect((await activeRequest).status).toBe(200);
  });

  it('maps crawl queue wait timeouts to 429 without invoking the runner', async () => {
    const scheduler = {
      run: vi.fn(async (): Promise<CrawlScheduleResult<never>> => ({
        accepted: false,
        reason: 'wait_timeout',
      })),
    };
    const hubRunner = vi.fn<HubTestRunner>();
    const app = createApp(hubRunner, undefined, vi.fn<ArticleTestRunner>(), scheduler);

    const response = await request(app).post('/hub/test').send({ url: 'https://example.com/news' });

    expect(response.status).toBe(429);
    expect(response.body).toEqual({ ok: false, error: 'crawler queue wait timed out' });
    expect(response.headers['retry-after']).toBe('300');
    expect(hubRunner).not.toHaveBeenCalled();
  });
});
