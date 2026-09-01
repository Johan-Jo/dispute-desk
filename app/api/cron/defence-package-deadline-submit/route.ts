/**
 * GET /api/cron/defence-package-deadline-submit
 *
 * Last-day auto-submit for Defence Packages — THE ACTUAL SUBMITTER.
 *
 * WHAT CHANGED, AND WHY IT MATTERS MOST HERE (CP-C, risk R3). This route used
 * to consult NO strength, NO completeness, NO coverage and NO guards. It filed
 * every non-conceded case with a valid PDF inside the due window, which meant
 * every gate the rest of the product enforced was advisory: whatever the
 * pipeline blocked in the morning, this route filed at the deadline.
 *
 * It now reads the ONE canonical `CaseAutomationDecision` and executes P-6:
 *
 *   deadline_only execution is allowed ONLY with a current canonical decision
 *   AND a current validated safe package, with no hard block, no staleness, no
 *   ambiguity and no unsupported argument.
 *
 * Five conditions, conjunctive, evaluated by the shared `mayExecuteAtDeadline`
 * through `selectForDeadline`. **A deadline relaxes NOTHING.** When any one
 * fails, nothing is filed and the merchant is emailed — the honest outcome, not
 * a reason to file something weaker.
 *
 * The package is obtained through the shared selector port, never through a
 * fileable-row query in this route. The window is computed at execution from
 * the decision's ABSOLUTE due date; the decision itself carries no relative
 * time state.
 *
 * Remaining behaviour, unchanged:
 *   - latest package `final`      → enqueue `save_to_shopify` via the RPC
 *   - latest `draft`/`stale` + ok → auto-finalize through the RPC, then submit
 *   - anything else               → file nothing, email the merchant
 *   - `review_state = "conceded"` → never submitted, whatever else is true
 *
 * Auth: `cronEnvGate` (CRON_ENABLED + Bearer / header / query secret), first.
 * No-op when `ENABLE_DEFENCE_PACKAGE_BUILDER=false`.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { isDefencePackageBuilderEnabled } from "@/lib/featureFlags";
import { sendDefenceDeadlineFallbackAlert } from "@/lib/email/sendDefenceDeadlineFallbackAlert";
import { decideForPack, selectForDeadline } from "@/lib/automation/decision";
import {
  buildFileableSelectionContext,
  createCanonicalSelector,
  fallbackReasonForSelection,
  type FileableSelectionContext,
} from "@/lib/defence/package";
import { getShopSettings } from "@/lib/automation/settings";
import {
  parseEnqueueRpcResult,
  parseFinalizeRpcResult,
} from "@/lib/defence/finalizeRpc";
import { cronEnvGate } from "@/lib/cron/envGate";
import {
  classifyUnconfirmedSaves,
  summariseUnconfirmed,
  CONFIRMATION_GRACE_HOURS,
} from "@/lib/automation/unconfirmedForwarding";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { canonicalPipelineEnabled } from "@/lib/pipeline/activation";
import { runDeadlineSubmitLegacy } from "./legacyRoute";

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
  /** P-6 refusals: the decision or the selector said this case may not be
   *  filed at all. Counted separately from a transaction refusal, because
   *  nothing about them is retriable — they are the gate working. */
  blockedByDecision: number;
  emailed: number;
  /** Saved-but-unconfirmed forwarding, by urgency. Reported, never acted on. */
  unconfirmedForwarding?: Record<"past_deadline" | "due_soon" | "watch", number>;
  errors: Array<{ disputeId: string; error: string }>;
}

export async function GET(req: NextRequest) {
  // `cronEnvGate` FIRST, on both branches, before the switch is even read —
  // the enumeration test asserts it is the first statement of every cron
  // route, and an activation flag is not a reason to authenticate later.
  const gate = cronEnvGate(req);
  if (gate) return gate;

  // DARK UNTIL PR 3. The canonical route below files only under P-6's six
  // conjunctive conditions, through the real selector. The shipped route
  // consults no strength, no completeness, no coverage and no guards (R3) —
  // that gap is what this replaces, and it is exactly why the replacement
  // cannot land live before the pre-activation rebuild has given open cases
  // current hashes.
  if (!canonicalPipelineEnabled()) return runDeadlineSubmitLegacy(req);

  const summary: Summary = {
    flagOn: isDefencePackageBuilderEnabled(),
    scanned: 0,
    enqueuedAutoFinalize: 0,
    enqueuedSubmit: 0,
    enqueuedFallback: 0,
    finalizeRefused: 0,
    blockedByDecision: 0,
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
      "id, shop_id, dispute_gid, reason, network_reason_code, amount, currency_code, due_at, status, normalized_status, review_state",
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

  /* The ONE way this route obtains a package: CP-B's real
   * `selectFileablePackage`, over every candidate version for the case.
   *
   * No fileable-row query lives in this file, and the placeholder that used to
   * stand here — `order by version desc limit 1` plus the lifecycle and content
   * checks — is deleted rather than kept as a fallback. It could never answer
   * "is this package CURRENT", because nothing it read recorded what the
   * package was built from.
   *
   * The per-case context is filled in below, after the decision exists: the
   * selector judges a candidate against the decision the executor is actually
   * acting on, never against one it re-derived for itself. */
  const contexts = new Map<string, FileableSelectionContext>();
  const selector = createCanonicalSelector({
    sb,
    contextFor: (caseId: string) => contexts.get(caseId) ?? null,
  });
  const settingsByShop = new Map<string, Awaited<ReturnType<typeof getShopSettings>>>();

  for (const d of disputes) {
    try {
      // Merchant explicitly conceded this dispute ("do not defend").
      // NEVER auto-submit it, regardless of pack state — checked before the
      // decision because it is an instruction, not an assessment.
      // (2026-07-23 review lifecycle; lib/disputes/reviewState.ts.)
      if (d.review_state === "conceded") {
        summary.scanned--; // don't count a deliberately-skipped dispute
        continue;
      }

      // Find the latest pack for this dispute (the source pack for the
      // defence package, also the entity_id of save_to_shopify).
      const { data: pack } = await sb
        .from("evidence_packs")
        .select(
          "id, status, completeness_score, blockers, submission_readiness, pack_json",
        )
        .eq("dispute_id", d.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!pack) {
        // No pack at all — can't auto-submit anything. Skip; merchant will
        // see the dispute on dashboards.
        continue;
      }

      let settings = settingsByShop.get(d.shop_id as string);
      if (!settings) {
        settings = await getShopSettings(d.shop_id as string);
        settingsByShop.set(d.shop_id as string, settings);
      }

      /* ── THE canonical decision, then P-6 ─────────────────────────────
       *
       * `automationMode: "auto"` is correct for the deadline evaluation and is
       * not an assumption about the shop's rules: the deadline path consults
       * only whether the decision BLOCKS, and every blocking rung (coverage,
       * fatal-loss, staleness, hard block) sits above the automation-mode rung,
       * so the mode cannot turn a block into a non-block. That property is
       * asserted directly in `decisionLadder.test.ts` rather than left as a
       * comment, because a future reordering would otherwise break this
       * silently. */
      const decision = decideForPack({
        caseId: d.id as string,
        pack: {
          id: pack.id as string,
          dispute_id: d.id as string,
          completeness_score: (pack.completeness_score as number | null) ?? null,
          blockers: pack.blockers,
          submission_readiness: pack.submission_readiness,
          pack_json: pack.pack_json,
        },
        settings,
        automationMode: "auto",
        evidenceDueAt: (d.due_at as string | null) ?? null,
      });

      /* What "current" means for this case, right now. Derived through the
       * SAME `derivePlanForCase` the build job wrote the package with — two
       * bridges would produce two hashes and every package would read stale
       * against itself. */
      const context = await buildFileableSelectionContext({
        sb,
        caseId: d.id as string,
        pack: {
          id: pack.id as string,
          dispute_id: d.id as string,
          completeness_score: (pack.completeness_score as number | null) ?? null,
          blockers: pack.blockers,
          submission_readiness: pack.submission_readiness,
          pack_json: pack.pack_json,
          checklist_v2: (pack as { checklist_v2?: unknown }).checklist_v2 ?? null,
        },
        decision,
        disputeReason: (d.reason as string | null) ?? null,
        networkReasonCode: (d.network_reason_code as string | null) ?? null,
        reasonCodeModuleKey: null,
      });
      if (context) contexts.set(d.id as string, context);

      const outcome = await selectForDeadline({
        decision,
        // The decision was derived from the rows that are current right now, so
        // it is fresh by construction. When CP-A's persisted assessment lands,
        // this becomes `evaluateFreshness(...)` against the stored snapshot —
        // the ONE shared predicate, never a date comparison.
        decisionFreshness: { fresh: true },
        selector,
        caseId: d.id as string,
        // The window is computed HERE, at execution, from the decision's
        // absolute due date. The decision carries no window state of its own.
        now,
      });

      const dpkg = selector.judgedFor(d.id as string);

      if (outcome.selection.outcome !== "selected") {
        /* Nothing may be filed. The merchant is told; nothing weaker is
         * substituted, and no older version is tried. */
        summary.enqueuedFallback += 1;
        /* The refusal reason comes from the SELECTION's own typed vocabulary
         * now, not from a selector-private detail enum that ran in parallel
         * with it. One refusal vocabulary, and the merchant copy stops
         * depending on a type PR 3 deletes. */
        const unsafeContent = selector.unsafeContentFor(d.id as string);
        const fallbackReason = unsafeContent
          ? ("unsafe_address_claim" as const)
          : fallbackReasonForSelection(outcome.selection);
        const decisionRefused =
          outcome.selection.outcome === "none" &&
          dpkg != null &&
          outcome.selection.reason === "hard_block";
        if (decisionRefused || decision.action === "block") summary.blockedByDecision += 1;

        await logAuditEvent({
          shopId: d.shop_id,
          disputeId: d.id,
          packId: pack.id,
          actorType: "system",
          eventType: unsafeContent
            ? "defence_package_blocked_unsafe_claim"
            : "defence_package_failed",
          eventPayload: {
            trigger: "deadline_cron_no_fallback",
            fallbackReason,
            dueAt: d.due_at,
            // P-6, named. An executor that can only say "not allowed" produces
            // exactly the un-diagnosable behaviour this replaces.
            deadlineConditions: outcome.conditions,
            deadlineWindow: outcome.window,
            decisionAction: decision.action,
            decisionReasonCodes: decision.reasonCodes,
            decisionInputHash: decision.freshness.inputHash,
            selectionReason:
              outcome.selection.outcome === "none" ? outcome.selection.reason : "ambiguous",
            ...(unsafeContent
              ? {
                  packageId: dpkg?.packageId ?? null,
                  version: dpkg?.version ?? null,
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
          // The verdict's own reasons, so the copy can say which of the five
          // outcomes this is instead of asserting the most specific one.
          unsafeReasons: unsafeContent ? selector.unsafeReasonsFor(d.id as string) : undefined,
        });
        if (emailResult.ok) summary.emailed += 1;
        continue;
      }

      /* The selection says whether this row still needs promoting; the status
       * column is only the evidence behind that. Reading the flag rather than
       * re-deriving from `status` keeps ONE answer to "must this be finalized
       * first" — the selector's — instead of a second opinion that can drift
       * from the rung that authorised it. */
      const requiresFinalize = outcome.selection.package.requiresFinalize;

      // We have a defence package row. Decide the action by status.
      if (!requiresFinalize) {
        // Already finalized — enqueue the save through the transactional RPC.
        //
        // This used to be a bare `jobs.insert` whose RESULT WAS IGNORED, so a
        // failed insert was counted as `enqueuedSubmit`. On the last-day cron
        // that is the worst place to over-report: the dispute gets no further
        // retry before its deadline. It also skipped the currency, revision
        // and fileability checks the enqueue transaction performs.
        const finalRevision = dpkg!.contentRevision;
        if (!finalRevision) {
          summary.finalizeRefused += 1;
          continue;
        }

        const { data: enqData, error: enqErr } = await sb.rpc(
          "enqueue_defence_package_save",
          { p_package_id: dpkg!.packageId, p_expected_revision: finalRevision },
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
      /* A `selected` outcome already proves validation and an artifact — the
       * selector refuses `validationPassed !== true`, a non-`ok`
       * `validation_status` and a missing artifact before it can return one. So
       * the lifecycle branch asks only what it is about to DO: promote, or
       * enqueue an already-final row. Re-checking the same two columns here
       * would be a second gate with its own opinion. */
      {
        // Promotion goes through the transactional RPC, exactly like every
        // other promotion writer. This route used to do it in three unguarded
        // PostgREST calls — select the prior final, flip this row to `final`,
        // flip that one to `superseded` — with no lock, no revision check and
        // no atomicity, so a newer version or a concurrently-submitted
        // predecessor could be trampled. `p_allowed_statuses` keeps the
        // pre-existing behaviour of auto-finalizing a `stale` candidate as
        // well as a `draft`; nothing else about the deadline policy changes.
        const revision = dpkg!.contentRevision;
        if (!revision) {
          summary.finalizeRefused += 1;
          continue;
        }

        const { data: rpcData, error: rpcErr } = await sb.rpc("finalize_defence_package", {
          p_package_id: dpkg!.packageId,
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
          expectedPackageId: dpkg!.packageId,
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
                replacedById: dpkg!.packageId,
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
              packageId: dpkg!.packageId,
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

      // Unreachable by construction: the selector refuses every shape that is
      // neither `final` nor a finalizable draft/stale, and it refused above.
      // Kept as a fail-closed arm rather than deleted — if the selector ever
      // widens, this route files nothing and says so instead of falling
      // through to a submit it was never authorised to make.
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

  // ── Saves the platform never confirmed forwarding ────────────────────────
  //
  // The scan above deliberately filters `evidence_saved_to_shopify_at IS NULL`
  // — the disputes where we have not filed. That makes the opposite population
  // invisible to it: evidence attached and read back, but no `evidenceSentOn`
  // from Shopify, so `submission_state` never left `saved_to_shopify`. Two prod
  // disputes reached a decision in that state with nothing watching.
  //
  // Reported, not acted on. An unconfirmed save is not proof nothing reached
  // the issuer (one of the two was won); it is proof we cannot show it did, and
  // that belongs in front of someone while the deadline can still be met.
  try {
    const { data: savedRows, error: savedErr } = await sb
      .from("disputes")
      .select(
        "id, shop_id, evidence_saved_to_shopify_at, submitted_at, submission_state, due_at, final_outcome",
      )
      .not("evidence_saved_to_shopify_at", "is", null)
      .is("submitted_at", null)
      .is("final_outcome", null);

    if (savedErr) throw savedErr;

    const unconfirmed = classifyUnconfirmedSaves(savedRows ?? [], now);
    summary.unconfirmedForwarding = summariseUnconfirmed(unconfirmed);

    // One event per shop, not one for the scan. An audit row belongs to the
    // shop it concerns; a single cross-shop row would be unreadable from any
    // merchant's own history.
    const byShop = new Map<string, typeof unconfirmed>();
    for (const u of unconfirmed) {
      const list = byShop.get(u.shopId) ?? [];
      list.push(u);
      byShop.set(u.shopId, list);
    }
    for (const [shopId, list] of byShop) {
      await logAuditEvent({
        shopId,
        actorType: "system",
        eventType: "defence_package_forwarding_unconfirmed",
        eventPayload: {
          graceHours: CONFIRMATION_GRACE_HOURS,
          counts: summariseUnconfirmed(list),
          // Bounded: the payload is for triage, not a second copy of the table.
          disputes: list.slice(0, 25),
        },
      });
    }
  } catch (err) {
    // Never let the detector cost the submissions. This route's job is filing;
    // reporting is the addition.
    summary.errors.push({
      disputeId: "unconfirmed-forwarding-scan",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json(summary);
}

/**
 * The selector's refusal detail, in the vocabulary the merchant email already
 * speaks. It replaces `pickFallbackReason`, which re-read the package row this
 * route no longer owns — but it preserves every one of its answers, including
 * the `failure_code === "covered_shopify"` distinction that stops a
 * Shopify-Protect dispute being told its evidence was too thin.
 */
