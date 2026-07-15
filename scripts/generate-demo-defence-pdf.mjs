/**
 * Generate the static demo defence-package PDF.
 *
 *   node scripts/generate-demo-defence-pdf.mjs
 *
 * Renders `public/demo/defence-package-sample.pdf` — the file served by
 * the "View PDF" button on /demo dispute pages. The demo fetch shim
 * (lib/demo/fetchShim.ts) only wraps window.fetch, but "View PDF" is a
 * real link navigation to /api/defence-packages/:id/preview, which 401s
 * on demo shop context — so the demo card links to this static file
 * instead (see previewHref in CompleteDefencePackageCard.tsx).
 *
 * Renders through the SAME pre-bundled DefencePackageDocument the
 * production pdf-worker uses (scripts/pdf-worker/
 * defence-package-document.bundle.mjs, built by `prebuild`), so the
 * sample is pixel-identical to a real bank-facing package. Data mirrors
 * the dp-2401 hero fixture (lib/demo/fixtures/disputes.ts): order #1027,
 * Marcus Johansson, USD 248.50, FRAUDULENT, 8 evidence signals.
 *
 * Dates are intentionally static (Jan 2026 fixture anchor) — a rendered
 * PDF is a point-in-time document, unlike the live demo UI which
 * rebases dates against "today".
 */

import fs from "node:fs/promises";
import path from "node:path";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { DefencePackageDocument } from "./pdf-worker/defence-package-document.bundle.mjs";

const OUT_PATH = path.resolve(process.cwd(), "public/demo/defence-package-sample.pdf");

/** Shared fact defaults — every demo fact is approved + bank-facing. */
function fact(partial) {
  return {
    source: "shopify_order",
    sourceRef: null,
    strength: "strong",
    bankEligible: true,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: true,
    submissionRisk: false,
    confidence: 1,
    ...partial,
  };
}

const data = {
  meta: {
    packageId: "pkg-dp-2401",
    disputeGid: "gid://shopify/ShopifyPaymentsDispute/2401",
    orderName: "#1027",
    reasonCode: "FRAUDULENT",
    reasonCodeDisplay: "Visa 10.4 / Mastercard 4837",
    claimType: "Unauthorized transaction claim",
    reasonCodeModuleKey: "visa_10_4_fraud",
    reasonCodeFamilyKey: "unauthorized_fraud",
    shopName: "Demo Store",
    merchantName: "Demo Store",
    amountDisplay: "$248.50 USD",
    cardNetwork: "Visa",
    cardLast4: "4242",
    paymentGateway: "Shopify Payments",
    financialStatus: "PAID",
    fulfillmentStatus: "FULFILLED",
    cardholderName: "Marcus Johansson",
    customerEmail: "m.johansson@example.com",
    transactionDate: "2026-01-09T14:22:00Z",
    timelineEvents: [
      { at: "2026-01-09T14:20:00Z", text: "Customer completed checkout; payment authorised with full AVS and CVV verification and 3-D Secure authentication." },
      { at: "2026-01-09T14:22:00Z", text: "Order #1027 confirmed; order confirmation sent to the customer's verified email address." },
      { at: "2026-01-10T09:05:00Z", text: "Order fulfilled and handed to DHL Express under tracked shipment." },
      { at: "2026-01-12T13:45:00Z", text: "Shipment delivered to the cardholder's billing address; signed for by 'M. Johansson'." },
      { at: "2026-01-13T08:00:00Z", text: "Dispute received from the issuer citing an unauthorized transaction." },
    ],
    lineItemsFromContext: [
      { description: "Meridian Leather Weekender Bag — Cognac", quantity: 1, price: "$219.00" },
      { description: "DHL Express shipping", quantity: 1, price: "$29.50" },
    ],
    generatedAt: "2026-01-13T11:30:00Z",
    version: 1,
    packageMode: "full",
    promptFamily: "fraud_v3",
    promptVersion: 1,
    modelUsed: "claude-opus-4-7",
    evidenceHash: "a41f9c2d87b3",
    generatedBy: "system",
  },

  composedBlocks: [
    {
      sectionKey: "executiveSummary",
      heading: "Executive Summary",
      thesisText:
        "The cardholder authorised this transaction, and the purchased goods were delivered to and signed for at the cardholder's own billing address.",
      llmText:
        "This transaction was authorised by the cardholder on January 9, 2026 for $248.50. The payment passed full AVS verification (street and postal code) and CVV verification at checkout, and 3-D Secure authentication completed successfully — the card issuer confirmed the cardholder's identity directly. The order was placed from a device previously used by this customer for four successful purchases totalling $1,847 over 14 months, from an IP address geolocated to the same city as the billing and shipping addresses on file. The shipment was delivered on January 12 via DHL Express and signed for by 'M. Johansson' at the cardholder's registered address. Taken together, the authentication record, the customer's established purchase history, and the signed delivery to the cardholder's own address demonstrate a legitimate purchase by the cardholder.",
      fallbackText: "",
      usedFactIds: ["fact-payment-auth", "fact-billing-match", "fact-ip-location", "fact-delivery-proof", "fact-account-history"],
    },
    {
      sectionKey: "transactionOverviewArgument",
      heading: "Transaction Overview",
      thesisText: "",
      llmText:
        "Order #1027 was placed on the merchant's storefront on January 9, 2026 at 14:22 UTC and paid in full ($248.50) with a Visa card ending 4242 processed through Shopify Payments. The order comprised one Meridian Leather Weekender Bag with DHL Express shipping, shipped to the same address held on file as the card's billing address. The order confirmation was delivered to the customer's verified email address immediately after checkout.",
      fallbackText: "",
      usedFactIds: ["fact-order-record", "fact-billing-match"],
    },
    {
      sectionKey: "chronologyArgument",
      heading: "Chronology of Events",
      thesisText:
        "The event record shows one continuous, consistent sequence from authenticated checkout to signed delivery at the cardholder's address.",
      llmText:
        "Every step of this order — checkout, payment authentication, fulfilment, carrier delivery, and signature — is documented below in a single uninterrupted timeline. At no point before the dispute did the cardholder contact the merchant to question the charge, request a cancellation, or report the card lost or stolen.",
      fallbackText: "",
      usedFactIds: ["fact-order-record", "fact-delivery-proof"],
    },
    {
      sectionKey: "paymentAuthenticationArgument",
      heading: "Payment Authentication",
      thesisText:
        "The card issuer verified the cardholder's identity at the moment of purchase.",
      llmText:
        "The payment passed three independent issuer-side verification checks at checkout. The billing street address and postal code supplied by the purchaser matched the issuer's records in full (AVS), the card security code matched (CVV), and the purchase completed 3-D Secure authentication, in which the issuer verified the cardholder's identity directly through its own challenge flow. These checks confirm that the person completing the purchase had the physical card details and satisfied the issuer's own authentication of the cardholder.",
      fallbackText: "",
      usedFactIds: ["fact-payment-auth", "fact-billing-match"],
    },
    {
      sectionKey: "fulfillmentArgument",
      heading: "Fulfillment, Delivery & Access",
      thesisText:
        "The goods were delivered to the cardholder's billing address and signed for in the cardholder's name.",
      llmText:
        "The order was fulfilled the next business day and shipped via DHL Express under a fully tracked shipment. Carrier records confirm delivery on January 12, 2026 to the shipping address — identical to the card's billing address — where the parcel was signed for by 'M. Johansson', matching the cardholder's name. Signed proof of delivery to the cardholder's own verified address is direct evidence that the cardholder received the benefit of this purchase.",
      fallbackText: "",
      usedFactIds: ["fact-shipping-tracking", "fact-delivery-proof"],
    },
    {
      sectionKey: "policyArgument",
      heading: "Policy Disclosure",
      thesisText: "",
      llmText:
        "The merchant's refund policy and shipping policy were presented during checkout and accepted by the purchaser before payment. The customer completed checkout having affirmatively accepted these terms, and the purchase activity log records the acceptance alongside the rest of the checkout session.",
      fallbackText: "",
      usedFactIds: ["fact-policy-refund", "fact-policy-shipping", "fact-activity-log"],
    },
    {
      sectionKey: "conclusion",
      heading: "Conclusion",
      thesisText: "",
      llmText:
        "The evidence establishes that this was a legitimate purchase made by the cardholder: the issuer authenticated the cardholder's identity at checkout via 3-D Secure, the billing details matched the issuer's records in full, the purchase is consistent with the customer's 14-month history of successful orders from the same device, and the goods were delivered to and signed for at the cardholder's own billing address in the cardholder's name. The merchant respectfully requests that this chargeback be reversed and the transaction amount of $248.50 be returned to the merchant.",
      fallbackText: "",
      usedFactIds: ["fact-payment-auth", "fact-billing-match", "fact-account-history", "fact-delivery-proof"],
    },
  ],

  // Mirrors FIELDS_PRESENT_BY_DISPUTE["dp-2401"] in
  // lib/demo/fixtures/workspaceData.ts — 8 approved bank-facing signals.
  approvedFacts: [
    fact({
      id: "fact-payment-auth",
      category: "payment_authentication",
      label: "Payment authentication",
      value: { verificationSummary: "billing address matched • CVV matched", threeDS: true },
      source: "shopify_payments",
    }),
    fact({
      id: "fact-billing-match",
      category: "billing_match",
      label: "Billing address match",
      value: { match: true },
    }),
    fact({
      id: "fact-ip-location",
      category: "ip_location",
      label: "IP geolocation",
      value: { locationMatch: "same_city" },
      source: "session_intelligence",
      strength: "moderate",
    }),
    fact({
      id: "fact-shipping-tracking",
      category: "shipping_tracking",
      label: "Shipping tracking",
      value: { proofType: "delivered_confirmed", deliveredAt: "2026-01-12T13:45:00Z" },
      source: "carrier_dhl",
    }),
    fact({
      id: "fact-delivery-proof",
      category: "delivery_proof",
      label: "Delivery confirmation",
      value: { proofType: "signature_confirmed", deliveredAt: "2026-01-12T13:45:00Z" },
      source: "carrier_dhl",
    }),
    fact({
      id: "fact-activity-log",
      category: "digital_access_log",
      label: "Customer activity log",
      value: { decisiveSessionProof: true },
      source: "session_intelligence",
      strength: "moderate",
    }),
    fact({
      id: "fact-account-history",
      category: "prior_customer_history",
      label: "Customer order history",
      value: { priorOrderCount: 4, disputeFreeHistory: true },
      strength: "moderate",
    }),
    fact({
      id: "fact-order-record",
      category: "order_record",
      label: "Order record",
      value: { orderName: "#1027" },
    }),
  ],

  manualEvidence: [],
};

const buffer = await renderToBuffer(
  React.createElement(DefencePackageDocument, { data }),
);

if (buffer.length < 5 || Buffer.from(buffer.slice(0, 5)).toString("ascii") !== "%PDF-") {
  console.error("Output does not start with %PDF- magic bytes — render failed.");
  process.exit(1);
}

await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
await fs.writeFile(OUT_PATH, buffer);
console.log(`Wrote ${OUT_PATH} (${(buffer.length / 1024).toFixed(1)} KB)`);
