import { getServiceClient } from "../../supabase/server";
import { logAuditEvent } from "../../audit/logEvent";
import { buildPack } from "../../packs/buildPack";
import { evaluateAndMaybeAutoSave } from "../../automation/pipeline";
import { maybeEnqueueDefencePackage } from "../../defence/enqueue";
import { consumePack, PackLimitReachedError } from "../../billing/consumePack";
import {
  sendEvidenceNeededAlert,
  shouldSendEvidenceAlert,
} from "../../email/sendEvidenceNeededAlert";
import { claimAndSendDeferredNewDisputeAlert } from "../../email/sendNewDisputeAlert";
import { sendCaseStrengthenedAlert, type StrengthLevel } from "../../email/sendCaseStrengthenedAlert";
import { emitDisputeEvent } from "../../disputeEvents/emitEvent";
import { updateNormalizedStatus } from "../../disputeEvents/updateNormalizedStatus";
import { stampRebuildOutcome } from "../../automation/rebuildOutcome";
import {
  PACK_CREATED,
  PACK_BUILD_FAILED,
  CASE_STRENGTHENED,
} from "../../disputeEvents/eventTypes";
import { DISPUTE_ATTENTION_REASONS } from "../../disputes/attentionReasons";
import { categorizeEvidenceField } from "../../argument/canonicalEvidence";
import type { ClaimedJob } from "../claimJobs";
import type { BuildResult } from "../../packs/buildPack";

/**
 * Job handler: build_pack
 *
 * Delegates to the buildPack orchestrator which runs all source
 * collectors, writes evidence_items, and computes completeness.
 *
 * entity_id = evidence_packs.id
 */
export async function handleBuildPack(job: ClaimedJob): Promise<void> {
  const db = getServiceClient();
  const packId = job.entityId;
  if (!packId) throw new Error("build_pack job missing entity_id (pack ID)");

  // Resubmission Window: clear `rebuild_pending` atomically with the
  // status flip. From this point the UI's "Regenerating" banner is
  // driven by `status === "building"` (and the rest of the in-flight
  // chain), not the flag. Together they give the merchant a continuous
  // "still regenerating" signal from request → pickup → save.
  await db
    .from("evidence_packs")
    .update({
      status: "building",
      rebuild_pending: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", packId);

  await logAuditEvent({
    shopId: job.shopId,
    packId,
    actorType: "system",
    eventType: "job_started",
    eventPayload: { jobId: job.id, jobType: "build_pack" },
  });

  try {
    const result = await buildPack(packId, {
      correlationId: job.id,
    });

    const buildSucceeded = result.status === "ready";

    await logAuditEvent({
      shopId: job.shopId,
      packId,
      actorType: "system",
      eventType: buildSucceeded ? "pack_created" : "job_failed",
      eventPayload: {
        jobId: job.id,
        completenessScore: result.completenessScore,
        blockers: result.blockers,
        sectionsCollected: result.sectionsCollected,
        itemsCreated: result.itemsCreated,
        ...(result.failureCode ? { failureCode: result.failureCode } : {}),
      },
    });

    // Emit merchant-facing dispute event. A system-level failure (e.g.,
    // order fetch failed) emits PACK_BUILD_FAILED so the timeline tells
    // the truth, instead of "Score 0%, 1 item collected" which reads as
    // a merchant evidence gap.
    const { data: packRow } = await db
      .from("evidence_packs")
      .select("dispute_id")
      .eq("id", packId)
      .single();
    if (packRow?.dispute_id) {
      if (buildSucceeded) {
        void emitDisputeEvent({
          disputeId: packRow.dispute_id,
          shopId: job.shopId,
          eventType: PACK_CREATED,
          description: `Score: ${result.completenessScore}%, ${result.itemsCreated} evidence items collected`,
          eventAt: new Date().toISOString(),
          actorType: "disputedesk_system",
          sourceType: "pack_engine",
          metadataJson: {
            pack_id: packId,
            completeness_score: result.completenessScore,
            items_created: result.itemsCreated,
            blockers: result.blockers,
          },
          dedupeKey: `${packRow.dispute_id}:${PACK_CREATED}:${packId}`,
        });
      } else {
        void emitDisputeEvent({
          disputeId: packRow.dispute_id,
          shopId: job.shopId,
          eventType: PACK_BUILD_FAILED,
          description:
            result.failureCode === "order_fetch_failed"
              ? "Couldn\u2019t load order data from Shopify"
              : "Pack build did not complete",
          eventAt: new Date().toISOString(),
          actorType: "disputedesk_system",
          // Internal failure \u2014 transparency copy on the detail page,
          // never feed alarm (design-alignment \u00a712V decision 4).
          visibility: "internal_only",
          sourceType: "pack_engine",
          metadataJson: {
            pack_id: packId,
            failure_code: result.failureCode,
          },
          dedupeKey: `${packRow.dispute_id}:${PACK_BUILD_FAILED}:${packId}`,
        });
      }
      void updateNormalizedStatus(packRow.dispute_id);
    }

    // On a failed build (non-throw — return result with status="failed"),
    // still fire the deferred new-dispute alert (review variant). The
    // dispatcher deferred this email at sync-time because the pipeline
    // enqueued a build; when the build resolves as failed, the merchant
    // STILL needs to know a dispute came in. Without this call the merchant
    // got total silence on order #1080. Mirror of the catch-block behavior
    // for thrown failures further below.
    if (!buildSucceeded && packRow?.dispute_id) {
      void claimAndSendDeferredNewDisputeAlert(
        packRow.dispute_id,
        "review",
      ).catch(() => {
        /* non-fatal */
      });
    }

    // Skip auto-save evaluation + manual-evidence email on a failed build:
    // there is no merchant-actionable evidence path to recommend until the
    // build is rerun successfully.
    if (buildSucceeded) {
      // Decrement the pack-credit ledger. Idempotent per
      // (shop_id, dispute_id, 'finalize') via the pack_usage_events
      // unique index, so handler retries and pack rebuilds for the
      // same dispute never double-charge. Quota is checked upstream
      // at enqueue time in POST /api/disputes/:id/packs — this is the
      // post-hoc ledger update for successful builds (failed builds
      // never consume credit).
      if (packRow?.dispute_id) {
        try {
          const consume = await consumePack({
            shopId: job.shopId,
            disputeId: packRow.dispute_id,
            packId,
            eventType: "finalize",
          });
          await logAuditEvent({
            shopId: job.shopId,
            packId,
            actorType: "system",
            eventType: "pack_credit_consumed",
            eventPayload: {
              jobId: job.id,
              consumed: consume.consumed,
              remaining: consume.remaining,
            },
          });
        } catch (consumeErr) {
          if (consumeErr instanceof PackLimitReachedError) {
            // Rare race: quota was passing at enqueue time but drained by
            // concurrent disputes finishing first. Flip the pack to failed
            // so the merchant sees a remediation path (upgrade / top-up).
            await db
              .from("evidence_packs")
              .update({
                status: "failed",
                updated_at: new Date().toISOString(),
              })
              .eq("id", packId);
            await logAuditEvent({
              shopId: job.shopId,
              packId,
              actorType: "system",
              eventType: "pack_limit_reached_at_consume",
              eventPayload: { jobId: job.id, remaining: consumeErr.remaining },
            });
            void emitDisputeEvent({
              disputeId: packRow.dispute_id,
              shopId: job.shopId,
              eventType: PACK_BUILD_FAILED,
              description: "Pack credit limit reached. Upgrade to continue.",
              eventAt: new Date().toISOString(),
              actorType: "disputedesk_system",
              sourceType: "pack_engine",
              // Billing halt reaches the merchant via the blocking
              // attention banner, not the activity feed.
              visibility: "internal_only",
              metadataJson: {
                pack_id: packId,
                failure_code: "pack_limit_reached",
              },
              dedupeKey: `${packRow.dispute_id}:${PACK_BUILD_FAILED}:${packId}:quota`,
            });
            return; // skip auto-save + manual-evidence email
          }
          // Unknown error — log + continue. Don't break the success
          // path on a billing-side fluke; ops can reconcile from audit.
          console.error("[buildPack] consumePack failed:", consumeErr);
        }
      }

      await evaluateAndMaybeAutoSave(packId).catch(() => {
        // Non-fatal: auto-save evaluation failure shouldn't fail the build
      });

      // Grounded Defence Package PDF Builder — non-fatal. Flag-gated inside
      // maybeEnqueueDefencePackage so the build path is byte-identical when
      // the feature is off.
      await maybeEnqueueDefencePackage(packId).catch((err) => {
        console.error("[buildPack] maybeEnqueueDefencePackage failed:", err);
      });

      await sendManualEvidenceAlert(db, job.shopId, packId).catch((err) => {
        console.error("[buildPack] Evidence alert failed:", err);
      });

      // Case-strength improvement (e.g. weak → moderate once delivery is
      // confirmed). Runs LAST so its rebuild-outcome stamp is the final
      // write to `last_rebuild_at`/`updated_at` on the pack — otherwise the
      // later evaluateAndMaybeAutoSave pack update bumps `updated_at` past
      // `last_rebuild_at` and the UI staleness gate suppresses the banner.
      // Stamps the banner outcome, records a timeline event, and emails the
      // merchant — all gated + deduped inside the helper.
      if (result.strengthImproved && packRow?.dispute_id) {
        await notifyCaseStrengthened(
          db,
          job.shopId,
          packId,
          packRow.dispute_id,
          result,
        ).catch((err) => console.error("[buildPack] notifyCaseStrengthened failed:", err));
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await db
      .from("evidence_packs")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", packId);

    await logAuditEvent({
      shopId: job.shopId,
      packId,
      actorType: "system",
      eventType: "job_failed",
      eventPayload: { jobId: job.id, error: message },
    });

    // Emit internal-only failure event
    const { data: failedPack } = await db
      .from("evidence_packs")
      .select("dispute_id")
      .eq("id", packId)
      .single();
    if (failedPack?.dispute_id) {
      void emitDisputeEvent({
        disputeId: failedPack.dispute_id,
        shopId: job.shopId,
        eventType: PACK_BUILD_FAILED,
        description: message,
        eventAt: new Date().toISOString(),
        actorType: "disputedesk_system",
        sourceType: "pack_engine",
        visibility: "internal_only",
        metadataJson: { pack_id: packId, error: message },
        dedupeKey: `${failedPack.dispute_id}:${PACK_BUILD_FAILED}:${packId}`,
      });
      // Sync-time send was deferred for every `pack_enqueued` outcome,
      // including this one. The build job is now throwing — the
      // pipeline's `evaluateAndMaybeAutoSave` may not run again before
      // the merchant's deadline. Send the review variant so the
      // merchant knows a new dispute came in even when the build path
      // failed at the system level. (`claimAndSendDeferredNewDisputeAlert`
      // is idempotent via the `new_dispute_alert_sent_at` claim.)
      void claimAndSendDeferredNewDisputeAlert(
        failedPack.dispute_id,
        "review",
      ).catch(() => {
        /* non-fatal */
      });
    }

    throw err;
  }
}

/**
 * Fire-and-forget: check if this dispute needs manual evidence and email the merchant.
 * Reads store profile, notification prefs, and dispute reason to decide.
 */
const STRENGTH_RANK: Record<StrengthLevel, number> = {
  insufficient: 0,
  weak: 1,
  moderate: 2,
  strong: 3,
};

/**
 * Notify the merchant that a rebuild raised the case strength.
 *   1. Stamp the `improved` rebuild outcome → in-app EvidenceTab banner.
 *   2. Emit a CASE_STRENGTHENED timeline event.
 *   3. Email the merchant — gated by the `disputeUpdates` notification
 *      preference and deduped on `disputes.strength_alert_level` so it
 *      fires only when the strength rises to a NEW high-water mark.
 * Never throws (fire-and-forget annotations + email); errors are logged.
 * Not called on first builds — `strengthImproved` requires a prior
 * strength, so a bulk historical import can never trigger it.
 */
async function notifyCaseStrengthened(
  db: ReturnType<typeof getServiceClient>,
  shopId: string,
  packId: string,
  disputeId: string,
  result: BuildResult,
): Promise<void> {
  const prior = result.priorStrength;
  const next = result.newStrength;
  if (!prior || !next) return;

  // 1. In-app banner outcome.
  await stampRebuildOutcome({
    packId,
    outcome: "improved",
    reason: `strength_${prior}_to_${next}`,
  }).catch((e) => console.warn("[buildPack] stamp improved failed:", e));

  // 2. Timeline event.
  void emitDisputeEvent({
    disputeId,
    shopId,
    eventType: CASE_STRENGTHENED,
    description: `Case strength improved from ${prior} to ${next}`,
    eventAt: new Date().toISOString(),
    actorType: "disputedesk_system",
    sourceType: "pack_engine",
    metadataJson: { pack_id: packId, prior_strength: prior, new_strength: next },
    dedupeKey: `${disputeId}:${CASE_STRENGTHENED}:${next}`,
  });

  // 3. Email — dedupe on the high-water mark, then gate on preference.
  try {
    const { data: dispute } = await db
      .from("disputes")
      .select("id, reason, amount, currency_code, strength_alert_level")
      .eq("id", disputeId)
      .single();
    if (!dispute) return;

    const alreadyNotified = (dispute.strength_alert_level as StrengthLevel | null) ?? null;
    if (alreadyNotified && STRENGTH_RANK[next] <= STRENGTH_RANK[alreadyNotified]) {
      return; // not a new high — don't re-email
    }

    const { data: setup } = await db
      .from("shop_setup")
      .select("steps")
      .eq("shop_id", shopId)
      .single();
    const teamPayload = (setup?.steps as Record<string, { payload?: Record<string, unknown> }>)?.team
      ?.payload;
    const notifications = teamPayload?.notifications as
      | { disputeUpdates?: boolean }
      | undefined;
    // Default on — a case getting stronger is high-signal, low-noise.
    if (notifications?.disputeUpdates === false) return;
    const to = teamPayload?.teamEmail as string | undefined;
    if (!to) return;

    const { data: shop } = await db
      .from("shops")
      .select("shop_domain")
      .eq("id", shopId)
      .single();

    const emailRes = await sendCaseStrengthenedAlert({
      to,
      shopName: shop?.shop_domain ?? undefined,
      shopDomain: shop?.shop_domain ?? null,
      disputeId,
      disputeReason: dispute.reason,
      disputeAmount: dispute.amount != null ? String(dispute.amount) : null,
      priorStrength: prior,
      newStrength: next,
    });

    if (emailRes.ok) {
      await db
        .from("disputes")
        .update({ strength_alert_level: next })
        .eq("id", disputeId);
    }
  } catch (e) {
    console.warn("[buildPack] case-strengthened email failed:", e);
  }
}

interface PackSection {
  type?: string;
  source?: string;
  fieldsProvided?: string[];
  data?: Record<string, unknown>;
}

/**
 * Derive what REAL evidence the pack actually holds — verified by content, not
 * by checklist field-presence. The checklist marks a field "available" the
 * instant any section emits it, which is why an empty Shopify order timeline
 * (or marketing-app buyer attributes) once made `customer_communication` read
 * as "present" and the email falsely claimed we'd attached support
 * conversations. Here we inspect the actual section payloads instead.
 *
 * - Real delivery proof ⇔ a fulfillment section whose `delivery_proof`
 *   categorizes as `moderate`/`strong` (proofType delivered_confirmed /
 *   signature_confirmed) — a bare `label_created` does NOT count.
 * - Real support comms ⇔ a Gorgias section with approved messages, OR a
 *   Shopify-timeline comms section with genuine human authorship (staff note /
 *   customer note / merchant comment). Buyer attributes and system timeline
 *   events do NOT count.
 */
function deriveRealEvidence(pack: { pack_json?: unknown }): {
  hasRealDeliveryProof: boolean;
  hasRealSupportComms: boolean;
} {
  const sections =
    (pack.pack_json as { sections?: PackSection[] } | null | undefined)
      ?.sections ?? [];

  let hasRealDeliveryProof = false;
  let hasRealSupportComms = false;

  for (const s of sections) {
    const data = (s?.data ?? {}) as Record<string, unknown>;
    const provides = s?.fieldsProvided ?? [];

    // Delivery proof — categorize the fulfillment section's payload.
    if (
      !hasRealDeliveryProof &&
      (provides.includes("delivery_proof") || provides.includes("shipping_tracking"))
    ) {
      const cat = categorizeEvidenceField("delivery_proof", data);
      if (cat === "moderate" || cat === "strong") hasRealDeliveryProof = true;
    }

    // Support comms — must be real human authorship, not an empty timeline.
    if (!hasRealSupportComms && s?.type === "comms") {
      const summary = (data.summary ?? {}) as Record<string, unknown>;
      if (s.source === "gorgias") {
        // Gorgias section is only emitted with approved, included messages.
        if (Number(summary.messageCount ?? 0) > 0) hasRealSupportComms = true;
      } else {
        // shopify_timeline — genuine authorship only. Explicitly ignore
        // buyerAttributeCount / timelineEventCount / confirmationEventCount.
        const real =
          Number(summary.merchantCommentCount ?? 0) > 0 ||
          summary.staffNotePresent === true ||
          summary.customerNotePresent === true;
        if (real) hasRealSupportComms = true;
      }
    }
  }

  return { hasRealDeliveryProof, hasRealSupportComms };
}

async function sendManualEvidenceAlert(
  db: ReturnType<typeof getServiceClient>,
  shopId: string,
  packId: string
): Promise<void> {
  // Load pack → dispute info. pack_json carries the collected sections we
  // inspect (by content) to decide what real evidence we hold.
  const { data: pack } = await db
    .from("evidence_packs")
    .select("id, dispute_id, shop_id, pack_json")
    .eq("id", packId)
    .single();
  if (!pack?.dispute_id) return;

  const { data: dispute } = await db
    .from("disputes")
    .select(
      "id, reason, amount, currency_code, evidence_alert_sent_at, order_name, needs_attention, attention_reason, attention_payload",
    )
    .eq("id", pack.dispute_id)
    .single();
  if (!dispute) return;

  // Skip if alert was already sent for this dispute (survives pack rebuilds)
  if (dispute.evidence_alert_sent_at) return;

  // Load store profile from shop_setup
  const { data: setup } = await db
    .from("shop_setup")
    .select("steps")
    .eq("shop_id", shopId)
    .single();

  const storeProfile = (setup?.steps as Record<string, { payload?: Record<string, unknown> }>)?.store_profile?.payload;
  const storeTypes = (storeProfile?.storeTypes as string[] | undefined) ?? [];

  // We always send the post-build touchpoint (subject to the notification
  // pref + dedupe below); the mailer decides ask-mode vs review-mode from the
  // REAL evidence state, so we never go silent.
  if (!shouldSendEvidenceAlert(dispute.reason, undefined, storeTypes)) {
    return;
  }

  // What DisputeDesk ACTUALLY has for this pack — verified by section content,
  // not by checklist field-presence. Drives both ask-suppression and the
  // truthful "already attached" block (never claim evidence we don't hold).
  const { hasRealDeliveryProof, hasRealSupportComms } = deriveRealEvidence(pack);

  // Matched-but-pending Gorgias comms: enrichment sets attention_reason =
  // 'gorgias_evidence_ready' with a proposal_count when it finds support
  // conversations awaiting the merchant's approve/reject decision. Those are
  // NOT in the pack yet (so customer_communication isn't a present field), so
  // instead of asking the merchant to upload conversations from scratch we ask
  // them to review the ones we already matched. This flag races with the
  // enrichment job; when it isn't set yet, enrichment's own
  // sendGorgiasEvidenceReadyAlert covers the case — no double-ask either way.
  const pendingSupportReview =
    dispute.needs_attention === true &&
    dispute.attention_reason ===
      DISPUTE_ATTENTION_REASONS.GORGIAS_EVIDENCE_READY;
  const pendingSupportCount = pendingSupportReview
    ? Number(
        (dispute.attention_payload as { proposal_count?: number } | null)
          ?.proposal_count ?? 0,
      )
    : 0;

  // Check notification preference
  const teamPayload = (setup?.steps as Record<string, { payload?: Record<string, unknown> }>)?.team?.payload;
  const notifications = teamPayload?.notifications as { evidenceReady?: boolean } | undefined;
  // Default to true if preference not set (evidence alerts are important)
  if (notifications?.evidenceReady === false) return;

  // Get team email
  const teamEmail = teamPayload?.teamEmail as string | undefined;
  // Shop row — needed for shop_domain to build the Admin deep link. The
  // `contact_email` column does NOT exist on `shops`; loading it silently
  // nulled the entire row and made the email link fall back to
  // https://disputedesk.app/... instead of the Shopify Admin URL.
  const { data: shop } = await db
    .from("shops")
    .select("shop_domain")
    .eq("id", shopId)
    .single();

  const to = teamEmail;
  if (!to) return;

  const amount = dispute.amount != null ? String(dispute.amount) : null;

  const result = await sendEvidenceNeededAlert({
    to,
    shopName: shop?.shop_domain ?? undefined,
    shopDomain: shop?.shop_domain ?? null,
    disputeId: dispute.id,
    disputeReason: dispute.reason,
    disputeAmount: amount,
    packId,
    storeTypes,
    hasRealDeliveryProof,
    hasRealSupportComms,
    pendingSupportReview,
    pendingSupportCount,
    orderName: dispute.order_name ?? null,
  });

  // Stamp on the dispute so subsequent pack rebuilds won't re-send
  if (result.ok) {
    await db
      .from("disputes")
      .update({ evidence_alert_sent_at: new Date().toISOString() })
      .eq("id", dispute.id);
  }
}
