import type { SignalSourceAdapter } from "./types";
import { redditAdapter, getProxySecret } from "./reddit";
import { apifyAdapter, getApifyToken } from "./apify";
import { shopifyCommunityAdapter } from "./shopify-community";
import { appStoreAdapter } from "./app-store";
import { hackerNewsAdapter } from "./hackernews";

/**
 * Returns the full ordered list of adapters to run on each ingest tick.
 *
 * Always-on:
 *   - shopifyCommunityAdapter — community.shopify.com (Discourse JSON, free,
 *     no IP block; highest-signal source).
 *
 * Reddit selection (priority order, first match wins):
 *   1. REDDIT_PROXY_URL + REDDIT_PROXY_SECRET set → direct Reddit via the
 *      free Cloudflare Worker proxy. **Preferred** — free, reliable.
 *   2. APIFY_API_TOKEN/APIFY_API_KEY set → Apify Reddit Scraper (paid
 *      fallback, only used if no proxy is configured).
 *   3. neither → direct Reddit (works on residential IPs / local dev,
 *      403s on Vercel datacenter IPs).
 */
export function getDefaultAdapters(): SignalSourceAdapter[] {
  const adapters: SignalSourceAdapter[] = [
    shopifyCommunityAdapter,
    appStoreAdapter,
    hackerNewsAdapter,
  ];

  const hasProxy = Boolean(process.env.REDDIT_PROXY_URL && getProxySecret());
  if (hasProxy) {
    adapters.push(redditAdapter);
  } else if (getApifyToken()) {
    adapters.push(apifyAdapter);
  } else {
    adapters.push(redditAdapter);
  }

  return adapters;
}

/** Backward-compat — returns just the Reddit adapter. */
export function getRedditAdapter(): SignalSourceAdapter {
  if (process.env.REDDIT_PROXY_URL && getProxySecret()) {
    return redditAdapter;
  }
  if (getApifyToken()) return apifyAdapter;
  return redditAdapter;
}

export {
  redditAdapter,
  apifyAdapter,
  shopifyCommunityAdapter,
  appStoreAdapter,
  hackerNewsAdapter,
};
export type {
  SignalSourceAdapter,
  IngestedItem,
  IngestResult,
} from "./types";
