import { getServiceClient } from "@/lib/supabase/server";
import { computeClusterKey } from "./cluster";
import type { SignalSourceAdapter, IngestedItem } from "./sources/types";

export interface IngestLoopResult {
  platform: string;
  fetched: number;
  fetched_submissions: number;
  fetched_comments: number;
  inserted: number;
}

export async function ingestLoop(
  adapter: SignalSourceAdapter
): Promise<IngestLoopResult> {
  const items = await adapter.ingest();

  let fetched_submissions = 0;
  let fetched_comments = 0;
  for (const item of items) {
    if (item.contentType === "submission") fetched_submissions++;
    else fetched_comments++;
  }

  if (items.length === 0) {
    return {
      platform: adapter.platform,
      fetched: 0,
      fetched_submissions: 0,
      fetched_comments: 0,
      inserted: 0,
    };
  }

  const sb = getServiceClient();

  const rows = items.map((item) => itemToRow(item));

  const { data, error } = await sb
    .from("signal_sources")
    .upsert(rows, { onConflict: "platform,external_id", ignoreDuplicates: true })
    .select("id");

  if (error) {
    console.error(`[signal-radar] ingest upsert error:`, error);
    throw new Error(`ingest upsert failed: ${error.message}`);
  }

  return {
    platform: adapter.platform,
    fetched: items.length,
    fetched_submissions,
    fetched_comments,
    inserted: data?.length ?? 0,
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
