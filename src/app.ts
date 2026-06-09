import express, { type ErrorRequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { testHubPage } from './hub-service.js';
import type { HubSelectors, HubTestRunner, RenderMode } from './types.js';

const renderModes = new Set<RenderMode>(['auto', 'http', 'playwright']);
const selectorNames = ['item', 'title', 'link', 'date', 'next'] as const;

function validateUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function parseSelectors(value: unknown): HubSelectors | null {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const selectors: HubSelectors = {};
  for (const name of selectorNames) {
    const selector = (value as Record<string, unknown>)[name];
    if (selector === undefined) continue;
    if (typeof selector !== 'string' || !selector.trim()) {
      throw new Error(`selectors.${name} must be a non-empty string`);
    }
    selectors[name] = selector.trim();
  }

  if (selectors.item) {
    selectors.link ??= 'a[href]';
    selectors.title ??= selectors.link;
  }
  return selectors;
}

function matchesApiKey(candidate: string | undefined, apiKey: string): boolean {
  if (candidate === undefined) return false;
  const candidateBuffer = Buffer.from(candidate);
  const apiKeyBuffer = Buffer.from(apiKey);
  return candidateBuffer.length === apiKeyBuffer.length && timingSafeEqual(candidateBuffer, apiKeyBuffer);
}

export function createApp(
  runHubTest: HubTestRunner = testHubPage,
  apiKey: string | undefined = process.env.CRAWLER_API_KEY,
) {
  const app = express();

  app.get('/health', (_request, response) => {
    response.json({ ok: true });
  });

  app.use((request, response, next) => {
    if (apiKey === undefined) {
      next();
      return;
    }

    const authorization = request.get('authorization');
    const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/i);
    const isAuthorized =
      matchesApiKey(request.get('x-api-key'), apiKey) || matchesApiKey(bearerMatch?.[1], apiKey);
    if (!isAuthorized) {
      response.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }

    next();
  });

  app.use(express.json({ limit: '32kb' }));

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

    let selectors: HubSelectors | null;
    try {
      selectors = parseSelectors(request.body?.selectors);
    } catch (error) {
      response.status(400).json({ ok: false, error: (error as Error).message });
      return;
    }
    if (!selectors) {
      response.status(400).json({ ok: false, error: 'selectors must be an object' });
      return;
    }

    try {
      const result = await runHubTest(url, renderMode, {
        maxPages,
        delayMs,
        stopOn403,
        stopWhenNoNewItems,
        selectors,
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
