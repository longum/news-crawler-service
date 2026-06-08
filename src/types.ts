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
}

export interface HubTestResult {
  renderModeUsed: RenderModeUsed;
  items: HubItem[];
  rule: Record<string, never>;
  pages: {
    visited: string[];
    nextUrl: string | null;
  };
}

export type CrawlPage = (url: string) => Promise<CrawledPage>;
export type HubTestRunner = (
  url: string,
  renderMode: RenderMode,
  maxPages: number,
) => Promise<HubTestResult>;
