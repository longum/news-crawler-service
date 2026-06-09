export type RenderMode = 'auto' | 'http' | 'playwright';
export type RenderModeUsed = Exclude<RenderMode, 'auto'>;

export interface HubItem {
  title: string;
  url: string;
  published_at: string | null;
}

export interface CrawledPage {
  items: HubItem[];
  nextUrl: string | null;
  statusCode: number;
}

export type StoppedReason = 'http_403' | 'no_new_items' | null;

export interface HubTestOptions {
  maxPages: number;
  delayMs: number;
  stopOn403: boolean;
  stopWhenNoNewItems: boolean;
}

export interface HubTestResult {
  renderModeUsed: RenderModeUsed;
  items: HubItem[];
  rule: Record<string, never>;
  pages: {
    visited: string[];
    nextUrl: string | null;
    stoppedReason: StoppedReason;
  };
}

export type CrawlPage = (url: string) => Promise<CrawledPage>;
export type HubTestRunner = (
  url: string,
  renderMode: RenderMode,
  options: HubTestOptions,
) => Promise<HubTestResult>;
