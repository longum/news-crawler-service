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

    const maxPages = request.body?.maxPages ?? 1;
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 5) {
      response.status(400).json({ ok: false, error: 'maxPages must be an integer from 1 to 5' });
      return;
    }

    const delayMs = request.body?.delayMs ?? 0;
    if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
      response.status(400).json({ ok: false, error: 'delayMs must be an integer from 0 to 60000' });
      return;
    }

    const stopOn403 = request.body?.stopOn403 ?? true;
    if (typeof stopOn403 !== 'boolean') {
      response.status(400).json({ ok: false, error: 'stopOn403 must be a boolean' });
      return;
    }

    const stopWhenNoNewItems = request.body?.stopWhenNoNewItems ?? true;
    if (typeof stopWhenNoNewItems !== 'boolean') {
      response.status(400).json({ ok: false, error: 'stopWhenNoNewItems must be a boolean' });
      return;
    }

    try {
      const result = await runHubTest(url, renderMode, {
        maxPages,
        delayMs,
        stopOn403,
        stopWhenNoNewItems,
      });
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
