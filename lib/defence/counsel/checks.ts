/**
 * Code checks on a counsel draft (plan 4 §6). A draft that fails gets one
 * corrective retry with these exact findings; a draft that fails twice is
 * discarded, and the letter falls back to the record-built template.
 *
 *   1. shape      — allowed section keys, known claim ids
 *   2. grounding  — every date and number comes from a ledger claim's specifics
 *   3. copy       — no identifier the page already shows; each specific once;
 *                   merchant and carrier named at most once
 *   4. lint       — the anti-patterns that sank earlier drafts
 *   5. truth      — the production validator (INR bans, claim guards,
 *                   delivery-vs-dispute), unchanged
 */

import { validateNarrative } from "../validateNarrative";
import { resolveReasonCodeModuleForContext } from "../reasonCodes/registry";
import { item_not_received } from "../reasonCodes/families/item_not_received";
import { deliveryPostDatesDispute, NO_INTERNAL_CONSTRAINTS } from "../internalConstraints";
import type { DefenceNarrativeOutput, EvidenceFact, NarrativeSection } from "../types";
import type { CounselDraft, EvidenceSectionKey, LedgerClaim, Playbook } from "./types";

export interface CheckContext {
  ledger: readonly LedgerClaim[];
  playbook: Playbook;
  facts: readonly EvidenceFact[];
  disputeOpenedAt: string | null;
  merchantName: string;
  carrierName: string | null;
  /** Identifiers the page already prints: order number, tracking number, card digits, amount. */
  pageIdentifiers: string[];
  trackingUrl: string | null;
}

const MONTH = "(?:January|February|March|April|May|June|July|August|September|October|November|December)";
const NUM_WORDS = [
  "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen",
  "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty",
  "fifty", "sixty", "seventy", "eighty", "ninety",
];
const NUM_WORD_RE = new RegExp(`\\b(?:${NUM_WORDS.join("|")})(?:-(?:one|two|three|four|five|six|seven|eight|nine))?\\b`, "gi");

/** The concrete specifics in a text: dates, digit numbers, number words (2+). */
export function specificsIn(text: string): string[] {
  const out: string[] = [];
  const t = text.replace(new RegExp(`\\b(\\d{1,2}) (${MONTH})(?: \\d{4})?\\b`, "g"), (_, d, m) => {
    out.push(`${d} ${m}`);
    return " ";
  });
  for (const m of t.matchAll(/\b\d+(?:[.,]\d+)?\b/g)) out.push(m[0]);
  // Number words are facts only when they count something ("sixty-one days",
  // "three purchased items"); "three records" is rhetoric.
  for (const m of t.matchAll(NUM_WORD_RE)) {
    const after = t.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 40);
    if (/^\s+(?:[\w-]+\s+){0,2}?(?:days?|weeks?|months?|items?|orders?|parcels?|shipments?|products?)\b/i.test(after)) {
      out.push(m[0].toLowerCase());
    }
  }
  return out;
}

const LINT: Array<[RegExp, string]> = [
  [/\b(?:position is that|submits that|contends that|respectfully submits|wishes to)\b/i, "throat-clearing"],
  [/\bsame card\b/i, "overstated: Shopify shows brand, last four digits and wallet; say 'a card ending in the same four digits'"],
  [/\b(?:makes sense only|only makes sense|would not have|would never|must have (?:known|received)|knew|intended)\b/i, "speculation about what the cardholder thought or intended"],
  [/\bstands? between\b/i, "figurative framing (reads as if it blocks the merchant's request)"],
  [/\b(?:at the threshold|coherent foundation|nothing to stand on|cannot survive|survives? it|is what it is|falls apart|holds no water|leaves? no room)\b/i, "a metaphor or legal flourish; say it plainly"],
  [/\b(?:two|three|four|five) (?:records|facts|things|points|pieces of evidence|reasons)\b/i, "an announced count; say the points instead"],
  [/\b(?:this distinction matters|is material|it is worth noting|it should be noted|notably)\b/i, "meta-talk"],
  [/\b(?:decisive(?:ly)?|straightforward|compelling|clearly|plainly shows|fails in full)\b/i, "adjective in place of evidence"],
  [/\b(?:take the merchant'?s word|word for it|without relying on (?:any )?(?:representation|document))\b/i, "defensive framing"],
  [/\b(?:not (?:itself )?proof|is not proof|not treated as|does not rely|context only|supporting context)\b/i, "printed limit or disclaimer"],
  [/\b(?:linked (?:order|records)|delivery event|fulfilment mapping|data point)\b/i, "abstraction"],
  [/\b(?:irrefutabl\w*|undeniabl\w*|definitive(?:ly)?|conclusively|baseless|fraudulent|invalid|undelivered)\b/i, "banned word"],
  [/\b(?:independent(?:ly)?|corroborat\w*)\b/i, "independence claim"],
  [/\b(?:did not|never) (?:complain|contact|reach out|return|report)\w*\b/i, "absence argument"],
  [/\b(?:too late|out of time|time[- ]barred|late claim)\b/i, "lateness under network rules"],
  [/\b(?:informed|aware|knew|kept .{0,20}updated)\b/i, "an email was sent, not read"],
  [/\b(?:consistent with|normal|typical|usual|standard|expected|as promised|on time)\b/i, "a characterisation no record supports"],
  [/\baddress\b(?! on the order)/i, "the word 'address' outside 'the email address on the order'"],
];

const DELIVERY_WORDS = /\b(?:deliver\w*|receiv\w*|reach\w*|arriv\w*|destination|left at|dropped|handed)\b/i;

/**
 * An address sentence the ledger authorises (claimLedger.ts `addressClaims`):
 * "the shipping address is the same as / identical to / matches the billing
 * address", and — with `billing_address_verified` — the issuer's address
 * check matching the billing address. Never a sentence about where the parcel
 * was delivered.
 */
export function isAllowedAddressSentence(sentence: string, ledger: readonly LedgerClaim[]): boolean {
  if (!/\baddress/i.test(sentence) || DELIVERY_WORDS.test(sentence)) return false;
  const ids = new Set(ledger.map((c) => c.id));
  const matchesBilling =
    /\bshipping address\b/i.test(sentence) &&
    /\bbilling address\b/i.test(sentence) &&
    /\b(?:same as|identical to|matche[sd]|match)\b/i.test(sentence);
  const avs = /\baddress (?:check|verification)\b|\bAVS\b/i.test(sentence) && /\bbilling address\b/i.test(sentence);
  if (avs) return ids.has("billing_address_verified") && ids.has("shipping_matches_billing");
  return matchesBilling && ids.has("shipping_matches_billing");
}

/** Text with the authorised address sentences removed. */
function withoutAllowedAddressSentences(text: string, ledger: readonly LedgerClaim[]): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !isAllowedAddressSentence(s, ledger))
    .join(" ");
}

type Where = "headline" | "summary" | EvidenceSectionKey | "conclusion";

function parts(d: CounselDraft): Array<{ where: Where; text: string; claimIds: string[] }> {
  return [
    { where: "summary", text: (d.summary?.paragraphs ?? []).join(" "), claimIds: d.summary?.claimIds ?? [] },
    ...(d.evidenceSections ?? []).map((s) => ({ where: s.key as Where, text: (s.paragraphs ?? []).join(" "), claimIds: s.claimIds ?? [] })),
    { where: "conclusion", text: (d.conclusion?.paragraphs ?? []).join(" "), claimIds: d.conclusion?.claimIds ?? [] },
  ];
}

export function checkDraft(d: CounselDraft, ctx: CheckContext): string[] {
  const issues: string[] = [];
  const byId = new Map(ctx.ledger.map((c) => [c.id, c]));
  const allowedKeys = new Set(ctx.playbook.sections.map((s) => s.key));

  // 1. shape
  const seenKeys = new Set<string>();
  for (const s of d.evidenceSections ?? []) {
    if (!allowedKeys.has(s.key)) issues.push(`shape: section "${s.key}" is not in the playbook`);
    if (seenKeys.has(s.key)) issues.push(`shape: section "${s.key}" appears twice`);
    seenKeys.add(s.key);
  }
  const P = parts(d);
  for (const p of P) for (const id of p.claimIds) if (!byId.has(id)) issues.push(`${p.where}: unknown claim "${id}"`);

  // 2. grounding: every date and number must be a specific of a ledger
  // claim. Checked against the whole ledger: the per-section claimIds are for
  // traceability (plan 4 §5), not a second gate that fails true numbers.
  const allowed = new Set<string>();
  for (const c of ctx.ledger) {
    for (const v of Object.values(c.specifics)) {
      for (const s of specificsIn(v)) allowed.add(s.toLowerCase());
      // A specific is often a bare value ("sixty-one", "4"): allow it as is.
      for (const m of v.toLowerCase().matchAll(NUM_WORD_RE)) allowed.add(m[0]);
    }
  }
  for (const p of P) {
    for (const s of specificsIn(p.text)) {
      if (!allowed.has(s.toLowerCase())) issues.push(`${p.where}: "${s}" is not a specific of any ledger claim`);
    }
  }

  // 3. copy
  const all = P.map((p) => p.text).join("\n");
  for (const id of ctx.pageIdentifiers) {
    if (id && all.includes(id)) issues.push(`copy: "${id}" is already printed on the page`);
  }
  if (ctx.trackingUrl && all.includes(ctx.trackingUrl)) issues.push("copy: the tracking URL is already printed");
  if (/\b\d{1,2}:\d{2}\b/.test(all)) issues.push("copy: a time of day");
  const count = (needle: string) => (needle ? all.split(needle).length - 1 : 0);
  if (count(ctx.merchantName) > 1) issues.push(`copy: "${ctx.merchantName}" is named ${count(ctx.merchantName)} times (at most once)`);
  // Never the carrier's brand in the prose (maintainer): the card prints it.
  if (ctx.carrierName && count(ctx.carrierName) > 0) {
    issues.push(`copy: the carrier's name "${ctx.carrierName}" appears in the text; write "the carrier"`);
  }
  // Executive summary = the whole defence in brief, ending with the request
  // (maintainer, 2026-09-25). The headline is the contrast only: no dates or
  // numbers, so the two never compete. The conclusion is optional and short.
  const headlineText = P.find((p) => p.where === "headline")?.text ?? "";
  const summaryText = P.find((p) => p.where === "summary")?.text ?? "";
  const conclusionText = P.find((p) => p.where === "conclusion")?.text ?? "";
  const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
  if (specificsIn(headlineText).length) issues.push(`headline: no dates or numbers (found ${specificsIn(headlineText).join(", ")}); the summary carries them`);
  if (words(headlineText) > 30) issues.push(`headline: at most 30 words (has ${words(headlineText)})`);
  if (words(summaryText) > 80) {
    issues.push(
      `summary: ${words(summaryText)} words, the limit is 80 — cut at least ${words(summaryText) - 75} words. ` +
        "Drop a supporting detail (a notification, how fast it shipped) or a clause that restates another; keep the claim, " +
        "the delivery, the later order, the sentence tying them to the claim, and the request.",
    );
  }
  if (!/\brevers/i.test(summaryText)) issues.push("summary: must end with the request to reverse the chargeback");
  // The conclusion is a closing argument (Grok review, maintainer
  // 2026-09-25): the two strongest facts restated WITHOUT dates or numbers,
  // then "not supported by the record". The fixed request line follows it.
  if (!conclusionText.trim()) issues.push("conclusion: required — restate the two strongest facts (no dates or numbers), then say the claim is not supported by the record");
  if (specificsIn(conclusionText).length) issues.push(`conclusion: no dates or numbers (found ${specificsIn(conclusionText).join(", ")}); refer to the events`);
  if (words(conclusionText) > 45) issues.push(`conclusion: at most 45 words (has ${words(conclusionText)})`);
  if (/\brevers/i.test(conclusionText)) issues.push("conclusion: no request — the fixed request line follows it");
  // Shipping spells out the whole order in one shipment (Grok review).
  const shippingText = P.find((p) => p.where === "shipping")?.text ?? "";
  const whole = ctx.ledger.find((c) => c.id === "whole_order_in_shipment");
  const countWord = whole?.specifics.itemCountWord ?? "";
  if (whole && !(shippingText.toLowerCase().includes(countWord) && /\bshipment\b/i.test(shippingText))) {
    issues.push(`shipping: must state outright that all ${whole.specifics.itemCountWord} items were in this single tracked shipment, with no partial or second shipment`);
  }
  void sentences;
  // Distinctive phrases, like specifics, appear at most twice in the letter.
  for (const phrase of ["same four digits", "same apple pay wallet", "public tracking page", "not a merchant document", "not the merchant's"]) {
    const n = P.filter((p) => p.where !== "conclusion").map((p) => p.text).join("\n").toLowerCase().split(phrase).length - 1;
    if (n > 2) issues.push(`copy: "${phrase}" is used ${n} times; at most twice`);
  }
  // Each date and number ONCE in the letter (maintainer: "each fact stated
  // once"). Elsewhere refer to the event: "the delivery", "that order".
  const uses = new Map<string, Where[]>();
  for (const p of P) {
    for (const s of specificsIn(p.text)) {
      const k = s.toLowerCase();
      uses.set(k, [...(uses.get(k) ?? []), p.where]);
    }
  }
  for (const [s, where] of uses) {
    if (where.length > 1) issues.push(`copy: "${s}" is used ${where.length} times (${where.join(", ")}); once only — elsewhere refer to the event ("the delivery", "that order")`);
  }
  // The exhibits' positions: prose prints ABOVE the timeline and the tracking
  // link prints below the shipping prose.
  for (const p of P) {
    const m = p.text.match(/\b(?:timeline|table|chronology) above\b|\babove(?: the| this)? (?:timeline|table|chronology)\b/i);
    if (m) issues.push(`${p.where}: "${m[0]}" — the timeline and the table print BELOW the text; say "the timeline below" or just "the timeline"`);
  }

  // 4. lint
  for (const p of P) {
    const text = withoutAllowedAddressSentences(p.text, ctx.ledger);
    for (const [re, name] of LINT) {
      const m = text.match(re);
      if (m) issues.push(`${p.where}: ${name} — "${m[0]}"`);
    }
  }

  // 5. truth: the production validator, unchanged. The authorised address
  // sentences are taken out first: its address-delivery detector reads any
  // "shipping address" sentence as a delivery claim, and these are not one.
  const strip = (s: { paragraphs: string[] } | undefined) =>
    s && { ...s, paragraphs: (s.paragraphs ?? []).map((t) => withoutAllowedAddressSentences(t, ctx.ledger)) };
  const forTruth: CounselDraft = {
    ...d,
    summary: strip(d.summary) as CounselDraft["summary"],
    evidenceSections: (d.evidenceSections ?? []).map((s) => strip(s) as CounselDraft["evidenceSections"][number]),
    conclusion: strip(d.conclusion) as CounselDraft["conclusion"],
  };
  const n = toNarrative(forTruth, ctx.facts.map((f) => f.id));
  const res = validateNarrative({
    narrative: n,
    approvedFacts: ctx.facts as EvidenceFact[],
    reasonCodeModule: resolveReasonCodeModuleForContext(null, "PRODUCT_NOT_RECEIVED"),
    packageMode: "full",
    internalOnlyFactIds: [],
    extraHardPhrases: item_not_received.prohibitedBankPhrases,
    guardedPhrases: item_not_received.guardedBankPhrases,
    internalConstraints: {
      ...NO_INTERNAL_CONSTRAINTS,
      deliveryPostDatesDispute: deliveryPostDatesDispute(ctx.facts as EvidenceFact[], ctx.disputeOpenedAt),
    },
  });
  for (const e of res.errors) issues.push(`truth (${e.section}): ${e.message}`);

  return [...new Set(issues)];
}

/**
 * The draft as a DefenceNarrativeOutput. Evidence sections map onto the
 * existing slots: shipping → fulfillmentArgument, lineItems →
 * transactionOverviewArgument (printed under the line-items table),
 * chronology → chronologyArgument. Every section is record-sourced so the
 * family deny list lets it through (sectionVisibility.ts).
 */
export function toNarrative(
  d: CounselDraft,
  factIds: string[],
  trackingLinkLine?: string | null,
  ledger: readonly LedgerClaim[] = [],
): DefenceNarrativeOutput {
  const sec = (paragraphs: string[] | undefined): NarrativeSection => {
    const text = (paragraphs ?? []).map((p) => p.trim()).filter(Boolean).join("\n\n");
    return { text, usedFactIds: text ? factIds : [], source: "record" };
  };
  const ev = (key: EvidenceSectionKey) => d.evidenceSections?.find((s) => s.key === key)?.paragraphs;
  const shipping = sec(ev("shipping"));
  if (shipping.text && trackingLinkLine) shipping.text = `${shipping.text}\n\n${trackingLinkLine}`;
  const empty: NarrativeSection = { text: "", usedFactIds: [] };
  const narrative: DefenceNarrativeOutput = {
    // Empty, not absent: suppresses the templated pull-quote (one summary only).
    headline: "",
    executiveSummary: sec(d.summary?.paragraphs),
    transactionOverviewArgument: sec(ev("lineItems")),
    chronologyArgument: sec(ev("chronology")),
    paymentAuthenticationArgument: empty,
    fulfillmentArgument: shipping,
    communicationArgument: empty,
    policyArgument: empty,
    manualEvidenceArgument: empty,
    conclusion: sec(d.conclusion?.paragraphs),
    omittedSections: [],
    warnings: [],
  };
  // The addresses are printed whenever the ledger holds the match, whether or
  // not the prose mentions it: the exhibit is the evidence.
  const addresses = ledger.find((c) => c.addressExhibit)?.addressExhibit;
  if (addresses) narrative.addressExhibit = addresses;
  const later = ledger.find((c) => c.laterOrderExhibit)?.laterOrderExhibit;
  if (later) narrative.laterOrderExhibit = later;
  for (const k of [
    "transactionOverviewArgument", "chronologyArgument", "paymentAuthenticationArgument", "fulfillmentArgument", "conclusion",
    "communicationArgument", "policyArgument", "manualEvidenceArgument",
  ] as const) {
    if (!narrative[k].text) narrative.omittedSections.push({ sectionKey: k, reason: "Not part of this letter's argument." });
  }
  return narrative;
}
