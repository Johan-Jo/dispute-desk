/**
 * Drains in-flight Anthropic Message Batches submitted by the English-first
 * autopilot path (see PipelineOptions.englishFirstAsyncRest in
 * lib/resources/generation/pipeline.ts).
 *
 * The autopilot tick generates + publishes en-US synchronously (to stay under
 * Vercel's 300s function limit) and submits the remaining target locales as one
 * async batch, recording its id on `content_items.pending_batch_id`. This drain
 * polls each pending batch; once it has ended, it ingests the results through the
 * SAME validators as the sync path and publishes the new locales (`publish:true`),
 * then clears `pending_batch_id`.
 *
 * Idempotent: ingest UPDATEs/INSERTs localization rows (no dupes), publish is a
 * no-op transition on already-published rows, and the id is cleared only after a
 * successful ingest so a transient failure simply retries next tick.
 */
import { getServiceClient } from "@/lib/supabase/server";
import { getBatch, getBatchResults } from "@/lib/resources/generation/batchClient";
import { ingestBatchResults, type IngestOutcome } from "@/lib/resources/generation/batchExpand";

/** Cap items processed per tick so a backlog of pending batches can't blow the function budget. */
const MAX_ITEMS_PER_TICK = 5;

export type AutopilotBatchDrainResult = {
  scanned: number;
  ingested: number;
  stillInFlight: number;
  items: Array<{
    contentItemId: string;
    batchId: string;
    status: "ingested" | "in_flight" | "error";
    outcomes?: IngestOutcome[];
    error?: string;
  }>;
};

export async function drainAutopilotBatches(): Promise<AutopilotBatchDrainResult> {
  const sb = getServiceClient();

  const { data, error } = await sb
    .from("content_items")
    .select("id, pending_batch_id")
    .not("pending_batch_id", "is", null)
    .order("updated_at", { ascending: true })
    .limit(MAX_ITEMS_PER_TICK);

  if (error) {
    return { scanned: 0, ingested: 0, stillInFlight: 0, items: [{ contentItemId: "", batchId: "", status: "error", error: error.message }] };
  }

  const rows = (data ?? []) as Array<{ id: string; pending_batch_id: string }>;
  const result: AutopilotBatchDrainResult = {
    scanned: rows.length,
    ingested: 0,
    stillInFlight: 0,
    items: [],
  };

  for (const row of rows) {
    const contentItemId = row.id;
    const batchId = row.pending_batch_id;
    try {
      const handle = await getBatch(batchId);
      if (handle.processing_status !== "ended") {
        result.stillInFlight += 1;
        result.items.push({ contentItemId, batchId, status: "in_flight" });
        continue;
      }

      const lines = await getBatchResults(batchId);
      // publish:true — the en-US article is already live; publish each backfilled
      // locale as soon as it passes validation so it appears on the hub.
      const outcomes = await ingestBatchResults(lines, { publish: true });

      // Clear the pending id only after a successful ingest. Rejected/failed
      // locales are surfaced in the outcomes; they won't have a published row, so
      // the article simply stays en-US-only for those locales (no broken links —
      // the public page renders per-locale on is_published).
      await sb.from("content_items").update({ pending_batch_id: null }).eq("id", contentItemId);

      result.ingested += 1;
      result.items.push({ contentItemId, batchId, status: "ingested", outcomes });
    } catch (e) {
      result.items.push({
        contentItemId,
        batchId,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}
