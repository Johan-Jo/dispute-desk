/**
 * One-off: end-to-end LIVE Defence Package demo.
 *
 * Builds the same JSON-only user payload that production uses, calls
 * Anthropic Claude live, parses the response, runs the validator, renders
 * the deterministic PDF, and emails it via Resend.
 *
 * Does NOT write to defence_packages or defence_package_runs — this is
 * an isolated demo, no DB pollution.
 *
 * Usage:
 *   node --import tsx scripts/send-defence-package-live.mjs <to-email>
 *   (or `npx tsx scripts/send-defence-package-live.mjs <to-email>`)
 */

import { config } from "dotenv";
import { Resend } from "resend";

config({ path: ".env.local" });

import { callClaudeMessages } from "../lib/defence/anthropicClient.ts";
import { resolveReasonCodeModule } from "../lib/defence/reasonCodes/registry.ts";
import { buildLlmFactPayload } from "../lib/defence/narrativeWriter.ts";
import { validateNarrative } from "../lib/defence/validateNarrative.ts";
import { renderDefencePdf } from "../lib/defence/renderDefencePdf.ts";

const to = process.argv[2];
if (!to) {
  console.error("Usage: npx tsx scripts/send-defence-package-live.mjs <to-email>");
  process.exit(1);
}

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";
const MODEL = process.env.DEFENCE_PACKAGE_DEFAULT_MODEL ?? "claude-sonnet-4-6";

if (!RESEND_API_KEY) {
  console.error("RESEND_API_KEY not set in .env.local");
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_API_KEY) {
  console.error("ANTHROPIC_API_KEY (or CLAUDE_API_KEY) not set in .env.local");
  process.exit(1);
}

// ─── Realistic Visa 10.4 fact set ─────────────────────────────────────
const approvedFacts = [
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
      messageCount: 2,
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
  {
    id: "f3",
    category: "prior_customer_history",
    label: "Customer account history",
    value: { priorOrderCount: 4, disputeFreeHistory: true, fieldKey: "customer_account_info" },
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
    id: "f4",
    category: "order_record",
    label: "Order record",
    value: {
      fulfillmentStatus: "FULFILLED",
      confirmationSent: true,
      transactionDate: "2026-05-10T14:00:00Z",
      lineItems: [
        { description: "Design Thinking for Teams — Annual seat", quantity: 1, price: "USD 99.00" },
        { description: "Setup & onboarding session", quantity: 1, price: "USD 20.95" },
      ],
      fieldKey: "order_confirmation",
    },
    source: "shopify_order",
    sourceRef: null,
    strength: "supporting",
    bankEligible: true,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: true,
    submissionRisk: false,
    confidence: null,
  },
];

const reasonCodeModule = resolveReasonCodeModule("10.4");
const packageMode = "full";

const narrativeInput = {
  packageId: "live-demo-pkg",
  disputeId: "live-demo-dispute",
  reasonCode: "10.4",
  reasonCodeModule,
  packageMode,
  caseStrength: "strong",
  approvedFacts,
  manualEvidence: [],
  internalOnlyFactIds: [],
  missingEvidence: [],
};

const userPayload = buildLlmFactPayload(narrativeInput);

// ─── System prompt — same as production narrativeWriter ───────────────
const BASE_SYSTEM_PROMPT = `You are a chargeback representment narrative writer for DisputeDesk.

Your task is to convert APPROVED dispute evidence into professional, bank-facing
argument sections.

Rules:
1. Use only the facts in approvedFacts.
2. Do not invent, assume, infer, estimate, or embellish.
3. You are not investigating. You are not deciding what happened. You are
   converting approved facts into professional prose.
4. Every paragraph must be traceable to at least one approved fact id, via
   usedFactIds on the section.
5. Do not mention facts whose ids appear in internalOnlyFactIds (those facts
   are forbidden — their values are intentionally absent from this payload).
6. Do not mention missing evidence in bank-facing text. The missingEvidence
   list is for omission decisions only.
7. Professional, neutral, bank-facing language. Prefer evidence-based phrasing:
   "supports", "indicates", "is consistent with", "the available records show",
   "provides evidence that".
8. Do NOT use: "irrefutable", "definitive proof", "undeniable", "fraudulent
   cardholder", "the customer is lying", "the dispute is invalid".
9. If approvedFacts are weak or incomplete, write a NARROWER argument. Do not
   fill gaps. If a section has no supporting facts, return an empty string for
   that section AND list its sectionKey in omittedSections.
10. packageMode governs tone:
    - "full"   → firmer framing allowed.
    - "narrow" → hedged framing required. Use "The available evidence supports…",
                 "The available records indicate…", "The submitted evidence is
                 consistent with…". Executive summary must be one paragraph
                 of ≤ 4 sentences. No aggressive conclusions such as "the
                 dispute is invalid" or "this is clearly not fraud".
11. Return valid JSON only. No markdown. No code fences. No prose outside JSON.
12. Schema of the JSON output:

{
  "executiveSummary":            { "text": "...", "usedFactIds": ["..."] },
  "transactionOverviewArgument": { "text": "...", "usedFactIds": ["..."] },
  "chronologyArgument":          { "text": "...", "usedFactIds": ["..."] },
  "paymentAuthenticationArgument": { "text": "...", "usedFactIds": ["..."] },
  "fulfillmentArgument":         { "text": "...", "usedFactIds": ["..."] },
  "communicationArgument":       { "text": "...", "usedFactIds": ["..."] },
  "policyArgument":              { "text": "...", "usedFactIds": ["..."] },
  "manualEvidenceArgument":      { "text": "...", "usedFactIds": ["..."] },
  "conclusion":                  { "text": "...", "usedFactIds": ["..."] },
  "omittedSections": [{ "sectionKey": "fulfillmentArgument", "reason": "..." }],
  "warnings": []
}

13. If a section has no supporting approved facts, return:
    { "text": "", "usedFactIds": [] }
    and add an entry to omittedSections.`;

console.log(`Calling Claude (${MODEL}) — full live pipeline…`);
const t0 = Date.now();
const claudeRes = await callClaudeMessages({
  model: MODEL,
  system: [
    { type: "text", text: BASE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    { type: "text", text: reasonCodeModule.promptBody, cache_control: { type: "ephemeral" } },
  ],
  messages: [{ role: "user", content: JSON.stringify(userPayload) }],
  maxTokens: 4096,
  temperature: 0.2,
});

if (claudeRes.error || !claudeRes.raw) {
  console.error("Claude error:", claudeRes.error);
  process.exit(1);
}
console.log(
  `Claude returned in ${claudeRes.durationMs} ms — prompt ${claudeRes.promptTokens}t / completion ${claudeRes.completionTokens}t / cached ${claudeRes.cachedTokens}t`,
);

let narrative;
try {
  narrative = JSON.parse(claudeRes.raw);
} catch (err) {
  console.error("JSON parse failed:", err.message);
  console.error("Raw response:", claudeRes.raw.slice(0, 500));
  process.exit(1);
}

console.log("\n─── Validating narrative ───");
const validation = validateNarrative({
  narrative,
  approvedFacts,
  reasonCodeModule,
  packageMode,
});
if (!validation.ok) {
  console.error("Validation failed:");
  for (const e of validation.errors) {
    console.error(`  [${e.rule}] ${e.section}: ${e.message}`);
  }
  console.error("\nIn production this would block PDF render + submission.");
  process.exit(1);
}
console.log("✓ Validation passed");

console.log("\n─── Rendering PDF ───");
// Synthetic evidence hash for the metadata block (truncated for display).
import crypto from "node:crypto";
const evidenceHash = crypto
  .createHash("sha256")
  .update(JSON.stringify(approvedFacts.map((f) => ({ id: f.id, category: f.category, value: f.value }))))
  .digest("hex");

const docData = {
  meta: {
    packageId: "live-demo-pkg",
    disputeGid: "gid://shopify/Dispute/10550542393",
    orderName: "#1042",
    reasonCode: "10.4",
    reasonCodeDisplay: "Visa 10.4 — Fraud / Unauthorized Transaction",
    reasonCodeModuleKey: "visa_10_4_fraud",
    shopName: "DisputeDesk Live Demo Co",
    merchantName: "DisputeDesk Live Demo Co, Inc.",
    amountDisplay: "USD 119.95",
    cardNetwork: "Visa",
    cardLast4: "0259",
    paymentGateway: "Shopify Payments",
    financialStatus: "PAID",
    fulfillmentStatus: "FULFILLED",
    cardholderName: "Johan Jonsson",
    customerEmail: null,
    transactionDate: "2026-05-10T14:00:00Z",
    generatedAt: new Date().toISOString(),
    version: 1,
    packageMode,
    promptFamily: "defence_package_narrative",
    promptVersion: 1,
    modelUsed: MODEL,
    evidenceHash,
    generatedBy: "system",
  },
  narrative,
  approvedFacts,
  manualEvidence: [],
};
const rendered = await renderDefencePdf(docData);
console.log(`✓ PDF rendered: ${rendered.buffer.length} bytes`);

console.log("\n─── Sending via Resend ───");
const resend = new Resend(RESEND_API_KEY);
const result = await resend.emails.send({
  from: FROM,
  to: [to],
  subject: `DisputeDesk — LIVE Complete Defence Package (${MODEL})`,
  text: [
    "Hi,",
    "",
    `Attached is a LIVE Complete Defence Package — narrative generated by ${MODEL}`,
    "via the full production pipeline (system→LLM payload built by buildLlmFactPayload,",
    "validated by validateNarrative, rendered by renderDefencePdf).`,",
    "",
    `Total elapsed: ${Date.now() - t0} ms`,
    `Anthropic call: ${claudeRes.durationMs} ms`,
    `Tokens: prompt ${claudeRes.promptTokens}, completion ${claudeRes.completionTokens}, cached ${claudeRes.cachedTokens}`,
    "",
    "Synthetic dispute (Visa 10.4 / Other Fraud) with five approved facts:",
    "- Payment auth (AVS Y, CVV M)",
    "- Billing address match",
    "- Customer communication (customer confirmed order)",
    "- Prior customer history (4 prior orders, dispute-free)",
    "- Order record (fulfilled)",
    "",
    "No raw Shopify JSON crossed the LLM boundary — only normalized EvidenceFact",
    "records. The Evidence Basis section in the PDF is rendered deterministically",
    "from the same facts (LLM doesn't author that section).",
    "",
    "— DisputeDesk",
  ].join("\n"),
  attachments: [
    {
      filename: `defence-package-live-${MODEL}.pdf`,
      content: rendered.buffer,
    },
  ],
});

if (result.error) {
  console.error("Resend error:", result.error);
  process.exit(1);
}
console.log(`✓ Sent. Resend message id: ${result.data?.id ?? "(no id)"}`);
console.log(`\nDone — total elapsed ${Date.now() - t0} ms.`);
