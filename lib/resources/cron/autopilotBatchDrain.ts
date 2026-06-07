/**
 * Drains in-flight Anthropic Message Batches submitted by the English-first
 * autopilot (submitArticleAsBatch in lib/resources/generation/pipeline.ts).
 *
 * English-first flow: Claude generates ONLY en-US (one async batch request — no
 * 300s timeout, 50% cheaper, single attempt). This drain polls that batch; once
 * ended it ingests en-US through the validators, publishes it, promotes the held
 * item to `published`, and then produces every OTHER locale via DeepL
 * (translateArticleLocales) from the published English — publishing each. English
 * is never blocked on translations; a DeepL failure leaves the article live in
 * English only and the next tick re-attempts.
 *
 * Idempotent: ingest + DeepL UPDATE/INSERT localization rows (no dupes), publish
 * is a no-op on already-published rows, and pending_batch_id is cleared only after
 * a successful ingest so a transient failure simply retries next tick.
 */
import { getServiceClient } from "@/lib/supabase/server";
import { getBatch, getBatchResults } from "@/lib/resources/generation/batchClient";
import { ingestBatchResults, type IngestOutcome } from "@/lib/resources/generation/batchExpand";
import { publishContentItemThroughQueue } from "@/lib/resources/cron/publishQueueTick";
import { translateArticleLocales, type LocaleTranslationOutcome } from "@/lib/resources/generation/translateViaDeepL";

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
    /** True when the held item was promoted to workflow_status='published' this tick. */
    promoted?: boolean;
    outcomes?: IngestOutcome[];
    /** Per-locale DeepL translation outcomes (English-first: the non-English locales). */
    translated?: LocaleTranslationOutcome[];
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
      // publish:true — set is_published per locale as it passes validation.
      const outcomes = await ingestBatchResults(lines, { publish: true });

      // Clear the pending id only after a successful ingest. Rejected/failed
      // locales are surfaced in the outcomes; they won't have a published row, so
      // the article simply renders only the locales that succeeded (the public
      // page filters per-locale on is_published — no broken switcher links).
      await sb.from("content_items").update({ pending_batch_id: null }).eq("id", contentItemId);

      // Promote the held item to `published` once at least one locale is live.
      // submitArticleAsBatch creates the item at `in-editorial-review`, and the
      // public page requires content_items.workflow_status='published' (not just
      // the per-locale is_published) — without this the article 404s even though
      // its localizations are published. publishContentItemThroughQueue is the
      // canonical promote path (flips workflow_status + fires post-publish hooks);
      // it is idempotent and a no-op for locales with no row (the rejected ones).
      const anyPublished = outcomes.some((o) => o.status === "inserted" || o.status === "updated");
      let promoted = false;
      if (anyPublished) {
        const { data: item } = await sb
          .from("content_items")
          .select("workflow_status")
          .eq("id", contentItemId)
          .maybeSingle();
        // Only auto-promote our own held autopilot items. A Tier-A pillar that
        // legitimately holds for human review would also be `in-editorial-review`,
        // but the picker never autopilots Tier A unless approved, and this drain
        // only ever sees items it submitted — so promoting `in-editorial-review`
        // here is safe.
        if (item?.workflow_status === "in-editorial-review") {
          try {
            await publishContentItemThroughQueue(contentItemId);
            promoted = true;
          } catch (e) {
            console.error(`[autopilot-batch-drain] promote failed for ${contentItemId}:`, e instanceof Error ? e.message : String(e));
          }
        }
      }

      // English-first: now that en-US is published, produce the other locales via
      // DeepL (English-first model — Claude only writes English). Each is inserted
      // + published. Publish-EN-first: a DeepL failure leaves the article live in
      // English only; the next drain tick re-attempts (idempotent per locale).
      let translated;
      if (promoted) {
        try {
          translated = await translateArticleLocales(contentItemId, { publish: true });
        } catch (e) {
          console.error(`[autopilot-batch-drain] DeepL translate failed for ${contentItemId}:`, e instanceof Error ? e.message : String(e));
        }
      }

      result.ingested += 1;
      result.items.push({ contentItemId, batchId, status: "ingested", promoted, outcomes, translated: translated?.outcomes });
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
