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

import type { SupabaseClient } from "@supabase/supabase-js";
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

/** Requests to return or send back the goods, in the same six locales. */
const RETURN_REQUEST_TEXT: readonly RegExp[] = [
  /\b(?:return(?:ing)?\s+(?:it|them|the|this|my)|send\s+(?:it|them)\s+back|sending\s+(?:it|them)\s+back|return\s+label|return\s+request)/i,
  /(?:rücksend|zurücksend|zurückschick|zurückgeb|retoure|retournier)/i,
  /(?:devol(?:ver|uci[oó]n)\s+(?:el|la|los|las|del)\s+(?:producto|art[ií]culo|pedido)|devolverlo|devolverla|etiqueta\s+de\s+devoluci)/i,
  /(?:renvoy|retourner\s+(?:le|la|les|l')|étiquette\s+de\s+retour|demande\s+de\s+retour)/i,
  /(?:returnera|skicka\s+tillbaka|returetikett|retur\s+av)/i,
  /(?:devolver\s+o\s+produto|devolução\s+do\s+produto|etiqueta\s+de\s+devolução)/i,
];

function asksToReturn(m: StoredMessageForConstraints): boolean {
  return RETURN_REQUEST_TEXT.some((re) => re.test(m.messageText ?? ""));
}

function isOrderMatched(m: StoredMessageForConstraints): boolean {
  if (m.ticketMatchStatus === "confirmed_match") return true;
  return m.ticketMatchStatus === "proposed_match" && m.ticketConfidence === "high";
}

/** Does this text ask for money back (refund / reimbursement / compensation)?
 *  The one definition, shared with the analyzer's category policy (P2). */
export function textAsksForMoneyBack(text: string | null | undefined): boolean {
  const t = text ?? "";
  return REFUND_REQUEST_TEXT.some((re) => re.test(t));
}

function asksForMoneyBack(m: StoredMessageForConstraints): boolean {
  if (m.evidenceCategory === "refund_history") return true;
  return textAsksForMoneyBack(m.messageText);
}

/** Pure. Exported for tests. */
export function deriveInternalNarrativeConstraints(
  messages: readonly StoredMessageForConstraints[],
): InternalNarrativeConstraints {
  const requests = messages.filter(
    (m) => m.senderType === "customer" && isOrderMatched(m) && asksForMoneyBack(m),
  );
  const returnRequested = messages.some(
    (m) => m.senderType === "customer" && isOrderMatched(m) && asksToReturn(m),
  );
  if (requests.length === 0) return returnRequested ? { ...NO_INTERNAL_CONSTRAINTS, returnRequested } : NO_INTERNAL_CONSTRAINTS;
  const dates = requests
    .map((m) => m.sentAt)
    .filter((d): d is string => typeof d === "string")
    .sort();
  return {
    refundOrCompensationRequested: {
      messageIds: requests.map((m) => m.id).sort(),
      firstSentAt: dates[0] ?? null,
    },
    returnRequested,
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
    const messages = await loadStoredMessagesForConstraints(getServiceClient(), disputeId);
    return messages ? deriveInternalNarrativeConstraints(messages) : NO_INTERNAL_CONSTRAINTS;
  } catch {
    return NO_INTERNAL_CONSTRAINTS;
  }
}

/**
 * READ-TIME ONLY (merchant pages): did a customer message matched to this
 * order ask to return the goods? Same predicates as `returnRequested` above
 * (one definition of "asks to return" and of "matched to this order"), but it
 * also reports WHEN the latest such message was sent, so a merchant's later
 * answer can be weighed against it. Never feeds a letter, a hash or a score.
 */
export function deriveCustomerReturnRequest(
  messages: readonly StoredMessageForConstraints[],
): { requested: boolean; latestSentAt: string | null } {
  const asks = messages.filter((m) => m.senderType === "customer" && isOrderMatched(m) && asksToReturn(m));
  const dates = asks
    .map((m) => m.sentAt)
    .filter((d): d is string => typeof d === "string")
    .sort();
  return { requested: asks.length > 0, latestSentAt: dates[dates.length - 1] ?? null };
}

/**
 * READ-ONLY (selects only): the customer-asked-to-return signal for a merchant
 * page. Absent integration, no matched tickets, a read error or a throw all
 * read as "no signal"; this never throws.
 */
export async function loadCustomerReturnRequest(
  sb: SupabaseClient,
  args: { disputeId: string; shopId: string },
): Promise<{ requested: boolean; latestSentAt: string | null }> {
  try {
    const messages = await loadStoredMessagesForConstraints(sb, args.disputeId, args.shopId);
    return messages ? deriveCustomerReturnRequest(messages) : { requested: false, latestSentAt: null };
  } catch {
    return { requested: false, latestSentAt: null };
  }
}

/**
 * The ONE reader of the dispute's stored helpdesk messages for these
 * derivations: two plain selects, scoped to the dispute (and the shop when
 * given). Null on any read error or when nothing is matched.
 */
export async function loadStoredMessagesForConstraints(
  sb: SupabaseClient,
  disputeId: string,
  shopId?: string,
): Promise<StoredMessageForConstraints[] | null> {
  const tq = sb.from("gorgias_matched_tickets").select("id, match_status, confidence").eq("dispute_id", disputeId);
  const { data: tickets, error: tErr } = await (shopId ? tq.eq("shop_id", shopId) : tq);
  if (tErr || !tickets || tickets.length === 0) return null;

  const mq = sb
    .from("gorgias_evidence_messages")
    .select("id, matched_ticket_id, sender_type, sent_at, message_text, evidence_category")
    .eq("dispute_id", disputeId);
  const { data: messages, error: mErr } = await (shopId ? mq.eq("shop_id", shopId) : mq);
  if (mErr || !messages) return null;

  const ticketById = new Map(
    tickets.map((t) => [t.id as string, t as { match_status: string | null; confidence: string | null }]),
  );
  return messages.map((m) => {
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
  });
}
