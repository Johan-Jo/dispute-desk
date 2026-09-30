/**
 * Escalation and reopen flags (plan D2/D3,
 * docs/plans/mein-maison-status-and-no-return.plan.md). Presentation facts,
 * not attention: they say what happened to the dispute; the action ladder
 * (resolveAttention) is unchanged.
 *
 * One module so the list chip, the detail banner and the email agree.
 */

import { isReopenedOpenDispute } from "./reopenAfterClose";
import { hasRealDeadline } from "./responseCycle";

export interface EscalationInput {
  status?: string | null;
  phase?: string | null;
  due_at?: string | null;
  final_outcome?: string | null;
  closed_at?: string | null;
  response_cycle?: number | null;
  reopened_at?: string | null;
  reopened_after_close_at?: string | null;
  escalated_from_inquiry_at?: string | null;
}

/** The inquiry was escalated to a chargeback (recorded once per dispute). */
export function isEscalatedFromInquiry(d: EscalationInput): boolean {
  return d.escalated_from_inquiry_at != null && d.phase !== "inquiry";
}

/**
 * Show the "Reopened" pill. An escalation that opened cycle 2 is shown as
 * the escalation, not as a reopen too; a later reopen (cycle ≥ 3) or a
 * reopen after a decision still shows it.
 */
export function showReopenedPill(d: EscalationInput): boolean {
  if (!isReopenedOpenDispute(d)) return false;
  if (!isEscalatedFromInquiry(d)) return true;
  return (d.response_cycle ?? 1) >= 3 || d.reopened_after_close_at != null;
}

/** Only open disputes carry a banner; a decided page tells its own story. */
function isOpen(d: EscalationInput): boolean {
  return d.final_outcome == null && d.closed_at == null;
}

function asksForResponse(d: EscalationInput): boolean {
  return d.status === "needs_response" && hasRealDeadline(d.due_at);
}

export type BannerLine =
  | { key: "escalatedOn"; date: string }
  | { key: "responseDue"; date: string }
  | { key: "inquiryResponseDoesNotCarry" }
  | { key: "reopenedOn"; date: string };

/**
 * Sentences of the detail-page banner, each shown only when its data
 * establishes it (plan D2, review 2 point 5):
 *   - escalation: always "escalated on {date}";
 *   - "A response is due by {deadline}" only while Shopify asks for one;
 *   - "The response sent for the inquiry does not carry over" only when the
 *     escalation opened a new response cycle (an answered inquiry).
 * A reopen that is not an escalation gets "reopened on {date}" plus the due
 * line.
 */
export function escalationBanner(d: EscalationInput): {
  kind: "escalated" | "reopened";
  lines: BannerLine[];
} | null {
  if (!isOpen(d)) return null;
  if (isEscalatedFromInquiry(d)) {
    const lines: BannerLine[] = [{ key: "escalatedOn", date: d.escalated_from_inquiry_at! }];
    if (asksForResponse(d)) lines.push({ key: "responseDue", date: d.due_at! });
    if ((d.response_cycle ?? 1) >= 2 && asksForResponse(d)) {
      lines.push({ key: "inquiryResponseDoesNotCarry" });
    }
    return { kind: "escalated", lines };
  }
  if (d.reopened_at && asksForResponse(d)) {
    return {
      kind: "reopened",
      lines: [
        { key: "reopenedOn", date: d.reopened_at },
        { key: "responseDue", date: d.due_at! },
      ],
    };
  }
  return null;
}
