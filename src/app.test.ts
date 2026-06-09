import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import type { HubTestRunner } from './types.js';

describe('app', () => {
  it('returns health status', async () => {
    const app = createApp(vi.fn<HubTestRunner>());

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('rejects invalid URLs as JSON', async () => {
    const app = createApp(vi.fn<HubTestRunner>());

    const response = await request(app).post('/hub/test').send({ url: 'not-a-url' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ ok: false, error: 'url must be a valid http or https URL' });
  });

  it('uses auto mode by default and returns the runner result', async () => {
    const runner = vi.fn<HubTestRunner>().mockResolvedValue({
      renderModeUsed: 'http',
      items: [],
      rule: {},
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
      rule: {},
      pages: { visited: ['https://example.com/news'], nextUrl: null, stoppedReason: null },
    });
    expect(runner).toHaveBeenCalledWith('https://example.com/news', 'auto', {
      maxPages: 1,
      delayMs: 0,
      stopOn403: true,
      stopWhenNoNewItems: true,
    });
  });

  it('validates maxPages and passes values up to 5 to the runner', async () => {
    const runner = vi.fn<HubTestRunner>().mockResolvedValue({
      renderModeUsed: 'http',
      items: [],
      rule: {},
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
    });
  });

  it('validates and passes friendly crawl options', async () => {
    const runner = vi.fn<HubTestRunner>().mockResolvedValue({
      renderModeUsed: 'http',
      items: [],
      rule: {},
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
    });
  });
});
