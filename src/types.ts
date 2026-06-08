export type RenderMode = 'auto' | 'http' | 'playwright';
export type RenderModeUsed = Exclude<RenderMode, 'auto'>;

export interface HubItem {
  title: string;
  url: string;
  published_at: string | null;
}

export interface HubTestResult {
  renderModeUsed: RenderModeUsed;
  items: HubItem[];
  rule: Record<string, never>;
}

export type CrawlPage = (url: string) => Promise<HubItem[]>;
export type HubTestRunner = (url: string, renderMode: RenderMode) => Promise<HubTestResult>;
