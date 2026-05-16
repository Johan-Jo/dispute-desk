/**
 * One-off: render a sample Defence Package PDF and email it via Resend.
 *
 * Uses the deterministic PDF renderer with a hand-written narrative
 * (no Anthropic call) so the recipient sees what the bank-facing
 * document looks like end-to-end.
 *
 * Usage:
 *   node scripts/send-defence-package-sample.mjs <to-email>
 */

import { config } from "dotenv";
import { Resend } from "resend";
import { renderDefencePdf } from "../lib/defence/renderDefencePdf.ts";

config({ path: ".env.local" });

const to = process.argv[2];
if (!to) {
  console.error("Usage: node scripts/send-defence-package-sample.mjs <to-email>");
  process.exit(1);
}

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";
if (!RESEND_API_KEY) {
  console.error("RESEND_API_KEY not set in .env.local");
  process.exit(1);
}

const sampleData = {
  meta: {
    packageId: "sample-pkg-1",
    disputeGid: "gid://shopify/Dispute/sample",
    orderName: "#1042",
    reasonCode: "10.4",
    reasonCodeDisplay: "Visa 10.4 / Mastercard 4837 — Other Fraud (Card Absent)",
    shopName: "DisputeDesk Sample Co",
    merchantName: "DisputeDesk Sample Co, Inc.",
    amountDisplay: "USD 119.95",
    cardNetwork: "Visa",
    transactionDate: "2026-05-10T14:00:00Z",
    generatedAt: new Date().toISOString(),
    version: 1,
    packageMode: "full",
    promptVersion: 1,
    modelUsed: "claude-sonnet-4-6",
  },
  narrative: {
    executiveSummary: {
      text:
        "The available records support that this transaction was authorised by the cardholder. Payment authentication signals (AVS and CVV both matched the issuer record), a billing address consistent with the cardholder on file, and pre-dispute customer communication confirming the order are documented below. We respectfully request that the chargeback be reversed.",
      usedFactIds: ["f0", "f1", "f2"],
    },
    transactionOverviewArgument: {
      text:
        "Order #1042 was placed on 10 May 2026 for USD 119.95 and authorised against the cardholder's Visa account. The authorisation response carried matching AVS (Y) and CVV (M) results, indicating the address and verification value supplied at checkout matched what the issuing bank had on file.",
      usedFactIds: ["f0", "f1"],
    },
    chronologyArgument: {
      text:
        "10 May 2026 14:00 UTC — Order placed and authorisation captured (AVS Y, CVV M). 11 May 2026 15:30 UTC — Customer contacted store via email to confirm receipt of order confirmation. These records pre-date the chargeback notification by several days.",
      usedFactIds: ["f0", "f2"],
    },
    paymentAuthenticationArgument: {
      text:
        "Payment authentication is the strongest available signal in this case. The Address Verification System returned Y (full address match) and the Card Verification Value returned M (match). Both results are consistent with a cardholder-initiated transaction. The billing address provided at checkout also matched the cardholder's billing address on record with the issuer.",
      usedFactIds: ["f0", "f1"],
    },
    fulfillmentArgument: { text: "", usedFactIds: [] },
    communicationArgument: {
      text:
        "The customer corresponded with the store directly on 11 May 2026 confirming receipt of the order confirmation email. This communication pre-dates the chargeback notification and indicates the cardholder was aware of and engaged with the purchase.",
      usedFactIds: ["f2"],
    },
    policyArgument: { text: "", usedFactIds: [] },
    manualEvidenceArgument: { text: "", usedFactIds: [] },
    conclusion: {
      text:
        "The submitted evidence is consistent with an authenticated, cardholder-initiated transaction. We respectfully request the chargeback be reversed.",
      usedFactIds: ["f0", "f1", "f2"],
    },
    omittedSections: [
      { sectionKey: "fulfillmentArgument", reason: "no_delivery_facts" },
      { sectionKey: "policyArgument", reason: "no_policy_facts" },
      { sectionKey: "manualEvidenceArgument", reason: "no_manual_evidence" },
    ],
    warnings: [],
  },
  approvedFacts: [
    {
      id: "f0",
      category: "payment_authentication",
      label: "Payment authentication (AVS + CVV)",
      value: { avsResult: "Y", cvvResult: "M", threeDS: false, fieldKey: "avs_cvv_match" },
      source: "shopify_order",
      sourceRef: null,
      strength: "strong",
      bankEligible: true,
      merchantVisible: true,
      internalOnly: false,
      includeInBankNarrative: true,
      submissionRisk: false,
      confidence: null,
    },
    {
      id: "f1",
      category: "billing_match",
      label: "Billing address match",
      value: { match: true, fieldKey: "billing_address_match" },
      source: "shopify_order",
      sourceRef: null,
      strength: "strong",
      bankEligible: true,
      merchantVisible: true,
      internalOnly: false,
      includeInBankNarrative: true,
      submissionRisk: false,
      confidence: null,
    },
    {
      id: "f2",
      category: "customer_communication",
      label: "Customer communication",
      value: {
        customerConfirmsOrder: true,
        lastMessageAt: "2026-05-11T15:30:00Z",
        fieldKey: "customer_communication",
      },
      source: "shopify_order",
      sourceRef: null,
      strength: "strong",
      bankEligible: true,
      merchantVisible: true,
      internalOnly: false,
      includeInBankNarrative: true,
      submissionRisk: false,
      confidence: null,
    },
  ],
  manualEvidence: [],
};

console.log("Rendering Defence Package PDF…");
const rendered = await renderDefencePdf(sampleData);
console.log(`PDF rendered: ${rendered.buffer.length} bytes`);

console.log(`Sending via Resend to ${to}…`);
const resend = new Resend(RESEND_API_KEY);

const result = await resend.emails.send({
  from: FROM,
  to: [to],
  subject: "DisputeDesk — Complete Defence Package (sample)",
  text: [
    "Hi,",
    "",
    "Attached is a sample Complete Defence Package PDF — the bank-facing",
    "representment that DisputeDesk's Grounded Defence Package Builder",
    "generates when the ENABLE_DEFENCE_PACKAGE_BUILDER feature flag is on.",
    "",
    "This sample uses a hand-written narrative against a synthetic Visa 10.4",
    "fact set so you can see the layout, sections, footer, and Evidence Basis",
    "table without consuming any Anthropic tokens.",
    "",
    "The real production flow generates the narrative via Claude with strict",
    "claim guards and validation; the PDF render and Evidence Basis section",
    "are deterministic regardless.",
    "",
    "— DisputeDesk",
  ].join("\n"),
  attachments: [
    {
      filename: "defence-package-sample.pdf",
      content: rendered.buffer,
    },
  ],
});

if (result.error) {
  console.error("Resend error:", result.error);
  process.exit(1);
}
console.log(`Sent. Resend message id: ${result.data?.id ?? "(no id)"}`);
