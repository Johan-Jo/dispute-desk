/**
 * Code checks on a counsel draft (plan 4 §6). The summary is the model's; the
 * sections and the conclusion are code-written (recordSections.ts) and must
 * pass the same checks, which the tests pin. A summary that fails gets one
 * corrective retry with these exact findings; if that fails too, the letter
 * falls back to the record-built template.
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
import { product_not_as_described } from "../reasonCodes/families/product_not_as_described";
import { requestLine, requestPattern, wrongFrameWords, type DisputeFrame } from "./frame";
import type { Brief } from "./briefs";
import { getFamily } from "../reasonCodes/familyRegistry";
import type { ReasonCodeFamilyKey } from "../types";
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
  /** Multi-parcel: every parcel's carrier (none may be named in the prose). */
  carrierNames?: string[];
  /** Product names the prose may quote: masked before the number, copy and
   *  style checks ("Sunburst Mineral SPF 50 Sunscreen" is not a number 50). */
  productNames?: string[];
  /** Who decides the dispute and at what stage: the request and the words
   *  for the proceeding (frame.ts). Absent = a card chargeback. */
  frame?: DisputeFrame;
  /** Store titles the summary may NOT use (not-as-described: English only,
   *  never the product's store name — maintainer, 2026-09-28). */
  forbiddenTitles?: string[];
  /** Names the English check allows (merchant, customer). */
  allowedNames?: string[];
  /** The single writer (plan rev 8): every part is model-written, so every
   *  check runs on every part; the brief's sections and limits apply. */
  brief?: Brief;
}

/** Function words of the other five active locales. One is enough to fail:
 *  "Do not mix German into the dispute letter" (maintainer, 2026-09-28). */
const NON_ENGLISH_WORDS = new Set([
  "und", "mit", "für", "der", "das", "ist", "nicht", "oder", "auf", "eine", "einer", "wird", "zur", "vom",
  "och", "för", "att", "det", "som", "inte", "eller", "med",
  "avec", "pour", "les", "une", "dans", "sur", "pas", "est",
  "con", "para", "los", "las", "una", "por", "del", "que",
  "com", "uma", "não", "dos", "das",
]);

/** English-only issues in model-written text (exported for tests). */
export function englishOnlyIssues(text: string, forbiddenTitles: readonly string[] = [], allowedNames: readonly string[] = []): string[] {
  const issues: string[] = [];
  let t = text;
  for (const n of allowedNames.filter(Boolean)) t = t.split(n).join(" ");
  const lower = t.toLowerCase();
  for (const title of forbiddenTitles) {
    for (const seg of title.split(/[|,;()–—]+|\s-\s/).map((x) => x.trim()).filter((x) => x.length >= 6 && /\p{L}/u.test(x))) {
      if (lower.includes(seg.toLowerCase())) issues.push(`english: the product's store title ("${seg}") — call it "the item"`);
    }
  }
  // Typographic punctuation and the multiplication, euro and pound signs are English.
  const foreignLetters = t.match(/[^\x00-\x7F\u2018\u2019\u201C\u201D\u2013\u2014\u2026\u00A0\u00D7\u20AC\u00A3]/g);
  if (foreignLetters) issues.push(`english: non-English characters (${[...new Set(foreignLetters)].join(" ")})`);
  for (const w of t.toLowerCase().match(/\p{L}+/gu) ?? []) {
    if (NON_ENGLISH_WORDS.has(w)) {
      issues.push(`english: non-English word "${w}"`);
      break;
    }
  }
  return [...new Set(issues)];
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
  [/\b(?:instead|rather than|without first|chose|opted|bypass(?:ed)?|skipped|never tried)\b/i, "a statement about the customer's choice (plan §4.1)"],
  [/\bon this page\b|\bon the (?:next|previous|following) page\b/i, "page position: exhibits are \"below\" or \"above\", never a page"],
  [/\b(?:too late|out of time|time[- ]barred|late claim)\b/i, "lateness under network rules"],
  [/\b(?:informed|aware|knew|kept .{0,20}updated)\b/i, "an email was sent, not read"],
  [/\b(?:consistent with|normal|typical|usual|standard|expected|as promised|on time)\b/i, "a characterisation no record supports"],
  [/\baddress\b(?! on the order)/i, "the word 'address' outside 'the email address on the order'"],
];

type Where = "summary" | EvidenceSectionKey | "conclusion";

function parts(d: CounselDraft, productNames: readonly string[] = []): Array<{ where: Where; text: string; claimIds: string[] }> {
  // Longest first, so a name that contains another is masked whole.
  const names = [...productNames].filter(Boolean).sort((a, b) => b.length - a.length);
  const mask = (t: string) => names.reduce((x, n) => x.split(n).join("the product"), t);
  return [
    { where: "summary", text: mask((d.summary?.paragraphs ?? []).join(" ")), claimIds: d.summary?.claimIds ?? [] },
    ...(d.evidenceSections ?? []).map((s) => ({ where: s.key as Where, text: mask((s.paragraphs ?? []).join(" ")), claimIds: s.claimIds ?? [] })),
    { where: "conclusion", text: mask((d.conclusion?.paragraphs ?? []).join(" ")), claimIds: d.conclusion?.claimIds ?? [] },
  ];
}

/* A summary a few words over its limit is a style miss, not a wrong letter.
 * It is still reported, so the corrections try to fix it, but it does not
 * block the fact-check or, once the corrections have run, the letter
 * (#100705, 2026-09-29: a 92-word summary against a 90 limit cost the dispute
 * its only letter; #99296, 95/90, the same day). It is the fallback behind
 * the summary-only shortener in `writeLetter`. More than SUMMARY_SLACK_WORDS
 * over still blocks. */
export const SUMMARY_SLACK_WORDS = 10;
export const SUMMARY_OVER_PREFIX = "length: ";
export const isSoftLengthIssue = (issue: string): boolean => issue.startsWith(SUMMARY_OVER_PREFIX);

export function checkDraft(d: CounselDraft, ctx: CheckContext): string[] {
  const issues: string[] = [];
  const byId = new Map(ctx.ledger.map((c) => [c.id, c]));
  const allowedKeys = new Set<string>(ctx.brief ? ctx.brief.sections.map((s) => s.key) : ctx.playbook.sections.map((s) => s.key));

  // 1. shape
  const seenKeys = new Set<string>();
  for (const s of d.evidenceSections ?? []) {
    if (!allowedKeys.has(s.key)) issues.push(`shape: section "${s.key}" is not in the playbook`);
    if (seenKeys.has(s.key)) issues.push(`shape: section "${s.key}" appears twice`);
    seenKeys.add(s.key);
  }
  const P = parts(d, ctx.productNames);
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
  for (const name of new Set([ctx.carrierName, ...(ctx.carrierNames ?? [])].filter((x): x is string => !!x))) {
    if (count(name) > 0) issues.push(`copy: the carrier's name "${name}" appears in the text; write "the carrier"`);
  }
  // Executive summary = the whole defence in brief, ending with the request
  // (maintainer, 2026-09-25). The conclusion and the Shipping pair are
  // written by code (recordSections.ts), so they need no check here.
  const summaryText = P.find((p) => p.where === "summary")?.text ?? "";
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
  // A letter that argues three or more sections carries more reasons in its
  // summary (maintainer, 2026-09-28: the reasons must be stated); 90 words then.
  const summaryLimit = ctx.brief && (d.evidenceSections?.length ?? 0) >= 3 ? 90 : 80;
  if (words(summaryText) > summaryLimit) {
    issues.push(
      `${words(summaryText) - summaryLimit <= SUMMARY_SLACK_WORDS ? SUMMARY_OVER_PREFIX : ""}` +
        `summary: ${words(summaryText)} words, the limit is ${summaryLimit} — rewrite it to about ${summaryLimit - 15} words. ` +
        "Name the item in a few words (its kind, and colour or size only when they matter; the table below carries the full description); " +
        "drop a supporting detail (a notification, dispatch timing, a date that repeats an interval) or a clause that restates another; " +
        "keep the claim, each reason, and the request.",
    );
  }
  if (!(ctx.frame ? requestPattern(ctx.frame) : /\brevers/i).test(summaryText)) {
    issues.push(`summary: must end with the request: "${ctx.frame ? requestLine(ctx.frame) : "The merchant respectfully requests reversal of the chargeback."}"`);
  }
  // The proceeding's name (a PayPal inquiry is not a chargeback; #101111).
  const wrong = ctx.frame ? wrongFrameWords(ctx.frame) : null;
  if (wrong) {
    for (const p of P) {
      const m = p.text.match(wrong);
      if (m) issues.push(`${p.where}: "${m[0]}" misnames this proceeding; ${ctx.frame!.provider === "card" ? 'call it "the inquiry"' : 'call it "the dispute" and the person "the customer"'}`);
    }
  }
  // English only, and never the product's store name (maintainer, 2026-09-28).
  const familyKey = ctx.brief?.type ?? ctx.playbook.familyKey;
  const notAsDescribed = familyKey === "product_not_as_described";
  const modelParts = ctx.brief ? P : P.filter((p) => p.where === "summary");
  for (const part of modelParts) {
    for (const i of englishOnlyIssues(part.text, ctx.forbiddenTitles ?? [], [ctx.merchantName, ...(ctx.allowedNames ?? [])])) {
      issues.push(`${part.where}: ${i}`);
    }
  }
  if (ctx.brief) {
    // Recorded absence (plan §4.1): once in the whole letter, in a sentence of
    // its own, never beside a timing clause.
    const sentences = modelParts.flatMap((p) => p.text.split(/(?<=[.!?])\s+/).map((t) => ({ where: p.where, t })));
    const absences = sentences.filter((x) => /\bno (?:return|refund request)s?\b[^.]*\b(?:recorded|on record)\b|\bnot (?:been )?returned\b|\bhas not come back\b/i.test(x.t));
    if (absences.length > 1) issues.push(`copy: the recorded absence appears ${absences.length} times; state it once`);
    for (const a of absences) {
      if (/\b(?:days?|after|before|while|within|later|since|until|when)\b/i.test(a.t)) {
        issues.push(`${a.where}: the recorded absence shares a sentence with a timing clause — "${a.t}"`);
      }
    }
    // The brief's limits, where they can be checked mechanically.
    for (const l of ctx.brief.limits) {
      if (!l.pattern) continue;
      for (const part of modelParts) {
        const m = part.text.match(l.pattern);
        if (m) issues.push(`${part.where}: breaks the limit "${l.rule}" — "${m[0]}"`);
      }
    }
  } else if (notAsDescribed && /\breturn/i.test(summaryText)) {
    issues.push("summary: returns are written by code in the Delivery and return section; remove every mention of returns from the summary");
  }
  // "The complete order" is a claim: only the item-by-item fulfilment check
  // (whole_order_in_shipment) proves it (eval, #350764).
  const wholeOrder = summaryText.match(/\b(?:complete|entire|whole|full)\s+order\b|\ball (?:of )?the (?:items|goods|products)\b/i);
  if (wholeOrder && !byId.has("whole_order_in_shipment") && !byId.has("all_parcels_delivered")) {
    issues.push(`summary: "${wholeOrder[0]}" — the records do not show the whole order in one shipment; say "the order"`);
  }
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
  // Code-written sections state different facts by construction; a number
  // shared between two of them ("three items", "one to three days") is not a
  // repeat. The check is for the model's text.
  // Numbers inside the ordered item's own description ("3-in-1", "25 x 25 cm")
  // identify the item; the once-only rule is for dates, intervals and counts.
  const itemNumbers = new Set(
    ctx.ledger.flatMap((c) => (c.specifics.itemNumbers ?? "").split(/\s+/)).filter(Boolean).map((x) => x.toLowerCase()),
  );
  // A specific may appear twice when the second use is in its home section:
  // the brief section whose claims hold it (the return period in the policy
  // section). Anywhere else, once.
  const homeOf = (spec: string): Set<string> => {
    const owners = ctx.ledger
      .filter((c) => Object.values(c.specifics).some((v) => v.toLowerCase() === spec || specificsIn(v).map((x) => x.toLowerCase()).includes(spec)))
      .map((c) => c.id);
    return new Set((ctx.brief?.sections ?? []).filter((sec) => sec.claimIds.some((id) => owners.includes(id))).map((sec) => sec.key as string));
  };
  for (const [s, where] of uses) {
    if (itemNumbers.has(s)) continue;
    if (ctx.brief && where.length === 2 && where.includes("summary")) {
      const other = where.find((w) => w !== "summary")!;
      if (homeOf(s).has(other)) continue;
    }
    if (where.length > 1 && (ctx.brief || where.includes("summary"))) issues.push(`copy: "${s}" is used ${where.length} times (${where.join(", ")}); once only — elsewhere refer to the event ("the delivery", "that order")`);
  }
  // The exhibits' positions: prose prints ABOVE the timeline and the tracking
  // link prints below the shipping prose.
  for (const p of P) {
    const m = p.text.match(/\b(?:timeline|table|chronology) above\b|\babove(?: the| this)? (?:timeline|table|chronology)\b/i);
    if (m) issues.push(`${p.where}: "${m[0]}" — the timeline and the table print BELOW the text; say "the timeline below" or just "the timeline"`);
  }

  // 4. lint
  for (const p of P) {
    for (const [re, name] of LINT) {
      const m = p.text.match(re);
      if (m) issues.push(`${p.where}: ${name} — "${m[0]}"`);
    }
  }

  // 5. truth: the production validator, unchanged
  const n = toNarrative(d, ctx.facts.map((f) => f.id));
  const family = ctx.brief
    ? getFamily(ctx.brief.type as ReasonCodeFamilyKey) ?? getFamily("fallback" as ReasonCodeFamilyKey)
    : notAsDescribed ? product_not_as_described : item_not_received;
  const res = validateNarrative({
    narrative: n,
    approvedFacts: ctx.facts as EvidenceFact[],
    reasonCodeModule: resolveReasonCodeModuleForContext(null, notAsDescribed ? "PRODUCT_UNACCEPTABLE" : familyKey === "general" ? "GENERAL" : "PRODUCT_NOT_RECEIVED"),
    packageMode: "full",
    internalOnlyFactIds: [],
    extraHardPhrases: family.prohibitedBankPhrases,
    guardedPhrases: family.guardedBankPhrases,
    internalConstraints: {
      ...NO_INTERNAL_CONSTRAINTS,
      deliveryPostDatesDispute: deliveryPostDatesDispute(ctx.facts as EvidenceFact[], ctx.disputeOpenedAt),
      verifiedPolicyTerms: ctx.ledger.some((c) => c.id === "return_route_open"),
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
    policyArgument: sec(ev("policy")),
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
  const rows = ledger.flatMap((c) => (c.timelineEvent ? [c.timelineEvent] : []));
  if (rows.length) narrative.timelineAdditions = rows;
  for (const k of [
    "transactionOverviewArgument", "chronologyArgument", "paymentAuthenticationArgument", "fulfillmentArgument", "conclusion",
    "communicationArgument", "policyArgument", "manualEvidenceArgument",
  ] as const) {
    if (!narrative[k].text) narrative.omittedSections.push({ sectionKey: k, reason: "Not part of this letter's argument." });
  }
  return narrative;
}
