export type SignalPlatform = "reddit" | "shopify_community" | "app_store";
export type SignalContentType = "submission" | "comment";

export interface IngestedItem {
  platform: SignalPlatform;
  contentType: SignalContentType;
  externalId: string;
  parentExternalId: string | null;
  subreddit: string | null;
  url: string;
  author: string | null;
  title: string | null;
  content: string;
  rawPayload: unknown;
  postedAt: string;
}

export interface SignalSourceAdapter {
  readonly platform: SignalPlatform;
  ingest(): Promise<IngestedItem[]>;
}
