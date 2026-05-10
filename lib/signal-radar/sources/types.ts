export type SignalPlatform =
  | "reddit"
  | "shopify_community"
  | "app_store"
  | "trustpilot"
  | "g2"
  | "capterra"
  | "stripe_community"
  | "paypal_community"
  | "bbb"
  | "hackernews"
  | "indie_hackers";
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

export interface IngestResult {
  items: IngestedItem[];
  /** Per-source error messages (e.g. one per subreddit when Reddit 403s) — surfaced to the admin UI. */
  errors: string[];
}

export interface SignalSourceAdapter {
  readonly platform: SignalPlatform;
  ingest(): Promise<IngestResult>;
}
