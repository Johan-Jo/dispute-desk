/**
 * Operational-lifecycle resolver — objective facts ONLY.
 *
 * MUST NOT read: coverage, fatal-loss rules, evidence strength, hero
 * variant, merchant attention, communication availability, or the
 * involvement preference (plan §3.1). It reads the objective fact of an
 * interrupted/failed build (to avoid a false "Monitoring"), never the
 * merchant-facing `technical_error` attention value.
 *
 * Data semantics verified in plan §12V:
 * - Terminal signal = `closed_at IS NOT NULL` (independent of
 *   `final_outcome`, which can lag/permanently miss on the async ingest
 *   path — applyDisputeSnapshot.ts:444/488, 558/647).
 * - `transmissionConfirmed` = `submission_state='submitted_confirmed'`
 *   (backed by Shopify `evidenceSentOn`) OR
 *   `normalized_status='submitted_to_bank'` (Shopify status
 *   `under_review` — normalizeStatus.ts:40-48) UNLESS `submission_state`
 *   positively says `not_saved`. The second clause is an inference from a
 *   Shopify status that means "open" for an inquiry; our own save record
 *   outranks it. See `isTransmissionConfirmed` (2026-09-03).
 * - Saved authority = `submission_state` whenever it holds a recognized
 *   value; a qualifying PresentationStatus is a fallback ONLY when
 *   `submission_state` is missing/unrecognized; `pack.savedToShopifyAt`
 *   is display-only and never consulted here.
 * - `pack_prepared` is a VERIFIED state: `evidence_packs.status='ready'`
 *   (buildPack.ts:640 writes only ready|failed; the save lifecycle is
 *   written later). `save_failed` implies a previously-ready pack, so it
 *   also proves "prepared, unsaved".
 * - `manual_submission_reported` is never written by any code path
 *   (dead enum value) — handled defensively as NOT transmission-
 *   confirmed and NOT saved (falls through to pack facts).
 */

import type { OperationalLifecycle } from "./types";

/** Recognized `disputes.submission_state` values
 *  (migration 20260413100000:66-68). */
const RECOGNIZED_SUBMISSION_STATES = new Set([
  "not_saved",
  "saved_to_shopify",
  "submitted_confirmed",
  "submission_uncertain",
  "manual_submission_reported",
]);

/** Pack statuses that mean a build is in progress. */
const PACK_BUILDING = new Set(["queued", "building", "saving"]);

/** Pack statuses that prove a completed-but-not-saved package exists.
 *  `ready` is the canonical verified state; `save_failed` can only be
 *  reached from `ready` (the save path), so the prepared fact stands. */
const PACK_PREPARED = new Set(["ready", "save_failed"]);

/** Pack statuses under which monitoring is genuinely occurring at rung 6
 *  (a completed package exists and the pipeline is not failed/halted).
 *  Everything else (null, failed, archived, unknown) falls back to
 *  building_evidence — the factually defensible default (§3.1 rung 6). */
const PACK_MONITORABLE = new Set([
  "saved_to_shopify",
  "saved_to_shopify_unverified",
  "saved_to_shopify_verified",
]);

export interface LifecycleInput {
  /** `disputes.final_outcome` (may be null even when terminal). */
  finalOutcome: string | null;
  /** `disputes.closed_at` — the reliable terminal signal. */
  closedAt: string | null;
  /** `disputes.submission_state` — authoritative for saved/sent. */
  submissionState: string | null;
  /** `disputes.normalized_status` — supplies the external
   *  `submitted_to_bank` review signal. */
  normalizedStatus: string | null;
  /** Latest evidence pack `status`, or null when no pack exists. */
  packStatus: string | null;
  /** Fallback ONLY when submissionState is missing/unrecognized:
   *  a qualifying PresentationStatus saved signal. */
  presentationSavedFallback?: boolean;
}

/** `submission_state` values that positively contradict "we sent something".
 *  `not_saved` is the only one that is an assertion rather than an absence:
 *  the save path writes it, so it means "no evidence has been saved", not
 *  "unknown". */
const CONTRADICTS_TRANSMISSION = new Set(["not_saved"]);

export function isTransmissionConfirmed(input: {
  submissionState: string | null;
  normalizedStatus: string | null;
}): boolean {
  // Our own save state is the direct observation and outranks the inference.
  if (input.submissionState === "submitted_confirmed") return true;

  /* `normalized_status = 'submitted_to_bank'` is an INFERENCE, not an
   * observation. It comes from Shopify status `under_review`
   * (normalizeStatus.ts:40), whose comment reads "Shopify has forwarded the
   * representment to the card network" — true for a chargeback, and simply
   * wrong for an INQUIRY, where `under_review` is the ordinary open state
   * from the moment it is created.
   *
   * Believing the inference over our own records told 38 open prod disputes
   * (27 inquiries, 29 with a live deadline) "The response has been sent and
   * can no longer be changed" while `submission_state = 'not_saved'`,
   * `submitted_at` and `evidence_saved_to_shopify_at` were all NULL — nothing
   * had been sent. Worse, `resolveAttention` suppresses ALL merchant
   * attention on this predicate, so the real blocker (#99413:
   * `auto_build_off` — no pack would ever be built) was hidden behind "No
   * action required" while the deadline ran (2026-09-03).
   *
   * So the inference stands only when our own records do not contradict it.
   * An absent/unrecognized `submission_state` is NOT a contradiction and
   * still defers to Shopify — this narrows the claim to the case where we
   * positively know better. */
  if (input.normalizedStatus === "submitted_to_bank") {
    return !(
      input.submissionState != null &&
      CONTRADICTS_TRANSMISSION.has(input.submissionState)
    );
  }
  return false;
}

export function resolveLifecycle(input: LifecycleInput): OperationalLifecycle {
  // Rung 1 — terminal. Won/Lost only with a supported final outcome;
  // any other reliably terminal case (incl. terminal-without-outcome)
  // resolves to neutral `closed` so it can never vanish from every
  // bucket (plan §3.1 rung 1 / §4).
  if (input.finalOutcome === "won") return "won";
  if (input.finalOutcome === "lost") return "lost";
  if (input.finalOutcome != null || input.closedAt != null) return "closed";

  // Rung 2 — confirmed external transmission → current state is
  // under_review ("Sent to card network" is a milestone, not a state).
  if (isTransmissionConfirmed(input)) return "under_review";

  // Rung 3 — saved to Shopify. `submission_state` is authoritative
  // whenever recognized; PresentationStatus may only fill a genuine
  // gap and can never override an explicit `not_saved`.
  const state = input.submissionState;
  const recognized = state != null && RECOGNIZED_SUBMISSION_STATES.has(state);
  if (recognized) {
    if (state === "saved_to_shopify") return "saved_to_shopify";
    // not_saved / submission_uncertain / manual_submission_reported:
    // fall through to pack facts below — none of these proves a save.
  } else if (input.presentationSavedFallback) {
    return "saved_to_shopify";
  }

  // Rung 4 — verified completed-but-not-saved package.
  if (input.packStatus != null && PACK_PREPARED.has(input.packStatus)) {
    return "pack_prepared";
  }

  // Rung 5 — build in progress.
  if (input.packStatus != null && PACK_BUILDING.has(input.packStatus)) {
    return "building_evidence";
  }

  // Rung 6 — monitoring ONLY when genuinely monitoring (a completed
  // package exists and the pipeline is not failed/halted). A failed or
  // absent build resolves to building_evidence — never a false
  // "Monitoring".
  if (input.packStatus != null && PACK_MONITORABLE.has(input.packStatus)) {
    return "monitoring";
  }
  return "building_evidence";
}
