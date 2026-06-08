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
    });
    expect(runner).toHaveBeenCalledWith('https://example.com/news', 'auto');
  });
});
