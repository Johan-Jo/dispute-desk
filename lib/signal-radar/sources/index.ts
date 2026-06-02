import type { SignalSourceAdapter } from "./types";
import { redditAdapter, getProxySecret } from "./reddit";
import { apifyAdapter, getApifyToken } from "./apify";
import { shopifyCommunityAdapter } from "./shopify-community";
import { appStoreAdapter } from "./app-store";
import { hackerNewsAdapter } from "./hackernews";
import {
  getSignalRadarSettings,
  type SignalRadarSettings,
} from "../settings";

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
/** Synchronous adapter list — does NOT read settings (used as a fallback). */
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

/**
 * Async adapter list that respects the admin-controlled toggles in
 * signal_radar_settings. Each adapter is included only when its
 * corresponding *_enabled flag is true. The Reddit slot still picks
 * Apify vs Cloudflare Worker based on env, but is included only when
 * reddit_enabled is true.
 */
export async function getEnabledAdapters(): Promise<SignalSourceAdapter[]> {
  let settings: SignalRadarSettings;
  try {
    settings = await getSignalRadarSettings();
  } catch {
    // If we can't read settings (DB outage etc.), fall back to all-on.
    return getDefaultAdapters();
  }

  const adapters: SignalSourceAdapter[] = [];
  if (settings.shopify_community_enabled) adapters.push(shopifyCommunityAdapter);
  if (settings.app_store_enabled) adapters.push(appStoreAdapter);
  if (settings.hackernews_enabled) adapters.push(hackerNewsAdapter);

  if (settings.reddit_enabled) {
    const hasProxy = Boolean(
      process.env.REDDIT_PROXY_URL && getProxySecret()
    );
    if (hasProxy) adapters.push(redditAdapter);
    else if (getApifyToken()) adapters.push(apifyAdapter);
    else adapters.push(redditAdapter);
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
