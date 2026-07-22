/**
 * Customer-communication evidence source collector.
 *
 * Pulls merchant ↔ customer communication traces from the order and
 * customer record in Shopify:
 *
 *   - Order.note            — merchant staff notes on the order
 *   - Order.customAttributes — buyer-provided attributes at checkout
 *                              (e.g. "please leave at door")
 *   - Order.events          — order timeline; we ONLY count merchant
 *                              comments here (system events and the
 *                              automated confirmation email do not
 *                              demonstrate two-way engagement)
 *   - Customer.note         — merchant staff notes on the customer
 *
 * Emits `customer_communication` in fieldsProvided ONLY when there is
 * real human authorship: a staff note, a customer note, or a merchant
 * timeline comment. System events and the auto-confirmation email do NOT
 * trigger inclusion — those exist on every Shopify order and would make
 * the checklist row falsely "Included" for every dispute.
 *
 * (Updated 2026-04-21 — previously a non-empty timeline of system events
 * counted as engagement, which produced misleading "Included" rows.)
 *
 * (Updated 2026-07-22 — buyer checkout attributes NO LONGER count as
 * customer communication. App-injected marketing/tracking attributes
 * (`_attribution="Smart Cart 2.0"`, `_source="Rebuy"`, `_barId=…`, and any
 * underscore-prefixed key) were being counted as "engagement", which
 * emitted `customer_communication` as present on orders with zero real
 * conversations — the checklist then read "Included" and the merchant
 * email falsely claimed "We've already attached: Customer support
 * conversations." Buyer attributes are still surfaced in the section data
 * for context when the section is emitted for a real reason, but they can
 * never by themselves flip `customer_communication` to present.)
 *
 * Reads the pre-fetched OrderDetailNode from ctx.order (populated by
 * buildPack.ts). No independent Shopify round-trip.
 */

import type { OrderDetailNode } from "@/lib/shopify/queries/orders";
import type { EvidenceSection, BuildContext } from "../types";

interface ExtractedSignals {
  staffNote: string | null;
  customerNote: string | null;
  buyerAttributes: Array<{ key: string; value: string | null }>;
  timelineEvents: Array<{
    id: string;
    message: string;
    createdAt: string;
    source: "customer_confirmation_email" | "merchant_comment" | "system";
  }>;
}

const CUSTOMER_FACING_EVENT_KEYWORDS = [
  "confirmation email",
  "shipping confirmation",
  "delivery confirmation",
  "invoice",
  "receipt",
  "notification",
  "notice",
];

/**
 * Buyer checkout attributes are frequently injected by apps (cart, upsell,
 * subscription, attribution) rather than typed by the customer. Those are
 * NOT customer communication. Shopify's convention is to prefix app/system
 * attributes with an underscore (`_attribution`, `_source`, `_barId`, …);
 * we also deny a few known non-underscore marketing/app keys. A genuine
 * buyer note (e.g. "leave at door", "gift message") has a plain key and is
 * kept — though note that even a genuine buyer note is not, on its own,
 * counted as two-way support engagement (see `collectCustomerCommEvidence`).
 */
const APP_INJECTED_ATTRIBUTE_KEYS = new Set([
  "attribution",
  "source",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "referrer",
  "landing_page",
]);

function isAppInjectedAttribute(key: string): boolean {
  const k = key.trim().toLowerCase();
  // Underscore-prefixed keys are Shopify's app/system convention.
  if (k.startsWith("_")) return true;
  return APP_INJECTED_ATTRIBUTE_KEYS.has(k);
}

function classifyEvent(
  message: string,
  attributeToUser: boolean,
): "customer_confirmation_email" | "merchant_comment" | "system" {
  if (attributeToUser) return "merchant_comment";
  const lower = message.toLowerCase();
  if (CUSTOMER_FACING_EVENT_KEYWORDS.some((kw) => lower.includes(kw))) {
    return "customer_confirmation_email";
  }
  return "system";
}

function extract(order: OrderDetailNode): ExtractedSignals {
  const staffNote = order.note?.trim() || null;
  const customerNote = order.customer?.note?.trim() || null;

  const buyerAttributes = (order.customAttributes ?? [])
    .map((a) => ({ key: a.key, value: a.value }))
    .filter((a) => (a.value ?? "").trim().length > 0)
    // Drop app-injected marketing/tracking attributes (Rebuy, Smart Cart,
    // UTM, …) — they are not customer communication.
    .filter((a) => !isAppInjectedAttribute(a.key));

  const timelineEvents = (order.events?.edges ?? [])
    .map((e) => e.node)
    .filter((n) => (n.message ?? "").trim().length > 0)
    .map((n) => ({
      id: n.id,
      message: n.message,
      createdAt: n.createdAt,
      source: classifyEvent(n.message, n.attributeToUser),
    }));

  return { staffNote, customerNote, buyerAttributes, timelineEvents };
}

export async function collectCustomerCommEvidence(
  ctx: BuildContext,
): Promise<EvidenceSection[]> {
  const order = ctx.order;
  if (!order) return [];

  const signals = extract(order);

  // Count the signals that carry actual two-way engagement — real human
  // authorship only. System timeline events and the auto-confirmation
  // email are excluded because every Shopify order has them. Buyer
  // checkout attributes are ALSO excluded from the trigger: they are
  // often app-injected (and even genuine buyer notes are not two-way
  // support engagement), and counting them falsely emitted
  // `customer_communication` on orders with zero conversations.
  const merchantComments = signals.timelineEvents.filter(
    (e) => e.source === "merchant_comment",
  ).length;
  const confirmationEvents = signals.timelineEvents.filter(
    (e) => e.source === "customer_confirmation_email",
  ).length;

  const realEngagementCount =
    (signals.staffNote ? 1 : 0) +
    (signals.customerNote ? 1 : 0) +
    merchantComments;

  // No real human communication → do not emit the section (and thus do not
  // mark `customer_communication` present). Buyer attributes alone never
  // qualify.
  if (realEngagementCount === 0) return [];

  return [
    {
      type: "comms",
      labelToken: { key: "packs.section.customerCommunication" },
      source: "shopify_timeline",
      fieldsProvided: ["customer_communication"],
      data: {
        orderNote: signals.staffNote,
        customerNote: signals.customerNote,
        buyerAttributes: signals.buyerAttributes,
        timelineEvents: signals.timelineEvents,
        summary: {
          staffNotePresent: signals.staffNote !== null,
          customerNotePresent: signals.customerNote !== null,
          buyerAttributeCount: signals.buyerAttributes.length,
          confirmationEventCount: confirmationEvents,
          merchantCommentCount: merchantComments,
          timelineEventCount: signals.timelineEvents.length,
        },
      },
    },
  ];
}
