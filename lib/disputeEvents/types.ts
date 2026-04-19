/** Actor who triggered the event. */
export type ActorType =
  | "merchant_user"
  | "disputedesk_system"
  | "disputedesk_admin"
  | "shopify"
  | "external_unknown";

/** How the event was generated. */
export type SourceType =
  | "system"
  | "user_action"
  | "pack_engine"
  | "shopify_sync"
  | "admin_override"
  | "webhook"
  | "manual_entry";

/** Who can see this event. */
export type EventVisibility = "merchant_and_internal" | "internal_only";

/** Input for emitting a dispute event. */
export interface DisputeEventInput {
  disputeId: string;
  shopId: string;
  eventType: string;
  description?: string;
  eventAt: string; // ISO timestamp
  actorType: ActorType;
  actorRef?: string;
  sourceType: SourceType;
  visibility?: EventVisibility;
  metadataJson?: Record<string, unknown>;
  dedupeKey: string;
}

/** A dispute event as returned from the DB / API. */
export interface DisputeEvent {
  id: string;
  dispute_id: string;
  shop_id: string;
  event_type: string;
  description: string | null;
  event_at: string;
  actor_type: ActorType;
  actor_ref: string | null;
  source_type: SourceType;
  visibility: EventVisibility;
  metadata_json: Record<string, unknown>;
  dedupe_key: string | null;
  created_at: string;
}

/** Normalized status values. */
export type NormalizedStatus =
  | "new"
  | "in_progress"
  | "needs_review"
  | "ready_to_submit"
  | "action_needed"
  | "submitted"
  | "submitted_to_shopify"
  | "waiting_on_issuer"
  | "submitted_to_bank"
  | "won"
  | "lost"
  | "accepted_not_contested"
  | "closed_other";

/** Submission state values. */
export type SubmissionState =
  | "not_saved"
  | "saved_to_shopify"
  | "submitted_confirmed"
  | "submission_uncertain"
  | "manual_submission_reported";

/** Final outcome values. */
export type FinalOutcome =
  | "won"
  | "lost"
  | "partially_won"
  | "accepted"
  | "refunded"
  | "canceled"
  | "expired"
  | "closed_other"
  | "unknown";

/** Result of deriving normalized status. */
export interface NormalizedStatusResult {
  normalizedStatus: NormalizedStatus;
  statusReason: string;
  nextActionType: string | null;
  nextActionText: string | null;
  needsAttention: boolean;
}

/** Result of deriving final outcome. */
export interface OutcomeResult {
  finalOutcome: FinalOutcome;
  outcomeAmountRecovered: number;
  outcomeAmountLost: number;
  outcomeSource: string;
  outcomeConfidence: string;
}
