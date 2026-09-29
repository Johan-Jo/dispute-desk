/**
 * Canonical event type constants for the dispute_events ledger.
 * UI localizes from `disputeTimeline.eventTypes.{EVENT_TYPE}`.
 */

// Lifecycle
export const DISPUTE_OPENED = "dispute_opened";
export const STATUS_CHANGED = "status_changed";
export const DUE_DATE_CHANGED = "due_date_changed";
export const DISPUTE_CLOSED = "dispute_closed";
/** Shopify asked for a new response after one was given (reopen, or an
 *  answered inquiry escalated to a chargeback). Opens a new response cycle. */
export const RESPONSE_CYCLE_REOPENED = "response_cycle_reopened";
/** Shopify moved the dispute from inquiry to chargeback. Once per dispute. */
export const ESCALATED_TO_CHARGEBACK = "escalated_to_chargeback";
/** Shopify reopened a decided dispute (won/lost/… → needs_response or
 *  under_review). The outcome is cleared; the previous one is kept. */
export const DISPUTE_REOPENED_AFTER_CLOSE = "dispute_reopened_after_close";

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
/** A rebuild raised the case strength (e.g. weak → moderate after new
 *  delivery evidence). Drives the merchant "your case got stronger"
 *  notification + timeline entry. */
export const CASE_STRENGTHENED = "case_strengthened";

// Merchant actions
export const MERCHANT_APPROVED_FOR_SAVE = "merchant_approved_for_save";

// Outcome
export const OUTCOME_DETECTED = "outcome_detected";

// Admin/support
export const SUPPORT_NOTE_ADDED = "support_note_added";
export const ADMIN_OVERRIDE = "admin_override";
export const ADMIN_OVERRIDE_CLEARED = "admin_override_cleared";
export const DISPUTE_RESYNCED = "dispute_resynced";

// Internal-only
export const SYNC_FAILED = "sync_failed";
export const PACK_BUILD_FAILED = "pack_build_failed";
export const EVIDENCE_SAVE_FAILED = "evidence_save_failed";
