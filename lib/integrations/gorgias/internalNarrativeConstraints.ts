/**
 * Derives `InternalNarrativeConstraints` from stored helpdesk messages.
 *
 * Read BESIDE the pack, never into it. `gorgiasCommSource` builds the bank-
 * facing section from approved/manual messages and hard-blocks refund and
 * cancellation history, correctly. This reads the same tables with a different
 * question: did the customer ask for money back at all? The answer goes only
 * to the validators (lib/defence/internalConstraints.ts), as ids and a date.
 *
 * What counts, and why each filter is there:
 *   - ticket `match_status = confirmed_match`, or `proposed_match` at
 *     `confidence = high`: the order-match check. A low- or medium-confidence
 *     guess must not constrain a letter about a different order.
 *     `rejected_match` never counts.
 *   - `sender_type = customer`: a merchant offering a refund is not the
 *     customer requesting one.
 *   - ANY `review_status`: the merchant's review decides what the bank may
 *     see, not whether the customer asked. Case A's request (blume-box
 *     #360980, message cf7b6536) is `proposed` and classified `contradiction`.
 *   - the test is on the stored text itself (plus the analyzer's
 *     `refund_history` category when present), so it does not depend on the
 *     later communications reclassification (non-receipt plan P2).
 *
 * Over-triggering is cheap by design: the only consequence of a constraint is
 * that the validator refuses a sentence DENYING a refund request.
 */

import { getServiceClient } from "@/lib/supabase/server";
import {
  NO_INTERNAL_CONSTRAINTS,
  type InternalNarrativeConstraints,
} from "@/lib/defence/internalConstraints";

export interface StoredMessageForConstraints {
  id: string;
  senderType: string;
  sentAt: string | null;
  messageText: string | null;
  evidenceCategory: string | null;
  ticketMatchStatus: string | null;
  ticketConfidence: string | null;
}

/** Requests for money back in the six active locales (en/de/es/fr/pt/sv). */
const REFUND_REQUEST_TEXT: readonly RegExp[] = [
  /\b(?:refund|reimburs|money\s+back|compensat)/i,
  /(?:rückerstatt|erstatt|geld\s+zurück|entschädig)/i,
  /(?:reembols|devolu[cç][ãaió]o?n?\s+(?:del?\s+)?dinero|devolver\s+(?:el\s+|o\s+)?dinero|compensa)/i,
  /(?:rembours|dédommag|indemnis)/i,
  /(?:återbetal|pengarna\s+tillbaka|ersättning)/i,
];

function isOrderMatched(m: StoredMessageForConstraints): boolean {
  if (m.ticketMatchStatus === "confirmed_match") return true;
  return m.ticketMatchStatus === "proposed_match" && m.ticketConfidence === "high";
}

function asksForMoneyBack(m: StoredMessageForConstraints): boolean {
  if (m.evidenceCategory === "refund_history") return true;
  const text = m.messageText ?? "";
  return REFUND_REQUEST_TEXT.some((re) => re.test(text));
}

/** Pure. Exported for tests. */
export function deriveInternalNarrativeConstraints(
  messages: readonly StoredMessageForConstraints[],
): InternalNarrativeConstraints {
  const requests = messages.filter(
    (m) => m.senderType === "customer" && isOrderMatched(m) && asksForMoneyBack(m),
  );
  if (requests.length === 0) return NO_INTERNAL_CONSTRAINTS;
  const dates = requests
    .map((m) => m.sentAt)
    .filter((d): d is string => typeof d === "string")
    .sort();
  return {
    refundOrCompensationRequested: {
      messageIds: requests.map((m) => m.id).sort(),
      firstSentAt: dates[0] ?? null,
    },
  };
}

/**
 * Loads the dispute's stored messages and derives the constraints. Any read
 * error yields NO constraint rather than failing the build: the constraint is
 * a second layer, and the item-not-received family already bans refund-
 * request denials unconditionally.
 */
export async function loadInternalNarrativeConstraints(
  disputeId: string,
): Promise<InternalNarrativeConstraints> {
  try {
    const sb = getServiceClient();
    const { data: tickets, error: tErr } = await sb
      .from("gorgias_matched_tickets")
      .select("id, match_status, confidence")
      .eq("dispute_id", disputeId);
    if (tErr || !tickets || tickets.length === 0) return NO_INTERNAL_CONSTRAINTS;

    const { data: messages, error: mErr } = await sb
      .from("gorgias_evidence_messages")
      .select("id, matched_ticket_id, sender_type, sent_at, message_text, evidence_category")
      .eq("dispute_id", disputeId);
    if (mErr || !messages) return NO_INTERNAL_CONSTRAINTS;

    const ticketById = new Map(
      tickets.map((t) => [t.id as string, t as { match_status: string | null; confidence: string | null }]),
    );
    return deriveInternalNarrativeConstraints(
      messages.map((m) => {
        const t = ticketById.get(m.matched_ticket_id as string);
        return {
          id: m.id as string,
          senderType: m.sender_type as string,
          sentAt: (m.sent_at as string | null) ?? null,
          messageText: (m.message_text as string | null) ?? null,
          evidenceCategory: (m.evidence_category as string | null) ?? null,
          ticketMatchStatus: t?.match_status ?? null,
          ticketConfidence: t?.confidence ?? null,
        };
      }),
    );
  } catch {
    return NO_INTERNAL_CONSTRAINTS;
  }
}
