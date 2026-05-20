/**
 * Deterministic event keys for Layer B effect idempotency.
 *
 * The dispatcher (`dispatchDisputeEffects`) treats audit_events.dispute_event_key
 * as a claim token: it inserts the audit row first; on unique-violation it
 * skips the effect because another observer (cron vs webhook) already fired
 * it. Keys MUST be deterministic across both paths.
 *
 * The applyDisputeSnapshot diff engine pre-computes one event key per
 * emitted DisputeTransitionEvent so this module is mostly an alias for
 * `event.eventKey`. It exists separately so consumers (effects added in
 * future phases) can build keys for new effect kinds without re-implementing
 * the schema.
 */

import type {
  DisputeTransitionEvent,
  DisputeTransitionEventType,
} from "./applyDisputeSnapshot";

export interface EffectKeyArgs {
  disputeId: string;
  type: DisputeTransitionEventType | string;
  /** Optional sub-key qualifiers (status pair, outcome, evidenceSentOn). */
  qualifiers?: Array<string | number | null | undefined>;
}

export function buildDisputeEventKey(args: EffectKeyArgs): string {
  const qualifiers = (args.qualifiers ?? [])
    .filter((q) => q !== undefined && q !== null && q !== "")
    .map((q) => String(q));
  return [args.disputeId, args.type, ...qualifiers].join(":");
}

/**
 * Convenience: return the canonical event key for a transition event emitted
 * by applyDisputeSnapshot. Trusts the engine's pre-computed `eventKey`.
 */
export function keyForTransition(event: DisputeTransitionEvent): string {
  return event.eventKey;
}

/**
 * Build a key for an effect that is attached to a transition event but isn't
 * a 1:1 with the transition itself (e.g. an email send that uses the
 * transition as its anchor).
 *
 * Adding a new effect kind? Pass a stable, code-grep-able `effectName` —
 * `"send_new_dispute_alert"`, `"enqueue_build_pack"`, etc. Never derive the
 * name from runtime values.
 */
export function keyForEffect(
  event: DisputeTransitionEvent,
  effectName: string,
): string {
  return `${event.eventKey}:effect:${effectName}`;
}
