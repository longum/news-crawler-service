import dnsPromises from 'node:dns/promises';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { spawn } from 'node:child_process';
import { JSDOM } from 'jsdom';
import type { Article, ArticleFetchedPage } from './types.js';

const cases = [
  {
    id: 'zh_chinanews',
    label: '中国新闻网',
    url: 'https://www.chinanews.com.cn/gn/2026/06-26/10647610.shtml',
  },
  {
    id: 'zh_ifeng',
    label: '凤凰新闻',
    url: 'https://news.ifeng.com/c/8uGiaD1Ju84',
  },
  {
    id: 'en_bbc',
    label: 'BBC 正常文章',
    url: 'https://www.bbc.com/news/articles/cjegdqw5d3yo',
  },
  {
    id: 'en_ap',
    label: 'AP 正常文章',
    url: 'https://apnews.com/article/venezuela-earthquake-caracas-rodriguez-aid-0a62e6fc9feb5202a750c4fbb11a6aec',
  },
  {
    id: 'js_guardian',
    label: 'Guardian 交互文章',
    url: 'https://www.theguardian.com/uk-news/ng-interactive/2026/jun/25/us-fighter-pilot-strangled-woman-england-why-military-trial',
  },
  {
    id: 'non_article_bbc',
    label: 'BBC 新闻首页',
    url: 'https://www.bbc.com/news',
  },
] as const;

type LookupRecord = { address: string; family: 4 | 6 };

const publicDnsFallbacks = new Map<string, LookupRecord[]>([
  ['www.chinanews.com.cn', [{ address: '138.113.102.14', family: 4 }]],
  ['news.ifeng.com', [{ address: '43.174.143.246', family: 4 }]],
  ['www.bbc.com', [{ address: '151.101.0.81', family: 4 }]],
  ['apnews.com', [{ address: '104.16.22.8', family: 4 }]],
  ['www.theguardian.com', [{ address: '151.101.1.111', family: 4 }]],
]);

const maxStdoutBytes = 8 * 1024 * 1024;
const maxStderrBytes = 256 * 1024;
const trafilaturaTimeoutMs = 10_000;
const pythonExecutable = process.env.TRAFILATURA_PYTHON ?? 'python3';
const pythonScript = new URL('../scripts/trafilatura_extract.py', import.meta.url);

function installExperimentDnsFallback() {
  const originalLookup = dnsPromises.lookup.bind(dnsPromises);
  const experimentLookup = async (hostname: string, options?: unknown) => {
    const key = String(hostname).toLowerCase();
    const fallback = publicDnsFallbacks.get(key);
    if (fallback) return typeof options === 'object' && options !== null && 'all' in options ? fallback : fallback[0];
    return originalLookup(hostname, options as never);
  };
  dnsPromises.lookup = experimentLookup as typeof dnsPromises.lookup;
  syncBuiltinESMExports();
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripHtmlToText(contentHtml: string, finalUrl: string): string {
  const dom = new JSDOM(`<main>${contentHtml}</main>`, { url: finalUrl });
  return normalizeText(dom.window.document.querySelector('main')?.textContent ?? '');
}

function inferTitle(result: TrafilaturaProcessResult, finalUrl: string): string {
  if (result.title?.trim()) return normalizeText(result.title);

  const contentHtml = result.contentHtml ?? '';
  const dom = new JSDOM(`<main>${contentHtml}</main>`, { url: finalUrl });
  const heading = normalizeText(dom.window.document.querySelector('h1, h2')?.textContent ?? '');
  if (heading) return heading;

  const textHeading = (result.textContent ?? '').match(/^\s*#{1,3}\s+(.+)$/m)?.[1];
  return textHeading ? normalizeText(textHeading) : '';
}

function countWords(textContent: string): number {
  return textContent.match(/\S+/g)?.length ?? 0;
}

function countParagraphs(contentHtml: string, finalUrl: string, minLength: number): number {
  const dom = new JSDOM(`<main>${contentHtml}</main>`, { url: finalUrl });
  return [...dom.window.document.querySelectorAll('p')]
    .map((paragraph) => normalizeText(paragraph.textContent ?? ''))
    .filter((text) => text.length >= minLength).length;
}

function snippet(value: string, length = 280): string {
  return normalizeText(value).slice(0, length);
}

function tail(value: string, length = 280): string {
  const text = normalizeText(value);
  return text.slice(Math.max(0, text.length - length));
}

interface TrafilaturaProcessResult {
  ok: boolean;
  mode: 'default' | 'precision';
  durationMs: number;
  title?: string | null;
  author?: string | null;
  date?: string | null;
  description?: string | null;
  sitename?: string | null;
  contentHtml?: string;
  textContent?: string;
  error?: string | null;
}

async function runTrafilatura(html: string, mode: 'default' | 'precision'): Promise<TrafilaturaProcessResult> {
  const child = spawn(pythonExecutable, [pythonScript.pathname, '--mode', mode], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let killedForLimit = false;

  const timeout = setTimeout(() => {
    killedForLimit = true;
    child.kill('SIGKILL');
  }, trafilaturaTimeoutMs);

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > maxStdoutBytes) {
      killedForLimit = true;
      child.kill('SIGKILL');
      return;
    }
    stdoutChunks.push(chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderrBytes += chunk.length;
    if (stderrBytes > maxStderrBytes) {
      killedForLimit = true;
      child.kill('SIGKILL');
      return;
    }
    stderrChunks.push(chunk);
  });
  child.stdin.end(html);

  const [code, signal] = (await once(child, 'close')) as [number | null, NodeJS.Signals | null];
  clearTimeout(timeout);

  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');
  if (killedForLimit) {
    return {
      ok: false,
      mode,
      durationMs: trafilaturaTimeoutMs,
      error: `trafilatura process killed by timeout or output limit (signal=${signal ?? 'none'})`,
    };
  }

  try {
    const parsed = JSON.parse(stdout) as TrafilaturaProcessResult;
    if (!parsed.ok && !parsed.error && stderr) parsed.error = stderr.slice(0, 1000);
    return parsed;
  } catch (error) {
    return {
      ok: false,
      mode,
      durationMs: 0,
      error: `Unable to parse trafilatura output (code=${code ?? 'null'}): ${
        error instanceof Error ? error.message : String(error)
      }; stderr=${stderr.slice(0, 1000)}`,
    };
  }
}

function trafilaturaToArticle(
  result: TrafilaturaProcessResult,
  page: ArticleFetchedPage,
): Article | null {
  if (!result.ok) return null;
  const contentHtml = result.contentHtml ?? '';
  const textContent = normalizeText(result.textContent || stripHtmlToText(contentHtml, page.finalUrl));
  return {
    title: inferTitle(result, page.finalUrl),
    byline: result.author ? normalizeText(result.author) : null,
    siteName: result.sitename ? normalizeText(result.sitename) : null,
    excerpt: result.description ? normalizeText(result.description) : null,
    contentHtml,
    textContent,
    textLength: textContent.length,
    wordCount: countWords(textContent),
    paragraphCount: countParagraphs(contentHtml, page.finalUrl, 20),
    longParagraphCount: countParagraphs(contentHtml, page.finalUrl, 55),
    publishedAt: result.date ?? null,
    requestedUrl: page.requestedUrl,
    finalUrl: page.finalUrl,
  };
}

function printResult({
  engine,
  mode,
  durationMs,
  article,
  quality,
  error,
}: {
  engine: string;
  mode?: string;
  durationMs: number;
  article: Article | null;
  quality: Awaited<ReturnType<typeof import('./article-extractor.js').evaluateArticleQuality>>;
  error?: string | null;
}) {
  const prefix = mode ? `${engine}:${mode}` : engine;
  console.log(
    JSON.stringify(
      {
        engine: prefix,
        ok: Boolean(article),
        usable: quality.usable,
        reasons: quality.reasons,
        durationMs: Math.round(durationMs),
        title: article?.title ?? null,
        byline: article?.byline ?? null,
        publishedAt: article?.publishedAt ?? null,
        metrics: quality.metrics,
        textStart: article ? snippet(article.textContent) : '',
        textEnd: article ? tail(article.textContent) : '',
        error: error ?? null,
      },
      null,
      2,
    ),
  );
}

async function main() {
  installExperimentDnsFallback();
  const [{ fetchArticleHtmlWithHttp }, { extractArticleFromHtml, evaluateArticleQuality }] = await Promise.all([
    import('./crawler.js'),
    import('./article-extractor.js'),
  ]);

  for (const item of cases) {
    console.log(`\n===== ${item.id} | ${item.label} =====`);
    console.log(`url: ${item.url}`);
    let page: ArticleFetchedPage;
    try {
      page = await fetchArticleHtmlWithHttp(item.url);
      console.log(`fetch: http status=${page.statusCode} finalUrl=${page.finalUrl} htmlBytes=${Buffer.byteLength(page.html)}`);
    } catch (error) {
      console.log(
        JSON.stringify({
          fetchError: error instanceof Error ? error.message : String(error),
        }),
      );
      continue;
    }

    const readabilityStart = performance.now();
    const readabilityArticle = extractArticleFromHtml(page.html, page.requestedUrl, page.finalUrl);
    const readabilityDuration = performance.now() - readabilityStart;
    printResult({
      engine: 'readability',
      durationMs: readabilityDuration,
      article: readabilityArticle,
      quality: evaluateArticleQuality(readabilityArticle),
    });

    for (const mode of ['default', 'precision'] as const) {
      const trafilatura = await runTrafilatura(page.html, mode);
      const article = trafilaturaToArticle(trafilatura, page);
      printResult({
        engine: 'trafilatura',
        mode,
        durationMs: trafilatura.durationMs,
        article,
        quality: evaluateArticleQuality(article),
        error: trafilatura.error,
      });
    }
  }
}

await main();
