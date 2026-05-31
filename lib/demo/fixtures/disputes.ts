/**
 * Six fixture disputes covering every DisputeDesk capability.
 * `dp-2401` is the hero landing page — strongest auto-built case.
 *
 * Dates are intentionally relative to a fixed anchor (Jan 1 2026) so the demo
 * is fully static — see Date.now() restriction in fixture-driven static export.
 */

import type { DemoDispute } from "./types";

const ANCHOR = "2026-01-15T10:00:00Z";

function isoOffset(daysFromAnchor: number, hours = 0): string {
  const ms = new Date(ANCHOR).getTime() + daysFromAnchor * 86_400_000 + hours * 3_600_000;
  return new Date(ms).toISOString();
}

export const DEMO_DISPUTES: DemoDispute[] = [
  // ─── dp-2401 — HERO: Fraud, Strong auto-built ─────────────────────────────
  {
    id: "dp-2401",
    orderName: "#1027",
    customerName: "Marcus Johansson",
    customerEmail: "m.johansson@example.com",
    amount: 248.5,
    currency: "USD",
    reasonFamily: "fraudulent",
    reasonLabel: "Fraudulent",
    heroLine: "Auto-built in 4 seconds. Ready to save to Shopify.",
    strength: "strong",
    strengthCaption: "Strong defence — 8 of 8 evidence signals collected",
    strengthScore: 92,
    dueAt: isoOffset(5),
    openedAt: isoOffset(-2),
    status: "ready_to_submit",
    statusLabel: "Ready to submit",
    evidence: [
      { id: "ev-1", label: "AVS full match", group: "strong", detail: "Billing street + ZIP match cardholder records", source: "Shopify Payments" },
      { id: "ev-2", label: "CVV match", group: "strong", detail: "CVV verified by issuer", source: "Shopify Payments" },
      { id: "ev-3", label: "3-D Secure authenticated", group: "strong", detail: "Card issuer confirmed identity via 3DS challenge", source: "Shopify Payments" },
      { id: "ev-4", label: "Device fingerprint matches prior orders", group: "strong", detail: "Same device used for 4 successful prior purchases", source: "Session intelligence" },
      { id: "ev-5", label: "IP geolocation matches shipping address", group: "moderate", detail: "Stockholm, Sweden — billing + shipping + IP all aligned", source: "IPinfo" },
      { id: "ev-6", label: "Customer order history", group: "moderate", detail: "4 prior orders, total $1,847 spent over 14 months", source: "Shopify Orders" },
      { id: "ev-7", label: "Fulfillment delivered + signed", group: "moderate", detail: "DHL Express — delivered Jan 12, signed by M. Johansson", source: "AfterShip" },
      { id: "ev-8", label: "No prior chargebacks", group: "supplemental", detail: "Customer has zero disputes across their order history", source: "DisputeDesk" },
    ],
    timeline: [
      { id: "t-1", at: isoOffset(-2, 0), label: "Dispute opened by issuer", detail: "Fraudulent — Marcus Johansson", tone: "info" },
      { id: "t-2", at: isoOffset(-2, 0.1), label: "DisputeDesk webhook received", tone: "default" },
      { id: "t-3", at: isoOffset(-2, 0.2), label: "Auto-collected 8 evidence items", detail: "AVS, CVV, 3DS, device, IP, history, fulfillment, chargeback record", tone: "success" },
      { id: "t-4", at: isoOffset(-2, 0.3), label: "Defense package generated", detail: "Score: 92% — strength: Strong", tone: "success" },
      { id: "t-5", at: isoOffset(-2, 0.4), label: "Ready for review", detail: "Awaiting merchant approval to save to Shopify", tone: "default" },
    ],
    bankRebuttalNarrative:
      "This transaction was authorised by the cardholder on January 9, 2026 for $248.50. The cardholder passed full AVS verification (street and ZIP) and CVV verification at checkout. 3-D Secure authentication completed successfully, confirming the cardholder's identity directly with the card issuer. The order was placed from a device previously used by this customer for 4 successful purchases totalling $1,847 over 14 months, from an IP address geolocated to Stockholm, Sweden — matching the billing and shipping addresses on file. The shipment was delivered on January 12 via DHL Express and signed for by 'M. Johansson' at the cardholder's registered address. The customer has no prior chargebacks across their full order history with this merchant.",
    shopifyFieldMap: [
      { slot: "Customer email address", sourceFields: ["customer.email (verified)"] },
      { slot: "Customer purchase IP", sourceFields: ["session.ip (Stockholm, SE — matches billing)"] },
      { slot: "Access activity log", sourceFields: ["4 prior orders, device fingerprint, login history"] },
      { slot: "Shipping documentation", sourceFields: ["DHL tracking + delivery confirmation + signature"] },
      { slot: "Uncategorized text (fraud rebuttal)", sourceFields: ["AVS/CVV/3DS verification narrative + customer history"] },
    ],
    strengthBreakdown: [
      { label: "AVS full match", tone: "positive", detail: "Billing street + ZIP verified by issuer" },
      { label: "CVV match", tone: "positive", detail: "Card security code verified" },
      { label: "3-D Secure authenticated", tone: "positive", detail: "Cardholder identity confirmed by issuer — liability shift applies" },
      { label: "Device + IP consistency", tone: "positive", detail: "Same device + geolocation as prior successful purchases" },
      { label: "Fulfillment delivered + signed", tone: "positive", detail: "Signature confirms physical receipt at cardholder address" },
      { label: "No prior chargebacks", tone: "positive", detail: "Customer reputation supports the rebuttal" },
    ],
  },

  // ─── dp-2402 — Product not received, Strong ──────────────────────────────
  {
    id: "dp-2402",
    orderName: "#1031",
    customerName: "Aisha Patel",
    customerEmail: "aisha.patel@example.com",
    amount: 89.0,
    currency: "USD",
    reasonFamily: "product_not_received",
    reasonLabel: "Product not received",
    heroLine: "Delivery confirmed with signature. Strong rebuttal ready.",
    strength: "strong",
    strengthCaption: "Strong defence — fulfillment evidence complete",
    strengthScore: 88,
    dueAt: isoOffset(8),
    openedAt: isoOffset(-1),
    status: "ready_to_submit",
    statusLabel: "Ready to submit",
    evidence: [
      { id: "ev-1", label: "Tracking number with delivery confirmation", group: "strong", detail: "USPS 9405511899564... — delivered Jan 11", source: "AfterShip" },
      { id: "ev-2", label: "Signature on delivery", group: "strong", detail: "Signed by 'A. Patel' at front door", source: "USPS" },
      { id: "ev-3", label: "AfterShip events timeline", group: "moderate", detail: "Shipped → In transit → Out for delivery → Delivered (4 events)", source: "AfterShip" },
      { id: "ev-4", label: "Shipping address matches billing", group: "moderate", detail: "Both addresses on file are identical", source: "Shopify Orders" },
      { id: "ev-5", label: "Order placed by customer account", group: "supplemental", detail: "Logged-in account, not guest checkout", source: "Shopify Orders" },
    ],
    timeline: [
      { id: "t-1", at: isoOffset(-1, 0), label: "Dispute opened", tone: "info" },
      { id: "t-2", at: isoOffset(-1, 0.2), label: "Auto-collected fulfillment evidence", tone: "success" },
      { id: "t-3", at: isoOffset(-1, 0.3), label: "Defense package generated", detail: "Score: 88% — strength: Strong", tone: "success" },
    ],
    bankRebuttalNarrative:
      "The customer ordered this item on January 8 and the shipment was tracked end-to-end via USPS (tracking 9405511899564). The package was delivered on January 11 to the cardholder's billing and shipping address (which match on file) and was signed for at the front door by 'A. Patel'. The order was placed through the customer's logged-in account, not as a guest checkout. Complete AfterShip event history is attached.",
    shopifyFieldMap: [
      { slot: "Shipping documentation", sourceFields: ["USPS tracking + signature confirmation"] },
      { slot: "Shipping address", sourceFields: ["matches billing on file"] },
      { slot: "Customer email address", sourceFields: ["customer.email"] },
    ],
    strengthBreakdown: [
      { label: "Delivery confirmation", tone: "positive", detail: "Carrier-confirmed delivery to billing address" },
      { label: "Signature on file", tone: "positive", detail: "Recipient signed at the door" },
      { label: "Account-based order", tone: "positive", detail: "Not guest checkout — customer is identified" },
    ],
  },

  // ─── dp-2403 — Subscription / recurring ───────────────────────────────────
  {
    id: "dp-2403",
    orderName: "#1018",
    customerName: "Carlos Mendoza",
    customerEmail: "carlos.m@example.com",
    amount: 39.99,
    currency: "USD",
    reasonFamily: "subscription_canceled",
    reasonLabel: "Subscription canceled",
    heroLine: "Active subscription with policy disclosure and 11 prior successful charges.",
    strength: "strong",
    strengthCaption: "Strong defence — policy + payment history attached",
    strengthScore: 85,
    dueAt: isoOffset(10),
    openedAt: isoOffset(-3),
    status: "ready_to_submit",
    statusLabel: "Ready to submit",
    evidence: [
      { id: "ev-1", label: "Subscription start date and terms", group: "strong", detail: "Signed up Feb 2025 — $39.99/month, cancel anytime", source: "Shopify Subscriptions" },
      { id: "ev-2", label: "11 prior successful charges", group: "strong", detail: "Same card, same amount, monthly cadence since Feb 2025", source: "Shopify Payments" },
      { id: "ev-3", label: "Cancellation policy disclosed at signup", group: "strong", detail: "Customer accepted terms on Feb 14 2025", source: "Shopify Checkout" },
      { id: "ev-4", label: "No cancellation request on file", group: "moderate", detail: "Customer never contacted support or self-cancelled", source: "Shopify Customer" },
      { id: "ev-5", label: "Latest service delivered", group: "moderate", detail: "January access logs show 14 active sessions", source: "Merchant analytics" },
    ],
    timeline: [
      { id: "t-1", at: isoOffset(-3, 0), label: "Dispute opened", tone: "info" },
      { id: "t-2", at: isoOffset(-3, 0.2), label: "Auto-collected subscription history", tone: "success" },
      { id: "t-3", at: isoOffset(-3, 0.4), label: "Defense package generated", tone: "success" },
    ],
    bankRebuttalNarrative:
      "This is a recurring subscription charge that the customer authorised on February 14, 2025 and has been billed monthly without dispute for 11 consecutive months. The same card has been charged $39.99 every month at the same cadence, all 11 prior charges accepted. The cancellation policy was explicitly disclosed at signup and the customer never requested cancellation through any support channel or self-service flow. Service was actively delivered through January, with 14 logged active sessions in the disputed billing period.",
    shopifyFieldMap: [
      { slot: "Customer email address", sourceFields: ["customer.email"] },
      { slot: "Uncategorized text (subscription rebuttal)", sourceFields: ["11-month payment history + policy disclosure + active usage"] },
    ],
    strengthBreakdown: [
      { label: "Long payment history", tone: "positive", detail: "11 successful prior charges, no prior disputes" },
      { label: "Policy disclosed at signup", tone: "positive", detail: "Customer accepted terms in writing" },
      { label: "Service actively used", tone: "positive", detail: "Login + usage data through the disputed period" },
    ],
  },

  // ─── dp-2404 — Coverage gate (Shopify Protect) ────────────────────────────
  {
    id: "dp-2404",
    orderName: "#1042",
    customerName: "Sarah Chen",
    customerEmail: "s.chen@example.com",
    amount: 156.0,
    currency: "USD",
    reasonFamily: "fraudulent",
    reasonLabel: "Fraudulent",
    heroLine: "Covered by Shopify Protect — no merchant action required.",
    banner: {
      tone: "purple",
      title: "Covered by Shopify Protect",
      body: "Shopify will cover this chargeback if the bank rules against you. DisputeDesk has not built a defence pack — it's not needed.",
    },
    strength: "covered",
    strengthCaption: "Protected by Shopify",
    strengthScore: 100,
    dueAt: isoOffset(7),
    openedAt: isoOffset(-1),
    status: "covered",
    statusLabel: "Covered",
    evidence: [
      { id: "ev-1", label: "Shopify Protect status: PROTECTED", group: "strong", detail: "Eligible order — full coverage in effect", source: "Shopify Protect" },
    ],
    timeline: [
      { id: "t-1", at: isoOffset(-1, 0), label: "Dispute opened", tone: "info" },
      { id: "t-2", at: isoOffset(-1, 0.1), label: "Coverage gate detected: PROTECTED", tone: "success" },
      { id: "t-3", at: isoOffset(-1, 0.2), label: "Skipped pack build (coverage)", detail: "No defence required — Shopify handles this", tone: "default" },
    ],
    bankRebuttalNarrative: "—",
    shopifyFieldMap: [],
    strengthBreakdown: [
      { label: "Shopify Protect: PROTECTED", tone: "positive", detail: "Full chargeback coverage — merchant keeps the revenue regardless of outcome" },
    ],
  },

  // ─── dp-2405 — Fatal-loss gate (refund issued) ────────────────────────────
  {
    id: "dp-2405",
    orderName: "#1015",
    customerName: "James O'Brien",
    customerEmail: "j.obrien@example.com",
    amount: 72.5,
    currency: "USD",
    reasonFamily: "credit_not_processed",
    reasonLabel: "Credit not processed",
    heroLine: "Already refunded — disputing would be self-incriminating.",
    banner: {
      tone: "amber",
      title: "Already refunded — chargeback is structurally unwinnable",
      body: "This order was fully refunded on January 7. Submitting evidence would confirm the refund and the bank would side with the customer.",
    },
    strength: "fatal_loss",
    strengthCaption: "Fatal loss — refund already issued",
    strengthScore: 0,
    dueAt: isoOffset(6),
    openedAt: isoOffset(-2),
    status: "blocked",
    statusLabel: "Blocked",
    evidence: [
      { id: "ev-1", label: "Refund issued Jan 7 for full amount", group: "strong", detail: "$72.50 refunded — covers entire disputed amount", source: "Shopify Payments" },
    ],
    timeline: [
      { id: "t-1", at: isoOffset(-2, 0), label: "Dispute opened", tone: "info" },
      { id: "t-2", at: isoOffset(-2, 0.1), label: "Fatal-loss gate triggered: refund_issued", tone: "warning" },
      { id: "t-3", at: isoOffset(-2, 0.2), label: "Pack build blocked", detail: "No evidence will be submitted — bank rebuttal cannot cite the refund", tone: "default" },
    ],
    bankRebuttalNarrative: "—",
    shopifyFieldMap: [],
    strengthBreakdown: [
      { label: "Refund already issued", tone: "negative", detail: "$72.50 refunded Jan 7 — covers full disputed amount" },
      { label: "No defensible position", tone: "negative", detail: "Any rebuttal would confirm the refund to the bank" },
    ],
  },

  // ─── dp-2406 — Weak / review-mode parked ──────────────────────────────────
  {
    id: "dp-2406",
    orderName: "#1039",
    customerName: "Anna Müller",
    customerEmail: "anna.m@example.com",
    amount: 312.0,
    currency: "USD",
    reasonFamily: "product_not_received",
    reasonLabel: "Product not received",
    heroLine: "Needs merchant input — fulfillment evidence is missing.",
    banner: {
      tone: "blue",
      title: "Parked for review",
      body: "DisputeDesk could not auto-build a strong pack. Two pieces of evidence are needed from you before this can be submitted.",
    },
    strength: "weak",
    strengthCaption: "Weak defence — fulfillment data incomplete",
    strengthScore: 38,
    dueAt: isoOffset(4),
    openedAt: isoOffset(-1),
    status: "needs_review",
    statusLabel: "Needs review",
    evidence: [
      { id: "ev-1", label: "Order placed", group: "moderate", detail: "Account-based order, AVS match", source: "Shopify Payments" },
      { id: "ev-2", label: "Customer email contact", group: "supplemental", detail: "Customer confirmed receipt by email Jan 10 (manual upload pending)", source: "Merchant note" },
    ],
    timeline: [
      { id: "t-1", at: isoOffset(-1, 0), label: "Dispute opened", tone: "info" },
      { id: "t-2", at: isoOffset(-1, 0.2), label: "Auto-collection completed", detail: "Partial data — score 38%", tone: "warning" },
      { id: "t-3", at: isoOffset(-1, 0.3), label: "Parked for merchant review", tone: "default" },
    ],
    bankRebuttalNarrative: "—",
    shopifyFieldMap: [],
    strengthBreakdown: [
      { label: "AVS match", tone: "positive", detail: "Billing address verified" },
      { label: "No tracking on file", tone: "negative", detail: "Self-shipped without a tracked carrier — no delivery confirmation" },
      { label: "No proof of delivery", tone: "negative", detail: "Customer's email confirmation is informal — not bank-grade evidence" },
    ],
    merchantInputChecklist: [
      { id: "in-1", label: "Upload a tracking number for the shipment", required: true, detail: "Even a carrier label scan is enough. Without this, the bank has no proof the item shipped." },
      { id: "in-2", label: "Attach the customer's email confirming receipt", required: true, detail: "Forward the email or screenshot it — Shopify accepts both as supplemental evidence." },
      { id: "in-3", label: "(Optional) Add photo proof of packaging or contents", required: false, detail: "Strengthens the rebuttal but not required." },
    ],
  },
];

export function getDemoDispute(id: string): DemoDispute | undefined {
  return DEMO_DISPUTES.find((d) => d.id === id);
}
