/**
 * Gorgias ticket ↔ dispute match scoring (PRD §11).
 *
 * Pure function, no I/O. The enrichment job builds a `TicketForScoring`
 * from each Gorgias ticket (plus its public message text, scanned locally
 * so scoring adds zero API traffic) and an `OrderMatchSignals` from the
 * dispute + local `shopify_orders` row, and this module returns a signed
 * score, a confidence tier and the exact reasons that produced it.
 *
 * Tiers drive behavior downstream:
 *   high   (>= 80)  auto `confirmed_match`, auto-analyzed
 *   medium (50–79)  `proposed_match` — merchant must confirm before any
 *                   message becomes approvable
 *   low    (< 50)   hidden "other possible conversations" tier — no
 *                   messages persisted, never analyzed
 *
 * MATCHING_ALGORITHM_VERSION is stamped on every matched-ticket row and
 * bad-match report so score tuning has real provenance.
 */

export const MATCHING_ALGORITHM_VERSION = 1;

export interface OrderMatchSignals {
  /** Shopify order name, e.g. "#1066" (disputes.order_name). */
  orderName: string | null;
  customerEmail: string | null;
  /** Numeric Shopify customer id as a digit string (from the Customer GID). */
  shopifyCustomerId: string | null;
  trackingNumbers: string[];
  orderCreatedAt: string | null;
  deliveredAt: string | null;
  /** disputes.initiated_at */
  chargebackAt: string | null;
}

export interface TicketForScoring {
  ticketId: number;
  createdAt: string | null;
  customerEmail: string | null;
  /** From Gorgias customer integration data, when present. Digit string. */
  customerShopifyId: string | null;
  subject: string | null;
  /** Concatenated public message text (already internal-note-filtered). */
  publicMessageText: string;
  /** From Gorgias ticket/customer Shopify-integration meta, when exposed. */
  linkedShopifyOrderName: string | null;
}

export interface MatchReason {
  signal: string;
  points: number;
  detail?: string;
}

export type MatchConfidence = "high" | "medium" | "low";

export interface MatchResult {
  score: number;
  confidence: MatchConfidence;
  reasons: MatchReason[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "#1066" / "Order 1066" / "1066" → "1066"; null when no digits. */
export function orderNameDigits(orderName: string | null): string | null {
  if (!orderName) return null;
  const m = orderName.match(/(\d+)/);
  return m ? m[1] : null;
}

function parseMs(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * True when the disputed order number appears in the text with a word
 * boundary. A bare number (no "#") only counts at >= 4 digits — short
 * bare numbers ("12", "365") are far too noisy in support text.
 */
function textMentionsOrderNumber(text: string, digits: string): boolean {
  if (!digits) return false;
  const hashRe = new RegExp(`#\\s?${digits}(?!\\d)`);
  if (hashRe.test(text)) return true;
  if (digits.length >= 4) {
    const bareRe = new RegExp(`(?<![\\d#])${digits}(?!\\d)`);
    return bareRe.test(text);
  }
  return false;
}

/** All "#NNN"-style order references present in the text. */
function referencedOrderNumbers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/#\s?(\d{3,})(?!\d)/g)) out.add(m[1]);
  return [...out];
}

export function tierForScore(score: number): MatchConfidence {
  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  return "low";
}

export function scoreTicketMatch(
  ticket: TicketForScoring,
  order: OrderMatchSignals,
): MatchResult {
  const reasons: MatchReason[] = [];
  const add = (signal: string, points: number, detail?: string) => {
    reasons.push(detail ? { signal, points, detail } : { signal, points });
  };

  const text = `${ticket.subject ?? ""}\n${ticket.publicMessageText}`;
  const orderDigits = orderNameDigits(order.orderName);
  const linkedDigits = orderNameDigits(ticket.linkedShopifyOrderName);

  // +100 — ticket directly linked to the disputed Shopify order
  if (orderDigits && linkedDigits && orderDigits === linkedDigits) {
    add("linked_shopify_order", 100, `#${orderDigits}`);
  }

  // +80 — disputed order number appears in subject/messages
  const mentionsDisputedOrder =
    !!orderDigits && textMentionsOrderNumber(text, orderDigits);
  if (mentionsDisputedOrder) {
    add("order_number_in_text", 80, `#${orderDigits}`);
  }

  // +70 — exact Shopify customer id
  if (
    order.shopifyCustomerId &&
    ticket.customerShopifyId &&
    order.shopifyCustomerId === ticket.customerShopifyId
  ) {
    add("shopify_customer_id", 70);
  }

  // +50 / −80 — customer email exact match vs conflict
  const orderEmail = order.customerEmail?.trim().toLowerCase() || null;
  const ticketEmail = ticket.customerEmail?.trim().toLowerCase() || null;
  if (orderEmail && ticketEmail) {
    if (orderEmail === ticketEmail) add("email_match", 50);
    else add("conflicting_email", -80);
  }

  // +40 — a tracking number of the disputed order appears in the text
  const tracking = order.trackingNumbers.find(
    (t) => t.trim().length >= 6 && text.toLowerCase().includes(t.trim().toLowerCase()),
  );
  if (tracking) add("tracking_number_in_text", 40, tracking.trim());

  // Date-window bonus (PRD §10.4). Window end anchors on delivery when
  // known, else on the order date.
  const ticketMs = parseMs(ticket.createdAt);
  const orderMs = parseMs(order.orderCreatedAt);
  const anchorMs = parseMs(order.deliveredAt) ?? orderMs;
  const chargebackMs = parseMs(order.chargebackAt);
  if (ticketMs !== null && orderMs !== null && anchorMs !== null) {
    const windowStart = orderMs - 30 * DAY_MS;
    const windowEnd = anchorMs + 120 * DAY_MS;
    if (ticketMs >= windowStart && ticketMs <= windowEnd) {
      add("within_order_window", 20);
    } else if (
      ticketMs > windowEnd &&
      chargebackMs !== null &&
      ticketMs <= chargebackMs
    ) {
      add("before_chargeback", 10);
    }
    // After the chargeback: no bonus, no penalty (post-dispute messages
    // can still be relevant evidence).
  }

  // −100 — ticket clearly references a DIFFERENT order while the disputed
  // one is absent. Conservative: only "#NNN"-prefixed references count.
  if (orderDigits && !mentionsDisputedOrder) {
    const others = referencedOrderNumbers(text).filter((d) => d !== orderDigits);
    if (others.length > 0) {
      add("references_other_order", -100, `#${others[0]}`);
    }
  }

  const score = reasons.reduce((sum, r) => sum + r.points, 0);
  return { score, confidence: tierForScore(score), reasons };
}
