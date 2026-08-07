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
import { assessPackageCandidateSafety } from "@/lib/defence/packageSafety";
import {
  parseEnqueueRpcResult,
  parseFinalizeRpcResult,
} from "@/lib/defence/finalizeRpc";
import { cronEnvGate } from "@/lib/cron/envGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Summary {
  flagOn: boolean;
  scanned: number;
  enqueuedAutoFinalize: number;
  enqueuedSubmit: number;
  enqueuedFallback: number;
  /** Auto-finalize attempts the transaction refused, or that we could not
   *  verify. Nothing was written for these; the next run retries. */
  finalizeRefused: number;
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
    finalizeRefused: 0,
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
  //
  // Review mode is a HARD gate: a dispute parked for merchant review
  // (`normalized_status = "needs_review"`) is NEVER auto-submitted on the
  // deadline. Nothing is sent unless the merchant explicitly submits from
  // the workspace. This is a deliberate product decision (2026-07-06) —
  // review mode means "the merchant decides", so `needs_review` is
  // intentionally EXCLUDED from this list. (Auto mode still auto-submits;
  // the pipeline only parks to review when a rule says so or strength is
  // below the auto threshold.) Do NOT re-add `needs_review` here.
  //
  // ONE EXCEPTION, added 2026-07-29: `review_state = "approved"`. That is the
  // merchant pressing "Submit on the deadline" — an explicit instruction, not
  // an absence of one. The approve handler
  // (app/api/disputes/[id]/review/route.ts) writes `review_state` but
  // deliberately leaves `needs_review` alone, because that flag drives the
  // review queues and attention lists everywhere else. Without this inclusion
  // an approved dispute stayed `needs_review`, fell outside the status filter,
  // and was never submitted — so the button promised a submission that never
  // happened and the merchant forfeited by default. `conceded` still wins: it
  // is checked per-dispute below and returns before any submit path.
  const merchantActionableStatuses = [
    "new",
    "in_progress",
    "ready_to_submit",
    "action_needed",
  ];
  const { data: disputes, error } = await sb
    .from("disputes")
    .select(
      "id, shop_id, dispute_gid, reason, amount, currency_code, due_at, status, normalized_status, review_state",
    )
    .gte("due_at", startOfToday.toISOString())
    .lt("due_at", endOfToday.toISOString())
    .is("evidence_saved_to_shopify_at", null)
    .or(
      `normalized_status.is.null,normalized_status.in.(${merchantActionableStatuses.join(",")}),review_state.eq.approved`,
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
      // Merchant explicitly conceded this dispute ("do not defend").
      // NEVER auto-submit it, regardless of pack state — covers the plain
      // submit path AND both auto-finalize + fallback branches below.
      // (2026-07-23 review lifecycle; lib/disputes/reviewState.ts.)
      if (d.review_state === "conceded") {
        summary.scanned--; // don't count a deliberately-skipped dispute
        continue;
      }
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
        // `failure_code` distinguishes a Shopify-Protect skip from a
        // no-bank-facts skip; without it every skip is reported as the latter.
        .select(
          "id, status, validation_status, pdf_path, version, failure_code, content_revision, facts_json, narrative_json",
        )
        .eq("dispute_id", d.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      // PR-C1 — candidate-safety gate, evaluated on the LATEST candidate only.
      // A blocked candidate files NOTHING and notifies; the executor must never
      // walk back to an older version to find something fileable, because the
      // older versions are precisely the unsafe ones.
      const unsafeCandidate = dpkg
        ? assessPackageCandidateSafety({
            factsJson: dpkg.facts_json,
            narrativeJson: dpkg.narrative_json,
          })
        : null;

      const fallbackReason =
        unsafeCandidate && !unsafeCandidate.safe
          ? ("unsafe_address_claim" as const)
          : pickFallbackReason(dpkg);

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
          eventType:
            fallbackReason === "unsafe_address_claim"
              ? "defence_package_blocked_unsafe_claim"
              : "defence_package_failed",
          eventPayload: {
            trigger: "deadline_cron_no_fallback",
            fallbackReason,
            dueAt: d.due_at,
            ...(fallbackReason === "unsafe_address_claim"
              ? {
                  packageId: dpkg?.id ?? null,
                  version: dpkg?.version ?? null,
                  reasons: unsafeCandidate?.reasons ?? [],
                  retiredKeys: unsafeCandidate?.retiredKeys ?? [],
                }
              : {}),
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
        // Already finalized — enqueue the save through the transactional RPC.
        //
        // This used to be a bare `jobs.insert` whose RESULT WAS IGNORED, so a
        // failed insert was counted as `enqueuedSubmit`. On the last-day cron
        // that is the worst place to over-report: the dispute gets no further
        // retry before its deadline. It also skipped the currency, revision
        // and fileability checks the enqueue transaction performs.
        const finalRevision = dpkg!.content_revision as string | null;
        if (!finalRevision) {
          summary.finalizeRefused += 1;
          continue;
        }

        const { data: enqData, error: enqErr } = await sb.rpc(
          "enqueue_defence_package_save",
          { p_package_id: dpkg!.id, p_expected_revision: finalRevision },
        );
        if (enqErr) {
          console.error("[deadline cron] enqueue_defence_package_save failed", enqErr);
          summary.errors.push({ disputeId: d.id, error: enqErr.message });
          summary.finalizeRefused += 1;
          continue;
        }

        const enq = parseEnqueueRpcResult(enqData);
        if (enq.kind === "conflict" || enq.kind === "malformed") {
          console.error(
            "[deadline cron] enqueue refused",
            enq.kind === "conflict" ? enq.reason : enq.detail,
          );
          summary.finalizeRefused += 1;
          continue;
        }

        // `enqueued` and `already_done` both mean a save job exists for this
        // pack; only these count.
        summary.enqueuedSubmit += 1;
        continue;
      }

      // Draft or stale with validation=ok and a PDF: auto-finalize, then submit.
      if (
        (dpkg!.status === "draft" || dpkg!.status === "stale") &&
        dpkg!.validation_status === "ok" &&
        dpkg!.pdf_path
      ) {
        // Promotion goes through the transactional RPC, exactly like every
        // other promotion writer. This route used to do it in three unguarded
        // PostgREST calls — select the prior final, flip this row to `final`,
        // flip that one to `superseded` — with no lock, no revision check and
        // no atomicity, so a newer version or a concurrently-submitted
        // predecessor could be trampled. `p_allowed_statuses` keeps the
        // pre-existing behaviour of auto-finalizing a `stale` candidate as
        // well as a `draft`; nothing else about the deadline policy changes.
        const revision = dpkg!.content_revision as string | null;
        if (!revision) {
          summary.finalizeRefused += 1;
          continue;
        }

        const { data: rpcData, error: rpcErr } = await sb.rpc("finalize_defence_package", {
          p_package_id: dpkg!.id,
          p_expected_revision: revision,
          p_expected_version: dpkg!.version,
          p_enqueue_save: true,
          p_allowed_statuses: ["draft", "stale"],
        });
        if (rpcErr) {
          console.error("[deadline cron] finalize_defence_package failed", rpcErr);
          summary.finalizeRefused += 1;
          continue;
        }

        const finalizeResult = parseFinalizeRpcResult(rpcData, {
          expectEnqueue: true,
          expectedPackageId: dpkg!.id as string,
        });
        if (finalizeResult.kind === "malformed" || finalizeResult.kind === "conflict") {
          // Nothing was written. Do not claim a submission the database
          // refused, or one we cannot verify.
          console.error(
            "[deadline cron] finalize refused",
            finalizeResult.kind === "conflict" ? finalizeResult.reason : finalizeResult.detail,
          );
          summary.finalizeRefused += 1;
          continue;
        }

        if (finalizeResult.kind === "promoted") {
          if (finalizeResult.supersededId) {
            await logAuditEvent({
              shopId: d.shop_id,
              disputeId: d.id,
              packId: pack.id,
              actorType: "system",
              eventType: "defence_package_superseded",
              eventPayload: {
                supersededId: finalizeResult.supersededId,
                supersededVersion: finalizeResult.supersededVersion,
                replacedById: dpkg!.id,
                replacedByVersion: dpkg!.version,
              },
            });
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
              jobId: finalizeResult.jobId,
            },
          });
          summary.enqueuedAutoFinalize += 1;
        }

        // `already_done` means an earlier run committed this exact promotion
        // and its save job exists — counted as submitted, audited once.
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
  dpkg: {
    status: string;
    validation_status: string | null;
    failure_code?: string | null;
  } | null,
):
  | "validation_failed"
  | "skipped_no_facts"
  | "skipped_covered"
  | "missing"
  | null {
  if (!dpkg) return "missing";
  if (dpkg.status === "failed") return "validation_failed";
  if (dpkg.status === "skipped") {
    // `failure_code` is what distinguishes the coverage gate from
    // no-bank-facts. It used to be left unread "for simplicity", which meant
    // `skipped_covered` was never returned and a Shopify-Protect dispute was
    // emailed "not enough bank-eligible evidence" — telling a merchant their
    // evidence was too thin when the real answer is that Shopify is already
    // covering the loss and there is nothing to do.
    if (dpkg.failure_code === "covered_shopify") return "skipped_covered";
    return "skipped_no_facts";
  }
  return null;
}
