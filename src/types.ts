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

export interface HubSelectors {
  item?: string;
  title?: string;
  link?: string;
  date?: string;
  next?: string;
}

export interface HubTestOptions {
  maxPages: number;
  delayMs: number;
  stopOn403: boolean;
  stopWhenNoNewItems: boolean;
  selectors: HubSelectors;
}

export interface HubTestResult {
  renderModeUsed: RenderModeUsed;
  items: HubItem[];
  rule: {
    selectors: HubSelectors;
  };
  pages: {
    visited: string[];
    nextUrl: string | null;
    stoppedReason: StoppedReason;
  };
}

export type CrawlPage = (url: string, selectors?: HubSelectors) => Promise<CrawledPage>;
export type HubTestRunner = (
  url: string,
  renderMode: RenderMode,
  options: HubTestOptions,
) => Promise<HubTestResult>;
