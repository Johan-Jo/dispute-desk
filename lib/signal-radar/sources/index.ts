import type { SignalSourceAdapter } from "./types";
import { redditAdapter } from "./reddit";
import { apifyAdapter, getApifyToken } from "./apify";

/**
 * Picks the right Reddit ingest adapter for the current environment.
 *
 * Order of preference:
 *   1. APIFY_API_TOKEN (or APIFY_API_KEY) set → Apify Reddit Scraper (paid, primary)
 *   2. REDDIT_PROXY_URL set                   → direct Reddit via Cloudflare Worker (free)
 *   3. neither                                → direct Reddit (works on local dev only)
 */
export function getRedditAdapter(): SignalSourceAdapter {
  if (getApifyToken()) return apifyAdapter;
  return redditAdapter;
}

export { redditAdapter, apifyAdapter };
export type { SignalSourceAdapter, IngestedItem, IngestResult } from "./types";
