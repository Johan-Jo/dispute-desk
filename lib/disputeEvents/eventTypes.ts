/**
 * Canonical event type constants for the dispute_events ledger.
 * UI localizes from `disputeTimeline.eventTypes.{EVENT_TYPE}`.
 */

// Lifecycle
export const DISPUTE_OPENED = "dispute_opened";
export const STATUS_CHANGED = "status_changed";
export const DUE_DATE_CHANGED = "due_date_changed";
export const DISPUTE_CLOSED = "dispute_closed";

// Evidence pack
export const PACK_CREATED = "pack_created";
export const PACK_READY = "pack_ready";
export const PACK_BLOCKED = "pack_blocked";
export const PDF_RENDERED = "pdf_rendered";
export const EVIDENCE_SAVED_TO_SHOPIFY = "evidence_saved_to_shopify";

// Submission
export const SUBMISSION_CONFIRMED = "submission_confirmed";

// Automation
export const AUTO_BUILD_TRIGGERED = "auto_build_triggered";
export const AUTO_SAVE_TRIGGERED = "auto_save_triggered";
export const PARKED_FOR_REVIEW = "parked_for_review";

// Merchant actions
export const MERCHANT_APPROVED_FOR_SAVE = "merchant_approved_for_save";

// Outcome
export const OUTCOME_DETECTED = "outcome_detected";

// Internal-only
export const SYNC_FAILED = "sync_failed";
export const PACK_BUILD_FAILED = "pack_build_failed";
export const EVIDENCE_SAVE_FAILED = "evidence_save_failed";
