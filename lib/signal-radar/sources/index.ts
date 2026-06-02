import type { SignalSourceAdapter } from "./types";
import { redditAdapter } from "./reddit";
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
 * Reddit selection (priority order, first match wins) — matches .env.example
 * and apify.ts, which both declare Apify the PRIMARY production source and the
 * Cloudflare Worker proxy a free FALLBACK:
 *   1. APIFY_API_TOKEN/APIFY_API_KEY set → Apify Reddit Scraper. **Preferred**
 *      (handles IP rotation / anti-bot).
 *   2. else → redditAdapter, which internally uses the Cloudflare Worker proxy
 *      when REDDIT_PROXY_URL + secret are set, otherwise direct Reddit
 *      (residential / local dev only; 403s on Vercel/Cloudflare datacenter IPs).
 *
 * NOTE: this was previously proxy-first. That order silently shadowed a
 * configured Apify token and, when Reddit began 403-blocking the proxy's edge
 * IP (2026-05-28), took Reddit ingestion down entirely with no fallback.
 */
/** Synchronous adapter list — does NOT read settings (used as a fallback). */
export function getDefaultAdapters(): SignalSourceAdapter[] {
  const adapters: SignalSourceAdapter[] = [
    shopifyCommunityAdapter,
    appStoreAdapter,
    hackerNewsAdapter,
  ];

  if (getApifyToken()) {
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
    if (getApifyToken()) adapters.push(apifyAdapter);
    else adapters.push(redditAdapter);
  }

  return adapters;
}

/** Backward-compat — returns just the Reddit adapter (Apify primary). */
export function getRedditAdapter(): SignalSourceAdapter {
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
