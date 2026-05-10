import { getServiceClient } from "@/lib/supabase/server";
import { computeClusterKey } from "./cluster";
import type { SignalSourceAdapter, IngestedItem } from "./sources/types";

/**
 * Maximum item age at ingest. Anything older is dropped before we waste
 * classifier API spend or pollute the dashboard with stale "intelligence".
 * 30 days is a reasonable cutoff for fresh merchant pain.
 */
const MAX_ITEM_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface IngestLoopResult {
  fetched: number;
  fetched_submissions: number;
  fetched_comments: number;
  inserted: number;
  errors: string[];
  /** Per-platform breakdown so the admin UI can show "shopify_community: 12, reddit: 8". */
  by_platform: Record<string, number>;
}

/**
 * Runs every adapter in the array, merges their items, then upserts in a single
 * batch. Per-source errors flow into IngestResult.errors so the admin UI can
 * report exactly which source failed.
 */
export async function ingestLoop(
  adapters: SignalSourceAdapter[]
): Promise<IngestLoopResult> {
  const allItems: IngestedItem[] = [];
  const allErrors: string[] = [];

  for (const adapter of adapters) {
    try {
      const result = await adapter.ingest();
      allItems.push(...result.items);
      allErrors.push(...result.errors);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      allErrors.push(`${adapter.platform}: ${msg}`);
      console.error(
        `[signal-radar] adapter ${adapter.platform} threw:`,
        err
      );
    }
  }

  // Age filter — drop anything older than MAX_ITEM_AGE_MS so we don't ingest
  // stale content that pollutes the dashboard with old news.
  const ageCutoff = Date.now() - MAX_ITEM_AGE_MS;
  let droppedAsStale = 0;
  const freshItems = allItems.filter((item) => {
    const t = Date.parse(item.postedAt);
    if (isNaN(t)) return true; // keep items with unparseable dates rather than silently lose them
    if (t < ageCutoff) {
      droppedAsStale++;
      return false;
    }
    return true;
  });
  if (droppedAsStale > 0) {
    console.info(
      `[signal-radar] ingest dropped_stale=${droppedAsStale} (older than ${MAX_ITEM_AGE_MS / (24 * 60 * 60 * 1000)} days)`
    );
  }

  let fetched_submissions = 0;
  let fetched_comments = 0;
  const by_platform: Record<string, number> = {};
  for (const item of freshItems) {
    if (item.contentType === "submission") fetched_submissions++;
    else fetched_comments++;
    by_platform[item.platform] = (by_platform[item.platform] ?? 0) + 1;
  }

  if (freshItems.length === 0) {
    return {
      fetched: 0,
      fetched_submissions: 0,
      fetched_comments: 0,
      inserted: 0,
      errors: allErrors,
      by_platform,
    };
  }

  const sb = getServiceClient();
  const rows = freshItems.map((item) => itemToRow(item));

  const { data, error } = await sb
    .from("signal_sources")
    .upsert(rows, { onConflict: "platform,external_id", ignoreDuplicates: true })
    .select("id");

  if (error) {
    console.error(`[signal-radar] ingest upsert error:`, error);
    throw new Error(`ingest upsert failed: ${error.message}`);
  }

  return {
    fetched: freshItems.length,
    fetched_submissions,
    fetched_comments,
    inserted: data?.length ?? 0,
    errors: allErrors,
    by_platform,
  };
}

function itemToRow(item: IngestedItem) {
  const clusterText = `${item.title ?? ""} ${item.content ?? ""}`.trim();
  const cluster_key = computeClusterKey(clusterText) || null;
  return {
    platform: item.platform,
    content_type: item.contentType,
    external_id: item.externalId,
    parent_external_id: item.parentExternalId,
    subreddit: item.subreddit,
    url: item.url,
    author: item.author,
    title: item.title,
    content: item.content ?? "",
    raw_payload: item.rawPayload,
    posted_at: item.postedAt,
    cluster_key,
    analysis_status: "pending" as const,
  };
}
