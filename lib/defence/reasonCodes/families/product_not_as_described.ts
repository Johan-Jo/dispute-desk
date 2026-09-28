/**
 * Family: product not as described / defective (Visa 13.3, MC 4853).
 *
 * Bank-side claim: the goods/service did not match the description or
 * were defective. Cross-module strategy is to state what was ordered, what
 * the records show, and any documented resolution — never a conclusion the
 * records cannot carry.
 *
 * v2 (2026-09-28, docs/plans/not-as-described-defence-package.plan.md PR 1,
 * maintainer decision D5). Nearly every letter in this family is `narrow`
 * (the critical `product_listing` category is never collected yet), and base
 * rule 10 then asked for hedged framing. The merchant's counsel does not
 * apologise for its own client: the overlay overrides that one instruction
 * for this family, while keeping narrow mode's other limits. What stays true:
 * a listing proves what was advertised, not what arrived, so no sentence may
 * say the delivered item matched the listing, was as described, or was free
 * of defects — no collected fact establishes that link today.
 */

import type { ReasonCodeFamily } from "../../types";

export const product_not_as_described: ReasonCodeFamily = {
  key: "product_not_as_described",
  displayName: "Product not as described or defective",
  moduleKeys: ["product_unacceptable"],
  unmodeledCodes: [],
  fallbackModuleKey: "product_unacceptable",
  // Describes the banned hedge without quoting it: `familyRegistry.test.ts`
  // fails any overlay that matches its own family's prohibited phrases.
  overlayPromptBody: [
    "Not-as-described family overlay:",
    "",
    "OVERRIDE OF RULE 10 FOR THIS FAMILY. When packageMode is \"narrow\", do NOT use hedged framing. No qualifying lead-ins about what the evidence or the records support, indicate or are consistent with, and no apologetic or tentative wording. State each supported fact plainly, in the merchant's favour. Everything else rule 10 says about \"narrow\" still applies: an executive summary of at most 4 sentences, and no declarative reason-code conclusions.",
    "",
    "WHAT THE RECORDS CAN AND CANNOT SHOW. The order record shows what the customer ordered: the items, the variants and the price. A product listing shows what the merchant advertised, not what arrived. A delivery record shows that the parcel arrived, not what it contained or its condition. So never assert that the delivered item agreed with the listing or its description, lacked defects, or arrived in a particular condition, and never date the listing to the purchase: the listing on record is the one retrieved when this response was prepared.",
    "",
    "STAY ON THE RECORD. Never describe the buyer's conduct by what it lacks (a return, contact with the merchant, evidence given to the bank): Shopify records only returns made through Shopify, and the bank's file is not in front of you. The only sentence about returns remains the one rule 8c permits. Never label the claim as lacking support. Two records of one carrier event are one record; never present them as confirming each other.",
    "",
    "The reason code names the cardholder's claim category. You may restate that claim (\"the cardholder states the item was not as described\"); never adopt it or concede it.",
  ].join("\n"),
  familyAvoid: [],
  prohibitedBankPhrases: [
    // 1. Rule-10 hedges (D5). "consistent with" alone stays legal.
    /\bthe\s+(?:available|submitted)\s+(?:evidence|records?)\s+(?:supports?|indicates?|suggests?|is\s+consistent\s+with|are\s+consistent\s+with)\b/i,
    // 2. Conformity conclusions the records cannot carry. Written as the
    //    merchant's assertion, so restating the claim ("the cardholder states
    //    the item was not as described") does not match.
    /\b(?:item|items|product|products|goods|merchandise|order|it|they)\s+(?:was|were|is|are)\s+(?:exactly\s+|precisely\s+)?as\s+(?:described|advertised|listed|pictured|shown)\b/i,
    /\bmatch(?:ed|es|ing)?\s+(?:the|its|their)\s+(?:product\s+)?(?:description|listing|advertisement)\b/i,
    /\bconform(?:ed|s|ing)?\s+to\s+(?:the|its|their)\b/i,
    /\b(?:was|were|is|are)\s+not\s+defective\b/i,
    /\bfree\s+(?:of|from)\s+(?:any\s+)?defects?\b/i,
    /\bin\s+(?:perfect|good|excellent|new|pristine|working)\s+condition\b/i,
    // 3. Provenance. The only listing on record is the current one.
    /\bat\s+the\s+time\s+of\s+(?:purchase|order|checkout|sale)\b/i,
    // 4. Delivery promises with no delivery-promise fact on record.
    /\bwithin\s+the\s+(?:expected|estimated|promised|advertised|stated)\s+(?:delivery\s+)?(?:timeframe|time\s*frame|window|period)\b/i,
    // 5. Payment-authentication signals answer who paid, not what arrived.
    //    Excluded structurally by the module's allow-list; this is the net.
    /\b(?:IP\s+address|AVS|CVV2?|CVC|3-?D\s*Secure|address\s+verification)\b/i,
    // 6. What the buyer did not do or submit. Shopify records only Shopify
    //    returns, and the issuer's file is not ours to see, so these are beyond
    //    the record. Found in the PR 1 comparison letters (#100411): "no
    //    product listing or customer communication evidence has been submitted
    //    to support the buyer's assertion", "The buyer has not, on the
    //    available record, engaged a return or resolution process".
    /\b(?:buyer|cardholder|customer|purchaser)\s+(?:has|have|had|did|does)\s*(?:not\b|n['’]t\b)/i,
    /\bno\s+[^.;]{0,80}?\b(?:evidence|documentation|communication|listing|proof)\b[^.;]{0,40}?\b(?:has|have|was|were|is|are)\s+(?:been\s+)?(?:submitted|provided|presented|produced|offered)\b/i,
    /\b(?:unsupported|unsubstantiated)\s+(?:claim|assertion|allegation)\b|\bwithout\s+(?:any\s+)?(?:evidence|substantiation)\b/i,
    /\babsence\s+of\s+(?:any\s+)?(?!recorded\b)(?:return|complaint|contact|communication|evidence)\b/i,
    // 7. One carrier event is one record: two fulfilment rows carrying the same
    //    tracking number do not corroborate each other (as item_not_received v9).
    /\bcorroborat\w*\b/i,
    /\bindependent(?:ly)?\s+(?:confirm\w*|support\w*|establish\w*|record\w*)\b/i,
  ],
  guardedBankPhrases: [],
  version: 2,
};
