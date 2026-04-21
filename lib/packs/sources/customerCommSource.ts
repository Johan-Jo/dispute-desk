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
 * Emits `customer_communication` in fieldsProvided ONLY when at least
 * one of: staff note, customer note, buyer attribute, or merchant
 * timeline comment is present. System events and the auto-confirmation
 * email do NOT trigger inclusion — those exist on every Shopify order
 * and would make the checklist row falsely "Included" for every dispute.
 *
 * (Updated 2026-04-21 — previously a non-empty timeline of system events
 * counted as engagement, which produced misleading "Included" rows.)
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
    .filter((a) => (a.value ?? "").trim().length > 0);

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

  // Count the signals that carry actual two-way engagement. System
  // timeline events and the auto-confirmation email are excluded
  // because every Shopify order has them — counting them as engagement
  // would falsely mark this row "Included" on every dispute.
  const merchantComments = signals.timelineEvents.filter(
    (e) => e.source === "merchant_comment",
  ).length;
  const confirmationEvents = signals.timelineEvents.filter(
    (e) => e.source === "customer_confirmation_email",
  ).length;

  const realEngagementCount =
    (signals.staffNote ? 1 : 0) +
    (signals.customerNote ? 1 : 0) +
    (signals.buyerAttributes.length > 0 ? 1 : 0) +
    merchantComments;

  if (realEngagementCount === 0) return [];

  return [
    {
      type: "comms",
      label: "Customer communication",
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
