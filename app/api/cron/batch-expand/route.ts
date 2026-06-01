import { NextRequest, NextResponse } from "next/server";
import { cronEnvGate } from "@/lib/cron/envGate";
import {
  submitBacklogBatch,
  ingestBatchResults,
  type BuildBatchOptions,
} from "@/lib/resources/generation/batchExpand";
import { getBatch, getBatchResults } from "@/lib/resources/generation/batchClient";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Batch-mode in-place expansion of the thin Resources Hub backlog via Anthropic
 * Message Batches (50% cheaper than the sync drain; Sonnet quality). Driven by
 * scripts/batch-expand.mjs, which orchestrates submit → poll → ingest → re-batch.
 *
 *   action=submit  &locale=de-DE,sv-SE &limit=N &itemIds=a,b &keys=a::de-DE,..
 *                  &model=claude-sonnet-4-6
 *        → builds requests (with at-floor/dedup guards), submits one batch.
 *          Returns { batchId, requested, skipped, model }.
 *   action=status  &batchId=msgbatch_...   → { processing_status, request_counts }.
 *   action=ingest  &batchId=msgbatch_... &publish=true
 *        → validates + saves results, returns per-locale outcomes + retryable keys.
 *
 * cronEnvGate handles CRON_ENABLED + CRON_SECRET auth.
 */
function csv(v: string | null): string[] | undefined {
  if (!v) return undefined;
  const arr = v.split(",").map((s) => s.trim()).filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}

async function run(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "submit";

  try {
    if (action === "submit") {
      // Retry rounds POST a JSON body { keys, extraByKey, model } (per-key
      // validator feedback is too large for the query string). Query params win
      // for the simple backlog submit.
      let body: Partial<BuildBatchOptions> = {};
      if (req.method === "POST") {
        body = (await req.json().catch(() => ({}))) as Partial<BuildBatchOptions>;
      }
      const opts: BuildBatchOptions = {
        locales: csv(url.searchParams.get("locale")) ?? body.locales,
        itemIds: csv(url.searchParams.get("itemIds")) ?? body.itemIds,
        keys: csv(url.searchParams.get("keys")) ?? body.keys,
        model: url.searchParams.get("model") ?? body.model ?? undefined,
        extraByKey: body.extraByKey,
        applyGuards: body.applyGuards,
      };
      const limitParam = url.searchParams.get("limit");
      if (limitParam) opts.limit = parseInt(limitParam, 10) || undefined;
      const result = await submitBacklogBatch(opts);
      return NextResponse.json(result, { status: 200 });
    }

    if (action === "status") {
      const batchId = url.searchParams.get("batchId");
      if (!batchId) return NextResponse.json({ error: "Missing batchId" }, { status: 400 });
      const handle = await getBatch(batchId);
      return NextResponse.json(
        { batchId, processing_status: handle.processing_status, request_counts: handle.request_counts },
        { status: 200 }
      );
    }

    if (action === "ingest") {
      const batchId = url.searchParams.get("batchId");
      if (!batchId) return NextResponse.json({ error: "Missing batchId" }, { status: 400 });
      const publish = url.searchParams.get("publish") === "true";
      const lines = await getBatchResults(batchId);
      const outcomes = await ingestBatchResults(lines, { publish });
      const retryKeys = outcomes
        .filter((o) => o.status === "rejected" || (o.status === "failed" && o.retryFeedback !== undefined))
        .map((o) => o.key);
      return NextResponse.json({ batchId, count: outcomes.length, outcomes, retryKeys }, { status: 200 });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}
