import type { SignalSourceAdapter } from "./types";
import { redditAdapter } from "./reddit";
import { redditSearchAdapter } from "./reddit-search";
import { apifyAdapter } from "./apify";
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
 * Reddit slot — `getRedditSlotAdapter()`. As of 2026-06 Reddit blocks every
 * direct path (anonymous `.json`, public `.rss`, and the Data API behind the
 * moderation-only "Responsible Builder Policy"), so the ONLY working source is
 * `redditSearchAdapter`: it reads Reddit through a web-search index (Brave API,
 * or DuckDuckGo locally), so the search provider — not us — touches reddit.com.
 * The legacy direct `redditAdapter` / paid `apifyAdapter` are kept for
 * reference but are dead in prod; the search adapter supersedes them.
 */
function getRedditSlotAdapter(): SignalSourceAdapter {
  return redditSearchAdapter;
}

/** Synchronous adapter list — does NOT read settings (used as a fallback). */
export function getDefaultAdapters(): SignalSourceAdapter[] {
  return [
    shopifyCommunityAdapter,
    appStoreAdapter,
    hackerNewsAdapter,
    getRedditSlotAdapter(),
  ];
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

  if (settings.reddit_enabled) adapters.push(getRedditSlotAdapter());

  return adapters;
}

/** Backward-compat — returns just the Reddit slot adapter. */
export function getRedditAdapter(): SignalSourceAdapter {
  return getRedditSlotAdapter();
}

export {
  redditAdapter,
  redditSearchAdapter,
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
