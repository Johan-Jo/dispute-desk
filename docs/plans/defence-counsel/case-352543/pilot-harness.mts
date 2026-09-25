// PILOT (local only; nothing written to prod): claim ledger + advocacy prompt
// for blume-box #352543, run on a chosen model. Values are the verified records
// of the live v39 pack.
//   PILOT_MODEL=claude-sonnet-4-6 | claude-opus-5-5 | gpt-6-astra
import fs from "node:fs";
import dotenv from "dotenv";
import { composePdfBlocks } from "../../lib/defence/pdf/composePdfBlocks";
import { validateNarrative } from "../../lib/defence/validateNarrative";
import { resolveReasonCodeModuleForContext } from "../../lib/defence/reasonCodes/registry";
import { item_not_received } from "../../lib/defence/reasonCodes/families/item_not_received";
import { deliveryPostDatesDispute, NO_INTERNAL_CONSTRAINTS } from "../../lib/defence/internalConstraints";
import type { DefenceNarrativeOutput, EvidenceFact } from "../../lib/defence/types";

dotenv.config({ path: ".env.production.local", quiet: true }); // OPENAI_API_KEY only
const MODEL = process.env.PILOT_MODEL ?? "claude-sonnet-4-6";
const OUT = `scripts/.snapshots/pilot.${MODEL}`;
const TOKEN_FILE = "C:/Users/johan/AppData/Local/Temp/claude/c--Users-johan-Cursor-Portfolio-DisputeDesk/930fd6b5-546e-4bf5-9759-f9d208f53b5d/scratchpad/pilot.token";

/* ── 1. Claim ledger: what THIS case may assert, each backed by a record ── */
const LEDGER = [
  { id: "C1", claim: "The carrier (Stallion Express) recorded the shipment as delivered on 6 July 2026.", limits: "Never say where, to whom, or that any person received it." },
  { id: "C2", claim: "The merchant's fulfilment record places all three purchased items, each in the quantity ordered, in that single tracked shipment — verified item by item against the order's line items. The delivery record therefore covers the entire order: there is no second or partial shipment.", limits: "" },
  { id: "C3", claim: "The shipment carries a carrier tracking number, and the carrier's tracking record is publicly available at the link printed in the letter, so the issuer can check the delivery status directly with the carrier.", limits: "Do not print the tracking number or the URL; the letter prints them." },
  { id: "C4", claim: "The merchant recorded the shipment (fulfilment) on 2 July 2026, the day the order was placed.", limits: "Fulfilment is the merchant's own record; it is not delivery." },
  { id: "C5", claim: "The order was placed and paid on 2 July 2026.", limits: "" },
  { id: "C6", claim: "The carrier recorded delivery on 6 July 2026, and on that same day a delivery notification was sent to the email address on the order. The dispute was opened 75 days later, on 19 September 2026.", limits: "State the interval and these facts plainly and let the analyst draw the inference. Never accuse the cardholder of bad faith, never say the claim is late or out of time under network rules, never say or imply the cardholder did not contact the merchant." },
  { id: "C7", claim: "A shipping confirmation email was sent on 2 July 2026 to the email address on the order.", limits: "Say only that it was SENT to the order's email address; never that the cardholder read it, knew, was informed or was aware." },
  { id: "C8", claim: "A delivery notification email was sent on 6 July 2026 to the email address on the order.", limits: "Say only that it was SENT to the order's email address; never that the cardholder read it, knew, was informed or was aware." },
  { id: "C9", claim: "The order total equals the full disputed amount; the table shows the arithmetic.", limits: "Do not restate any amount or number from the table." },
  { id: "C10", claim: "The cardholder's claim is that the merchandise was not received (Visa 13.1).", limits: "" },
];

/* ── 2. The advocacy skill ── */
const SYSTEM = `You are the merchant's chargeback representment counsel. You write the argument sections of a response that an issuer's dispute analyst will read in about two minutes. Your job is to win: make the analyst conclude that the merchant's evidence answers the cardholder's claim.

HOW AN ISSUER ANALYST READS A NON-RECEIPT (Visa 13.1) RESPONSE
- The only question: does the evidence show the merchandise was delivered, and does it cover everything the cardholder paid for?
- They trust carrier records over merchant records, specific over general, and a short argument over a long one.
- Their doubts: "the merchant only says it shipped", "maybe only part of the order was delivered", "is this even the right shipment?". A winning letter closes each doubt with evidence before the analyst raises it.

HOW TO ARGUE
- Voice: counsel, third person. The merchant is "Blume": name it once, in the executive summary, then "the merchant". The cardholder is "the cardholder". Confident and plain. Never pleading, never hedging with "appears" or "seems".
- Lead with the conclusion, then the reason. Every paragraph makes ONE point and says WHY it matters to the claim, not just what a record contains.
- Say what each piece of evidence PROVES, not what it is. Weak: "The carrier record shows delivered." Strong: "The carrier's own record, not the merchant's, reports the delivery the cardholder denies."
- Weigh the evidence: the carrier's delivery record is the decisive evidence; the item-by-item fulfilment mapping makes it cover the whole order; the timing (C6) is the strongest supporting point; the shipping confirmation is minor.
- Anticipate and close the analyst's doubts using ledger claims.

WHAT YOU MAY ASSERT — THE CLAIM LEDGER
You may assert ONLY the claims below. Every sentence you write must list the ledger ids it relies on. You may combine ledger claims and draw conclusions from them, but never add a fact that is not in the ledger.
${LEDGER.map((c) => `${c.id}: ${c.claim}${c.limits ? ` LIMIT: ${c.limits}` : ""}`).join("\n")}

LIMITS ARE PRIVATE. Each LIMIT above is an instruction to you about what not to claim. NEVER state a limit, a caveat, a disclaimer or a weakness in the letter (no "this is not proof of…", "the merchant does not rely on…", "supporting context only"). If a piece of evidence is weak, give it less space; do not apologise for it.

NEVER
- Say where the parcel was delivered, or that the cardholder personally received, signed for, or has the goods. Do not use the word "address" at all except in the exact phrase "the email address on the order".
- Say records "independently" corroborate each other; one carrier event shown in several places is one piece of evidence.
- Comment on the cardholder's honesty, motives or intentions, or argue from something that did NOT happen (no complaint, no return, no contact).
- Say when a record was created, made or generated. Speak only of when the carrier recorded delivery.
- Use: irrefutable, undeniable, definitive, conclusively, baseless, fraudulent, invalid, undelivered.

COPY RULES (the page already shows these facts — the prose must not repeat them)
- No order number (the page header has it). Say "the order".
- No tracking number, no URL, no times of day (the shipment card has them).
- No amounts or numbers from the line-items table.
- No calendar dates: the headline, the shipment card and the timeline carry every date. Refer to events ("the delivery", "the dispute"). The 75-day interval (C6) is not a date and should be stated.
- The point that the delivery preceded the dispute is made ONCE, in chronologyArgument only.
- Each ledger claim is argued in ONE section; the summary and conclusion may point to it, never restate its details.
- Name the carrier at most once in the whole letter; afterwards "the carrier".
- No two sentences may make the same point, in any section. Before you finish, reread the whole letter and delete any sentence that repeats an earlier one in other words.
- The letter already opens with this headline, printed above your summary — do not repeat it: "Stallion Express recorded the shipment for this order as delivered on 6 July 2026; the dispute was opened on 19 September 2026."
- The conclusion is followed by a fixed request line ("The merchant respectfully requests reversal of the CAD 120.75 chargeback.") — do not write a request yourself.

SECTIONS (the layout is fixed; each section sits next to evidence the reader can see)
- executiveSummary: exactly 2 sentences. Sentence 1: the merchant's position. Sentence 2: why the claim fails IN FULL — the carrier recorded delivery of the one shipment that held the entire order. Do NOT mention the tracking link, checking with the carrier, or "not the merchant's record" here: those points belong to fulfillmentArgument.
- fulfillmentArgument: printed under the shipment card (carrier, tracking, shipped, delivered). 2 short paragraphs: why the carrier's record answers a non-receipt claim; that it can be checked with the carrier.
- lineItemsArgument: printed under the line-items table. 1 paragraph: the delivery covers the complete order and the full amount disputed.
- chronologyArgument: printed above the dated timeline. ONE paragraph. Build it around C6 as a single connected point: the carrier recorded delivery, a delivery notification was sent to the email address on the order that same day, and the dispute came 75 days later. The shipping confirmation (C7) may be mentioned in a short clause, or left out. End on the interval, stated as a fact, not with commentary about the timeline. A model of the shape (write your own words): "The carrier recorded the delivery and a delivery notification was sent to the email address on the order that same day; the non-receipt claim was raised 75 days later."
- conclusion: 2 sentences pulling the argument together (the carrier record + the complete-order mapping), ending on why reversal follows. Do NOT mention timing, the dispute date or the 75 days here — chronologyArgument made that point. No request sentence.
Total: 200–280 words.

OUTPUT: JSON only, no prose outside it:
{"executiveSummary":[{"text":"...","claims":["C1"]}], "fulfillmentArgument":[...], "lineItemsArgument":[...], "chronologyArgument":[...], "conclusion":[...]}
Each array item is ONE sentence. Mark a paragraph break by starting a sentence's text with "\\n".`;

type Sentence = { text: string; claims: string[] };
type Draft = Record<"executiveSummary" | "fulfillmentArgument" | "lineItemsArgument" | "chronologyArgument" | "conclusion", Sentence[]>;

async function callModel(user: string): Promise<string> {
  if (MODEL.startsWith("gpt")) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: unknown };
    if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body.error)}`);
    return body.choices?.[0]?.message?.content ?? "";
  }
  const res = await fetch("https://dev.disputedesk.app/api/public/pilot-inr-letter", {
    method: "POST",
    headers: { "x-pilot-token": fs.readFileSync(TOKEN_FILE, "utf8").trim(), "content-type": "application/json" },
    body: JSON.stringify({ system: SYSTEM, user, model: MODEL }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  const body = JSON.parse(text) as { content?: Array<{ text?: string }> };
  return body.content?.map((c) => c.text ?? "").join("") ?? "";
}

const parse = (raw: string) => JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Draft;

/* ── 3. Whitelist + copy checks ── */
function checkDraft(d: Draft): string[] {
  const ids = new Set(LEDGER.map((c) => c.id));
  const problems: string[] = [];
  for (const [k, sentences] of Object.entries(d)) {
    for (const s of sentences) {
      if (!Array.isArray(s.claims) || s.claims.length === 0) problems.push(`${k}: no claim cited — "${s.text}"`);
      for (const c of s.claims ?? []) if (!ids.has(c)) problems.push(`${k}: unknown claim ${c}`);
      if (/352543|260702441A|\b\d{1,2}:\d{2}\b|CAD|\d+\.\d{2}/.test(s.text)) problems.push(`${k}: copy rule (number from the page) — "${s.text}"`);
    }
  }
  const all = Object.values(d).flat().map((s) => s.text).join(" ");
  if (/\b\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December)\b/.test(all)) problems.push("copy rule: a calendar date is stated");
  const before = (all.match(/before (the|any) (dispute|claim)|predates? (the|any) (dispute|claim)|preceded (the|any) (dispute|claim)/gi) ?? []).length;
  if (before > 1) problems.push(`copy rule: the delivery-before-dispute point is made ${before} times`);
  if (/independent/i.test(all)) problems.push('never: "independent"');
  if (/not (treated|regarded|relied on) as|not (itself )?proof|does not rely|context only/i.test(all)) problems.push("never: a printed limit or disclaimer");
  if (/undelivered|not delivered/i.test(all)) problems.push('never: "undelivered" / "not delivered"');
  if (/\b(informed|aware|knew|kept .{0,20}updated)\b/i.test(all)) problems.push("limit: emails were SENT — never informed/aware/knew");
  if (/record (was )?(created|made|generated)|(created|made|generated) (the )?record/i.test(all)) problems.push("never: when a record was created");
  if ((all.match(/Stallion/g) ?? []).length > 1) problems.push("carrier named more than once");
  return problems;
}

const join = (ss: Sentence[]) =>
  ss.map((s) => s.text).join(" ").replace(/\s*(\\n|\n)+\s*/g, "\n\n").trim();

const facts = [
  {
    id: "f-dp", category: "delivery_proof", label: "Delivery", strength: "strong", bankEligible: true,
    value: {
      proofType: "delivered_confirmed", carrier: "Stallion Express", trackingNumber: "260702441A",
      trackingUrl: "https://stallionexpress.ca/track/?tracking=260702441A", deliveredAt: "2026-07-06T19:53:02Z",
    },
  },
] as unknown as EvidenceFact[];

const rec = (text: string) => ({ text, usedFactIds: text ? ["f-dp"] : [], source: "record" as const });
function toNarrative(d: Draft): DefenceNarrativeOutput {
  return {
    executiveSummary: rec(join(d.executiveSummary)),
    transactionOverviewArgument: rec(join(d.lineItemsArgument)),
    chronologyArgument: rec(join(d.chronologyArgument)),
    paymentAuthenticationArgument: { text: "", usedFactIds: [] },
    fulfillmentArgument: rec(`${join(d.fulfillmentArgument)}\n\nCarrier tracking record: https://stallionexpress.ca/track/?tracking=260702441A`),
    communicationArgument: { text: "", usedFactIds: [] },
    policyArgument: { text: "", usedFactIds: [] },
    manualEvidenceArgument: { text: "", usedFactIds: [] },
    conclusion: rec(join(d.conclusion)),
    omittedSections: [
      { sectionKey: "paymentAuthenticationArgument", reason: "n/a" },
      { sectionKey: "communicationArgument", reason: "n/a" },
      { sectionKey: "policyArgument", reason: "n/a" },
      { sectionKey: "manualEvidenceArgument", reason: "n/a" },
    ],
    warnings: [],
  };
}

// The production safety net still runs: INR bans, claim guards, delivery-vs-dispute truth.
function validate(n: DefenceNarrativeOutput) {
  return validateNarrative({
    narrative: n,
    approvedFacts: facts,
    reasonCodeModule: resolveReasonCodeModuleForContext(null, "PRODUCT_NOT_RECEIVED"),
    packageMode: "full",
    internalOnlyFactIds: [],
    extraHardPhrases: item_not_received.prohibitedBankPhrases,
    guardedPhrases: item_not_received.guardedBankPhrases,
    internalConstraints: { ...NO_INTERNAL_CONSTRAINTS, deliveryPostDatesDispute: deliveryPostDatesDispute(facts, "2026-09-19T02:33:38Z") },
  });
}

/* ── 4. Generate, check, ONE corrective retry (as production does) ── */
const BASE_USER = "Write the argument sections for this case.";
let raw = await callModel(BASE_USER);
let draft = parse(raw);
let narrative = toNarrative(draft);
let issues = [...checkDraft(draft), ...validate(narrative).errors.map((e) => `${e.section}: ${e.message}`)];
const firstIssues = issues;
if (issues.length) {
  raw = await callModel(
    `${BASE_USER}\n\nYour previous draft was rejected. Fix exactly these problems and change nothing else:\n${issues.join("\n")}\n\nPrevious draft:\n${raw}`,
  );
  draft = parse(raw);
  narrative = toNarrative(draft);
  issues = [...checkDraft(draft), ...validate(narrative).errors.map((e) => `${e.section}: ${e.message}`)];
}

const timelineEvents = [
  { at: "2026-07-02T05:33:17Z", text: "[Cardholder Name] placed this order on Online Store (checkout #44522904158401)." },
  { at: "2026-07-02T05:33:18Z", text: "A $120.75 CAD payment was processed using a Visa ending in 3627 via Apple Pay." },
  { at: "2026-07-02T16:22:00Z", text: "Stallion marked 3 items as fulfilled from Canada." },
  { at: "2026-07-02T16:22:05Z", text: "Stallion sent a shipping confirmation email to [Cardholder Name] (cardholder@example.com)." },
  { at: "2026-07-06T19:53:10Z", text: "Stallion sent a shipment delivered email to [Cardholder Name] (cardholder@example.com)." },
  { at: "2026-07-06T19:53:02Z", text: "Carrier recorded the shipment as delivered." },
  { at: "2026-09-19T02:52:00Z", text: "The customer opened a chargeback totaling $120.75 CAD." },
];
const lineItems = [
  { description: "Superbalm Tripeptide-1 Lip Tint in Wild Plum", quantity: 1, price: "CAD 24.50" },
  { description: "Blume Buds Power Patches for Acne", quantity: 1, price: "CAD 23.00" },
  { description: "Clear Skin Kit: Acne Essentials", quantity: 1, price: "CAD 98.00" },
  { description: "Discount", quantity: 0, price: "CAD -47.50", kind: "adjustment" as const },
  { description: "Shipping", quantity: 0, price: "CAD 10.00", kind: "adjustment" as const },
  { description: "Tax", quantity: 0, price: "CAD 12.75", kind: "adjustment" as const },
];
const composedBlocks = composePdfBlocks({
  narrative, approvedFacts: facts, packageMode: "full", familyKey: "item_not_received",
  moduleKey: "inr_product_not_received", fulfillmentStatus: "FULFILLED",
  caseContext: { orderName: "#352543", disputeOpenedAt: "2026-09-19T02:33:38Z", disputedAmount: "CAD 120.75" },
});
fs.writeFileSync(`${OUT}.json`, JSON.stringify({
  meta: {
    packageId: `pilot-${MODEL}`, disputeGid: "gid://shopify/ShopifyPaymentsDispute/11213897921", orderName: "#352543",
    reasonCode: "PRODUCT_NOT_RECEIVED", reasonCodeDisplay: "Visa 13.1", claimType: "Item not received claim",
    reasonCodeModuleKey: "inr_product_not_received", reasonCodeFamilyKey: "item_not_received",
    shopName: "blume-box", merchantName: "Blume", amountDisplay: "CAD 120.75", cardNetwork: "Visa",
    cardLast4: "3627", paymentGateway: "Shopify Payments", financialStatus: "PAID", fulfillmentStatus: "FULFILLED",
    cardholderName: "[Cardholder Name]", transactionDate: "2026-07-02T05:33:17Z", timelineEvents,
    lineItemsFromContext: lineItems, generatedAt: new Date().toISOString(), version: 1,
  },
  composedBlocks, approvedFacts: facts, manualEvidence: [],
}));
fs.writeFileSync(`${OUT}.report.txt`, [
  `MODEL: ${MODEL}`,
  `FIRST DRAFT: ${firstIssues.length ? firstIssues.join(" | ") : "clean"}`,
  `FINAL: ${issues.length ? issues.join(" | ") : "clean"}`,
  "",
  ...Object.entries(draft).map(([k, ss]) => `## ${k}\n` + ss.map((s) => `  [${s.claims.join(",")}] ${s.text}`).join("\n")),
].join("\n"));
console.log(`${MODEL}: ${issues.length ? "ISSUES " + issues.length : "clean"}`);
