import express, { type ErrorRequestHandler } from 'express';
import { testHubPage } from './hub-service.js';
import type { HubTestRunner, RenderMode } from './types.js';

const renderModes = new Set<RenderMode>(['auto', 'http', 'playwright']);

function validateUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function createApp(runHubTest: HubTestRunner = testHubPage) {
  const app = express();
  app.use(express.json({ limit: '32kb' }));

  app.get('/health', (_request, response) => {
    response.json({ ok: true });
  });

  app.post('/hub/test', async (request, response) => {
    const url = validateUrl(request.body?.url);
    if (!url) {
      response.status(400).json({ ok: false, error: 'url must be a valid http or https URL' });
      return;
    }

    const renderMode = request.body?.renderMode ?? 'auto';
    if (!renderModes.has(renderMode)) {
      response.status(400).json({ ok: false, error: 'renderMode must be auto, http, or playwright' });
      return;
    }

    try {
      const result = await runHubTest(url, renderMode);
      response.json({ ok: true, url, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to test hub page';
      response.status(502).json({ ok: false, error: message });
    }
  });

  const jsonErrorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    const message = error instanceof Error ? error.message : 'Invalid request';
    response.status(400).json({ ok: false, error: message });
  };
  app.use(jsonErrorHandler);

  return app;
}
