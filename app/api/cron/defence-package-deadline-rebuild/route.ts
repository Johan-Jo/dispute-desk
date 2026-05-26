/**
 * GET /api/cron/defence-package-deadline-rebuild
 *
 * Pre-deadline pack rebuild. Runs daily at 06:00 UTC (Vercel cron),
 * two hours before the 08:00 deadline-submit cron. Picks up
 * late-arriving Shopify order data — shipping tracking, delivery
 * confirmation, AVS/CVV codes, fraud risk verdicts — that landed
 * AFTER the original `build_pack` ran. Without this, a dispute
 * filed Monday with no tracking, shipped Tuesday, delivered
 * Wednesday, deadline Friday, would still submit Monday's empty
 * pack — silently dropping outcome-affecting evidence the system
 * could have collected.
 *
 * Decision per due-today dispute:
 *   - pack updated within the last 6h         → skip (already fresh)
 *   - pack is currently building / queued     → skip (a job is in flight)
 *   - dispute already submitted to Shopify    → skip (window closed)
 *   - dispute not eligible for auto-action    → skip
 *   - otherwise                               → enqueue `build_pack`
 *
 * The 6h floor is a safety against churn: if the merchant already
 * regenerated this morning, we don't double up.
 *
 * The downstream 08:00 cron will then see the freshly-rebuilt pack
 * and run its normal submit logic. If the rebuild produces no
 * material change, the merchant submits the (now-verified) same
 * pack content.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` header OR `?secret=`
 * query param (mirrors the other cron routes).
 *
 * No-op when `ENABLE_DEFENCE_PACKAGE_BUILDER=false`.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { isDefencePackageBuilderEnabled } from "@/lib/featureFlags";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { cronEnvGate } from "@/lib/cron/envGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pack age below this cutoff is considered "fresh enough" — no rebuild.
 *  Six hours leaves room for a morning merchant regenerate without
 *  triggering a second one immediately. */
const FRESHNESS_FLOOR_MS = 6 * 60 * 60 * 1000;

interface Summary {
  flagOn: boolean;
  scanned: number;
  enqueuedRebuild: number;
  skippedAlreadyFresh: number;
  skippedAlreadyBuilding: number;
  skippedAlreadySaved: number;
  skippedNoPack: number;
  errors: Array<{ disputeId: string; error: string }>;
}

export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const summary: Summary = {
    flagOn: isDefencePackageBuilderEnabled(),
    scanned: 0,
    enqueuedRebuild: 0,
    skippedAlreadyFresh: 0,
    skippedAlreadyBuilding: 0,
    skippedAlreadySaved: 0,
    skippedNoPack: 0,
    errors: [],
  };

  if (!summary.flagOn) {
    return NextResponse.json({
      ...summary,
      note: "ENABLE_DEFENCE_PACKAGE_BUILDER=false; no-op",
    });
  }

  const sb = getServiceClient();

  // "Today" boundaries in UTC. Match the deadline-submit cron's window
  // exactly so the same disputes are scanned by both runs.
  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0),
  );
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

  const merchantActionableStatuses = [
    "new",
    "in_progress",
    "needs_review",
    "ready_to_submit",
    "action_needed",
  ];

  const { data: disputes, error } = await sb
    .from("disputes")
    .select("id, shop_id, due_at")
    .gte("due_at", startOfToday.toISOString())
    .lt("due_at", endOfToday.toISOString())
    .is("evidence_saved_to_shopify_at", null)
    .or(
      `normalized_status.is.null,normalized_status.in.(${merchantActionableStatuses.join(",")})`,
    );

  if (error) {
    return NextResponse.json(
      { ...summary, error: error.message },
      { status: 500 },
    );
  }

  summary.scanned = disputes?.length ?? 0;
  if (!disputes?.length) {
    return NextResponse.json(summary);
  }

  const freshnessCutoffISO = new Date(now.getTime() - FRESHNESS_FLOOR_MS).toISOString();

  for (const d of disputes) {
    try {
      // Find the latest pack for this dispute (matches the submit cron's
      // lookup so the same artifact gets refreshed).
      const { data: pack } = await sb
        .from("evidence_packs")
        .select("id, status, updated_at, saved_to_shopify_at")
        .eq("dispute_id", d.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!pack) {
        // No pack at all — there's nothing to rebuild. The deadline-submit
        // cron will email a fallback alert.
        summary.skippedNoPack += 1;
        continue;
      }

      if (pack.saved_to_shopify_at) {
        // Belt-and-suspenders — the dispute query already filters on
        // `evidence_saved_to_shopify_at` being null. Catch any race where
        // a save landed between query and per-dispute processing.
        summary.skippedAlreadySaved += 1;
        continue;
      }

      // In-flight build — leave it alone. A second `build_pack` would
      // duplicate work; the existing build will land before 08:00.
      if (pack.status === "building" || pack.status === "queued") {
        summary.skippedAlreadyBuilding += 1;
        continue;
      }

      // Active build_pack job already in the queue? Don't double-enqueue.
      const { data: activeJob } = await sb
        .from("jobs")
        .select("id")
        .eq("entity_id", pack.id)
        .eq("job_type", "build_pack")
        .in("status", ["queued", "running"])
        .limit(1)
        .maybeSingle();
      if (activeJob) {
        summary.skippedAlreadyBuilding += 1;
        continue;
      }

      // Freshness check: pack already updated within the last 6h.
      const updatedAt = pack.updated_at as string | null;
      if (updatedAt && updatedAt >= freshnessCutoffISO) {
        summary.skippedAlreadyFresh += 1;
        continue;
      }

      const { error: jobErr } = await sb.from("jobs").insert({
        shop_id: d.shop_id,
        job_type: "build_pack",
        entity_id: pack.id,
      });
      if (jobErr) {
        summary.errors.push({ disputeId: d.id, error: jobErr.message });
        continue;
      }

      summary.enqueuedRebuild += 1;
      await logAuditEvent({
        shopId: d.shop_id,
        disputeId: d.id,
        packId: pack.id,
        actorType: "system",
        eventType: "auto_build_enqueued",
        eventPayload: {
          trigger: "deadline_rebuild_cron",
          dueAt: d.due_at,
          packPreviousUpdatedAt: updatedAt,
        },
      });
    } catch (err) {
      summary.errors.push({
        disputeId: d.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json(summary);
}
