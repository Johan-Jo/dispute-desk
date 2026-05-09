import type { SignalSourceAdapter } from "./types";
import { redditAdapter } from "./reddit";
import { apifyAdapter, getApifyToken } from "./apify";
import { shopifyCommunityAdapter } from "./shopify-community";

/**
 * Returns the full ordered list of adapters to run on each ingest tick.
 *
 * Always-on:
 *   - shopifyCommunityAdapter — community.shopify.com (Discourse JSON, free,
 *     no IP block; highest-signal source for Shopify-merchant pain).
 *
 * Reddit selection (for the Reddit slot):
 *   1. APIFY_API_TOKEN (or APIFY_API_KEY) set → Apify Reddit Scraper (paid,
 *      reliable, primary).
 *   2. neither set → direct Reddit (works on local dev, blocked on Vercel —
 *      a clear "configure ingest" error surfaces in the UI banner).
 */
export function getDefaultAdapters(): SignalSourceAdapter[] {
  const adapters: SignalSourceAdapter[] = [shopifyCommunityAdapter];
  adapters.push(getApifyToken() ? apifyAdapter : redditAdapter);
  return adapters;
}

/** Backward-compat — returns the single Reddit adapter only. Kept for any
 * legacy callers; new code should use getDefaultAdapters. */
export function getRedditAdapter(): SignalSourceAdapter {
  if (getApifyToken()) return apifyAdapter;
  return redditAdapter;
}

export { redditAdapter, apifyAdapter, shopifyCommunityAdapter };
export type {
  SignalSourceAdapter,
  IngestedItem,
  IngestResult,
} from "./types";
