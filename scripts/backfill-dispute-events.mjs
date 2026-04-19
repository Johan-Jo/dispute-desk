/**
 * Backfill dispute_events for existing disputes.
 *
 * Conservative rules:
 * - dispute_opened at initiated_at for every dispute
 * - pack_created at pack created_at (if packs exist)
 * - evidence_saved_to_shopify at pack saved_to_shopify_at (if set)
 * - submitted_at only from raw_snapshot.evidenceSentOn (confirmed signal)
 * - submission_state = submission_uncertain if evidence saved but no evidenceSentOn
 * - outcome_detected for terminal statuses (won/lost/charge_refunded/accepted)
 * - All events marked actor_ref: 'backfill'
 * - Idempotent via dedupe_key (ON CONFLICT DO NOTHING)
 *
 * Usage: node scripts/backfill-dispute-events.mjs
 * Requires: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = createClient(supabaseUrl, serviceKey);

const BATCH_SIZE = 100;
const TERMINAL_STATUSES = ["won", "lost", "charge_refunded", "accepted"];
const OUTCOME_MAP = { won: "won", lost: "lost", charge_refunded: "refunded", accepted: "accepted" };

async function insertEvent(event) {
  const { error } = await sb.from("dispute_events").insert(event);
  // 23505 = unique violation on dedupe_key — expected for idempotency
  if (error && error.code !== "23505") {
    console.warn(`  [warn] insert failed for ${event.event_type}: ${error.message}`);
  }
}

async function backfillDispute(dispute) {
  const disputeId = dispute.id;
  const shopId = dispute.shop_id;
  const snapshot = dispute.raw_snapshot || {};
  const now = new Date().toISOString();

  // 1. dispute_opened
  await insertEvent({
    dispute_id: disputeId,
    shop_id: shopId,
    event_type: "dispute_opened",
    description: `${snapshot.type || "Dispute"} opened — ${dispute.reason || "unknown reason"}`,
    event_at: dispute.initiated_at || dispute.created_at || now,
    actor_type: "shopify",
    actor_ref: "backfill",
    source_type: "system",
    visibility: "merchant_and_internal",
    metadata_json: {
      reason: dispute.reason,
      phase: dispute.phase,
      amount: dispute.amount,
      currency_code: dispute.currency_code,
    },
    dedupe_key: `${disputeId}:dispute_opened`,
  });

  // 2. Pack events
  const { data: packs } = await sb
    .from("packs")
    .select("id, status, created_at, saved_to_shopify_at")
    .eq("dispute_id", disputeId)
    .neq("status", "ARCHIVED")
    .order("created_at", { ascending: true });

  for (const pack of packs || []) {
    // pack_created
    await insertEvent({
      dispute_id: disputeId,
      shop_id: shopId,
      event_type: "pack_created",
      event_at: pack.created_at || now,
      actor_type: "disputedesk_system",
      actor_ref: "backfill",
      source_type: "pack_engine",
      visibility: "merchant_and_internal",
      metadata_json: { pack_id: pack.id },
      dedupe_key: `${disputeId}:pack_created:${pack.id}`,
    });

    // evidence_saved_to_shopify
    if (pack.saved_to_shopify_at) {
      await insertEvent({
        dispute_id: disputeId,
        shop_id: shopId,
        event_type: "evidence_saved_to_shopify",
        event_at: pack.saved_to_shopify_at,
        actor_type: "disputedesk_system",
        actor_ref: "backfill",
        source_type: "pack_engine",
        visibility: "merchant_and_internal",
        metadata_json: { pack_id: pack.id },
        dedupe_key: `${disputeId}:evidence_saved:${pack.id}`,
      });
    }
  }

  // 3. Submission state + submitted_at
  const evidenceSavedAt = (packs || []).find((p) => p.saved_to_shopify_at)?.saved_to_shopify_at;
  const evidenceSentOn = snapshot.evidenceSentOn || null;
  const updateFields = {};

  if (evidenceSentOn) {
    // Confirmed submission from Shopify
    updateFields.submission_state = "submitted_confirmed";
    updateFields.submitted_at = evidenceSentOn;
    updateFields.evidence_saved_to_shopify_at = evidenceSavedAt || evidenceSentOn;

    await insertEvent({
      dispute_id: disputeId,
      shop_id: shopId,
      event_type: "submission_confirmed",
      description: "Representment submission confirmed by Shopify",
      event_at: evidenceSentOn,
      actor_type: "shopify",
      actor_ref: "backfill",
      source_type: "shopify_sync",
      visibility: "merchant_and_internal",
      dedupe_key: `${disputeId}:submission_confirmed:${evidenceSentOn}`,
    });
  } else if (evidenceSavedAt) {
    // Evidence saved but no confirmed submission
    updateFields.submission_state = "submission_uncertain";
    updateFields.evidence_saved_to_shopify_at = evidenceSavedAt;
    // Do NOT set submitted_at
  }

  // 4. Terminal outcome
  const status = dispute.status;
  if (TERMINAL_STATUSES.includes(status)) {
    const finalOutcome = OUTCOME_MAP[status] || "unknown";
    const closedAt = snapshot.finalizedOn || dispute.updated_at || now;

    updateFields.final_outcome = finalOutcome;
    updateFields.closed_at = closedAt;
    updateFields.outcome_source = "shopify_sync";
    updateFields.outcome_confidence = "high";

    if (finalOutcome === "won") {
      updateFields.outcome_amount_recovered = dispute.amount || 0;
      updateFields.outcome_amount_lost = 0;
    } else {
      updateFields.outcome_amount_recovered = 0;
      updateFields.outcome_amount_lost = dispute.amount || 0;
    }

    await insertEvent({
      dispute_id: disputeId,
      shop_id: shopId,
      event_type: "outcome_detected",
      description: `Outcome: ${finalOutcome}`,
      event_at: closedAt,
      actor_type: "shopify",
      actor_ref: "backfill",
      source_type: "shopify_sync",
      metadata_json: { final_outcome: finalOutcome, amount: dispute.amount },
      dedupe_key: `${disputeId}:outcome:${finalOutcome}`,
    });

    await insertEvent({
      dispute_id: disputeId,
      shop_id: shopId,
      event_type: "dispute_closed",
      event_at: closedAt,
      actor_type: "shopify",
      actor_ref: "backfill",
      source_type: "shopify_sync",
      dedupe_key: `${disputeId}:dispute_closed`,
    });
  }

  // 5. Derive normalized status
  const latestPack = (packs || []).at(-1);
  const packStatus = latestPack?.status?.toLowerCase() || null;
  const subState = updateFields.submission_state || (evidenceSavedAt ? "saved_to_shopify" : "not_saved");

  let normalizedStatus = "new";
  let statusReason = "";
  let nextActionType = null;
  let nextActionText = null;
  let needsAttention = false;

  if (status === "won") { normalizedStatus = "won"; statusReason = "Dispute won"; }
  else if (status === "lost") { normalizedStatus = "lost"; statusReason = "Dispute lost"; }
  else if (status === "charge_refunded") { normalizedStatus = "closed_other"; statusReason = "Charge refunded"; }
  else if (status === "accepted") { normalizedStatus = "accepted_not_contested"; statusReason = "Dispute accepted"; }
  else if (status === "under_review") { normalizedStatus = "submitted_to_bank"; statusReason = "Submitted to bank"; }
  else if (subState === "submitted_confirmed") { normalizedStatus = "submitted"; statusReason = "Submitted"; }
  else if (subState === "saved_to_shopify") {
    normalizedStatus = "submitted_to_shopify"; statusReason = "Submitted to Shopify";
    nextActionType = "submit_in_shopify"; nextActionText = "Optional: submit in Shopify Admin before the deadline";
  } else if (subState === "submission_uncertain") {
    normalizedStatus = "action_needed"; statusReason = "Submission not confirmed"; needsAttention = true;
    nextActionType = "verify_submission"; nextActionText = "Verify that the representment was submitted in Shopify Admin";
  } else if (packStatus === "blocked") {
    normalizedStatus = "action_needed"; statusReason = "Pack blocked"; needsAttention = true;
  } else if (packStatus === "ready") {
    normalizedStatus = "ready_to_submit"; statusReason = "Evidence ready"; needsAttention = true;
  } else if (packStatus === "building" || packStatus === "queued") {
    normalizedStatus = "in_progress"; statusReason = "Building evidence";
  } else if (dispute.needs_review) {
    normalizedStatus = "needs_review"; statusReason = "Review required"; needsAttention = true;
  } else if (latestPack) {
    normalizedStatus = "in_progress"; statusReason = "Pack exists";
  } else {
    normalizedStatus = "new"; statusReason = "No evidence pack yet"; needsAttention = true;
  }

  updateFields.normalized_status = normalizedStatus;
  updateFields.status_reason = statusReason;
  updateFields.next_action_type = nextActionType;
  updateFields.next_action_text = nextActionText;
  updateFields.needs_attention = needsAttention;
  if (!updateFields.submission_state) {
    updateFields.submission_state = evidenceSavedAt ? "saved_to_shopify" : "not_saved";
  }
  if (!updateFields.evidence_saved_to_shopify_at && evidenceSavedAt) {
    updateFields.evidence_saved_to_shopify_at = evidenceSavedAt;
  }

  // Write snapshot
  const { error } = await sb
    .from("disputes")
    .update(updateFields)
    .eq("id", disputeId);

  if (error) {
    console.warn(`  [warn] snapshot update failed for ${disputeId}: ${error.message}`);
  }
}

async function main() {
  console.log("Starting dispute events backfill...\n");

  let offset = 0;
  let total = 0;

  while (true) {
    const { data: disputes, error } = await sb
      .from("disputes")
      .select("id, shop_id, status, reason, phase, amount, currency_code, initiated_at, created_at, updated_at, needs_review, raw_snapshot")
      .order("created_at", { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error("Query error:", error.message);
      break;
    }
    if (!disputes || disputes.length === 0) break;

    for (const dispute of disputes) {
      process.stdout.write(`  Backfilling ${dispute.id}...`);
      await backfillDispute(dispute);
      process.stdout.write(" done\n");
      total++;
    }

    offset += disputes.length;
    console.log(`  Batch complete. ${total} disputes processed so far.\n`);

    if (disputes.length < BATCH_SIZE) break;
  }

  console.log(`\nBackfill complete. ${total} disputes processed.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
