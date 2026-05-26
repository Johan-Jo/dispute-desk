/**
 * GET /api/cron/defence-package-deadline-submit
 *
 * Last-day auto-submit for Defence Packages.
 *
 * Runs daily at 08:00 UTC (Vercel cron). For each dispute whose Shopify
 * evidence deadline (`disputes.due_at`) falls on today's UTC date AND
 * which has not yet been submitted to Shopify, decide what to ship:
 *
 *   - latest defence package is `final` → enqueue `save_to_shopify` (the
 *     normal path; defence-package PDF will replace `uncategorizedFile`).
 *   - latest is `draft` or `stale` with `validation_status=ok` →
 *     auto-finalize (supersede any prior final, flip this row to final),
 *     then enqueue `save_to_shopify`. This is the auto-submit-on-the-
 *     last-day promotion of a draft the merchant never finalized.
 *   - latest is `failed` / `skipped`, OR no defence_packages row exists
 *     → Option-D fallback: enqueue `save_to_shopify_pack_fallback` (skips
 *     the defence-package gate and uses the existing pack PDF) AND email
 *     the merchant via `sendDefenceDeadlineFallbackAlert`.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` header OR `?secret=` query
 * param (mirrors the other cron routes).
 *
 * No-op when `ENABLE_DEFENCE_PACKAGE_BUILDER=false`.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { isDefencePackageBuilderEnabled } from "@/lib/featureFlags";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { sendDefenceDeadlineFallbackAlert } from "@/lib/email/sendDefenceDeadlineFallbackAlert";
import { cronEnvGate } from "@/lib/cron/envGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Summary {
  flagOn: boolean;
  scanned: number;
  enqueuedAutoFinalize: number;
  enqueuedSubmit: number;
  enqueuedFallback: number;
  emailed: number;
  errors: Array<{ disputeId: string; error: string }>;
}

export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const summary: Summary = {
    flagOn: isDefencePackageBuilderEnabled(),
    scanned: 0,
    enqueuedAutoFinalize: 0,
    enqueuedSubmit: 0,
    enqueuedFallback: 0,
    emailed: 0,
    errors: [],
  };

  if (!summary.flagOn) {
    return NextResponse.json({ ...summary, note: "ENABLE_DEFENCE_PACKAGE_BUILDER=false; no-op" });
  }

  const sb = getServiceClient();

  // "Today" boundaries in UTC. We scan for due_at within the next 24h
  // (i.e. due today or before tomorrow's 08:00 UTC) so the morning cron
  // catches deadlines that fall later the same day.
  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0),
  );
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

  // Disputes still awaiting evidence submission, with deadline today.
  const merchantActionableStatuses = [
    "new",
    "in_progress",
    "needs_review",
    "ready_to_submit",
    "action_needed",
  ];
  const { data: disputes, error } = await sb
    .from("disputes")
    .select(
      "id, shop_id, dispute_gid, reason, amount, currency_code, due_at, status, normalized_status",
    )
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

  for (const d of disputes) {
    try {
      // Find the latest pack for this dispute (the source pack for the
      // defence package, also the entity_id of save_to_shopify).
      const { data: pack } = await sb
        .from("evidence_packs")
        .select("id, status")
        .eq("dispute_id", d.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!pack) {
        // No pack at all — can't auto-submit anything. Skip; merchant will
        // see the dispute on dashboards.
        continue;
      }

      // Look at the latest defence package row for this dispute.
      const { data: dpkg } = await sb
        .from("defence_packages")
        .select("id, status, validation_status, pdf_path, version")
        .eq("dispute_id", d.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      const fallbackReason = pickFallbackReason(dpkg);

      if (fallbackReason !== null) {
        // Post-retirement: no pack-PDF fallback. The defence-package PDF
        // is the sole bank-facing artifact, so a missing / failed /
        // skipped row on the deadline can only be surfaced to the
        // merchant via email. The merchant must regenerate manually.
        summary.enqueuedFallback += 1;

        await logAuditEvent({
          shopId: d.shop_id,
          disputeId: d.id,
          packId: pack.id,
          actorType: "system",
          eventType: "defence_package_failed",
          eventPayload: {
            trigger: "deadline_cron_no_fallback",
            fallbackReason,
            dueAt: d.due_at,
          },
        });

        const emailResult = await sendDefenceDeadlineFallbackAlert({
          shopId: d.shop_id,
          disputeId: d.id,
          disputeGid: d.dispute_gid as string | null,
          reason: d.reason as string | null,
          amount: d.amount as number | null,
          currencyCode: d.currency_code as string | null,
          dueAt: d.due_at as string | null,
          fallbackReason,
        });
        if (emailResult.ok) summary.emailed += 1;
        continue;
      }

      // We have a defence package row. Decide the action by status.
      if (dpkg!.status === "final") {
        // Already finalized — just submit.
        await sb.from("jobs").insert({
          shop_id: d.shop_id,
          job_type: "save_to_shopify",
          entity_id: pack.id,
        });
        summary.enqueuedSubmit += 1;
        continue;
      }

      // Draft or stale with validation=ok and a PDF: auto-finalize, then submit.
      if (
        (dpkg!.status === "draft" || dpkg!.status === "stale") &&
        dpkg!.validation_status === "ok" &&
        dpkg!.pdf_path
      ) {
        // Supersede any prior final first (so the trigger is happy when
        // we flip this row to final).
        const { data: priorFinal } = await sb
          .from("defence_packages")
          .select("id, version")
          .eq("dispute_id", d.id)
          .eq("status", "final")
          .neq("id", dpkg!.id)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();

        await sb
          .from("defence_packages")
          .update({ status: "final", updated_at: new Date().toISOString() })
          .eq("id", dpkg!.id);

        if (priorFinal) {
          await sb
            .from("defence_packages")
            .update({
              status: "superseded",
              superseded_by_id: dpkg!.id,
              updated_at: new Date().toISOString(),
            })
            .eq("id", priorFinal.id);
        }

        await logAuditEvent({
          shopId: d.shop_id,
          disputeId: d.id,
          packId: pack.id,
          actorType: "system",
          eventType: "defence_package_finalized",
          eventPayload: {
            packageId: dpkg!.id,
            version: dpkg!.version,
            trigger: "deadline_cron_auto_finalize",
            dueAt: d.due_at,
          },
        });

        await sb.from("jobs").insert({
          shop_id: d.shop_id,
          job_type: "save_to_shopify",
          entity_id: pack.id,
        });

        summary.enqueuedAutoFinalize += 1;
        summary.enqueuedSubmit += 1;
        continue;
      }

      // Anything else (draft without validation=ok, etc.) — no auto-
      // submit, no pack-PDF fallback (retired 2026-05-16). Email the
      // merchant; they must regenerate manually.
      summary.enqueuedFallback += 1;
      const emailResult = await sendDefenceDeadlineFallbackAlert({
        shopId: d.shop_id,
        disputeId: d.id,
        disputeGid: d.dispute_gid as string | null,
        reason: d.reason as string | null,
        amount: d.amount as number | null,
        currencyCode: d.currency_code as string | null,
        dueAt: d.due_at as string | null,
        fallbackReason: "validation_failed",
      });
      if (emailResult.ok) summary.emailed += 1;
    } catch (err) {
      summary.errors.push({
        disputeId: d.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json(summary);
}

function pickFallbackReason(
  dpkg: { status: string; validation_status: string | null } | null,
):
  | "validation_failed"
  | "skipped_no_facts"
  | "skipped_covered"
  | "missing"
  | null {
  if (!dpkg) return "missing";
  if (dpkg.status === "failed") return "validation_failed";
  if (dpkg.status === "skipped") {
    // Coverage gate vs no-bank-facts — we treat both as "skipped" status,
    // failure_code distinguishes them but we don't load it here for
    // simplicity. The merchant email mentions the broader reason.
    return "skipped_no_facts";
  }
  return null;
}
