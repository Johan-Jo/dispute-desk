/**
 * Structural claim authorization for the verified-address containment (PR-C1).
 *
 * WHY A CAPABILITY LAYER AND NOT ANOTHER REGEX. The only control that ever
 * existed on the "delivered to the verified address" claim was prompt prose in
 * `item_not_received_delivery_proof_stack`, which loads for the INR family
 * only. Measured on production: 134 package versions across 63 disputes carry
 * an affirmative address-delivery assertion, and 7 versions across 3 disputes
 * produced it while the structured flag was FALSE — i.e. the model wrote the
 * claim with no structured basis, on modules whose prompts never mentioned it.
 * A denylist of the phrasings that happened to occur would not have stopped
 * those, and will not stop the next paraphrase.
 *
 * So authorization is STRUCTURAL: capabilities are derived from approved facts
 * before generation, only the held capabilities are shown to the model, and the
 * validator re-derives them independently from the same facts. Lexical
 * detection below is defence in depth — it decides *whether a sentence makes
 * the claim*, never *whether the claim is allowed*.
 *
 * DELIBERATELY SMALL. This is the minimum needed for this containment: one
 * prohibited claim class plus the two delivery claims that must keep working.
 * It is not a general claims framework and must not grow into one without its
 * own design.
 */

import type { EvidenceFact } from "./types";

/* ── Capabilities ─────────────────────────────────────────────────────── */

export type ClaimCapability =
  /**
   * "The item was delivered to the cardholder's verified / AVS-matched /
   * billing address." UNDERIVABLE after PR-C1: no fact any collector can
   * currently produce grants it. The extension point is named
   * (`addressDeliveryContract`) so a future, independently approved evidence
   * contract has somewhere to land — it is not a back door, because nothing
   * writes that key and a test asserts no producible fact combination grants
   * the capability.
   */
  | "address_delivery"
  /** Carrier-confirmed delivery: date, carrier, tracking, delivery status. */
  | "delivery_occurred"
  /** A signature or POD name is on record from an independent source. */
  | "signature_receipt";

export const CLAIM_CAPABILITIES: readonly ClaimCapability[] = [
  "address_delivery",
  "delivery_occurred",
  "signature_receipt",
] as const;

const DELIVERY_CATEGORIES = new Set(["delivery_proof", "shipping_tracking"]);

/**
 * Capabilities this case holds, derived deterministically from approved facts.
 *
 * Pure. Same facts in, same set out — which is what lets the validator
 * re-derive independently of the generator instead of trusting a value handed
 * along with the narrative.
 */
export function deriveClaimCapabilities(
  approvedFacts: readonly EvidenceFact[],
): Set<ClaimCapability> {
  const held = new Set<ClaimCapability>();
  for (const f of approvedFacts) {
    if (!DELIVERY_CATEGORIES.has(String(f.category))) continue;
    const v = (f.value ?? {}) as Record<string, unknown>;
    const proofType = typeof v.proofType === "string" ? v.proofType : null;

    if (proofType === "delivered_confirmed" || proofType === "signature_confirmed") {
      held.add("delivery_occurred");
    }
    // An independently sourced signature / POD name — a tracking-app
    // metafield, a native fulfillment event, or a carrier POD. This is the
    // evidence PR-C1 deliberately preserves.
    if (typeof v.signedByName === "string" && v.signedByName.trim().length > 0) {
      held.add("signature_receipt");
      held.add("delivery_occurred");
    }
    // The only path to `address_delivery`. Nothing writes this key today; see
    // the type comment. A merely-collected pickup or delivery status must
    // never reach here.
    if (v.addressDeliveryContract === true) {
      held.add("address_delivery");
    }
  }
  return held;
}

/* ── Claim detection (defence in depth) ───────────────────────────────── */

export type AddressClaimVerdict = "none" | "affirmative" | "ambiguous" | "negated";

/**
 * Structural detector. A sentence makes an address-delivery claim when it
 * couples a RECEIPT/TRANSPORT term with a PHYSICAL-ADDRESS term — regardless
 * of wording. That is the catch-all that survives paraphrase; the qualifier
 * lists below only sharpen it.
 */
const DELIVERY_TERMS =
  /\b(deliver\w*|dispatch\w*|ship(?:ped|ment|ping)?|arriv\w+|receiv\w+|receipt|hand(?:ed|-delivered)?|drop(?:ped)?\s*off|left\s+at|consignment|parcel|package)\b/i;

/**
 * Physical-address nouns. `email address`, `IP address`, `web address` and
 * `URL` are excluded before this runs — they are addresses in name only and
 * appear in legitimate prose.
 */
const ADDRESS_TERMS =
  /\b(address(?:es)?|premises|residence|doorstep|door)\b/i;

/** Non-physical "address" uses, stripped before the coupling test. */
const NON_PHYSICAL_ADDRESS =
  /\b(e-?mail|ip|web|url|internet|billing\s+contact)\s+address(?:es)?\b/gi;

/**
 * Billing↔shipping agreement, the retired derivation's own fact. Prohibited on
 * its own because the only thing that could produce it is the city/country
 * comparison PR-C1 retires.
 *
 * Deliberately does NOT match "the billing address matched the issuer's
 * records" — that is the AVS fact, owned by `avs_cvv_match`, and it stays
 * licensed. AVS wording is governed separately (PR-C2/PR-C3, not this PR).
 */
const BILLING_SHIPPING_AGREEMENT =
  /\b(?:billing\s+(?:and|&|\/)\s*shipping|shipping\s+(?:and|&|\/)\s*billing)\s+address(?:es)?\b|\b(?:billing|shipping)\s+address\s+(?:is\s+|was\s+)?(?:the\s+same\s+as|match\w*|align\w*|identical\s+to)\s+the\s+(?:shipping|billing)\b/i;

const ISSUER_RECORDS = /\bissuer'?s?\s+record/i;

const NEGATION =
  /\b(no|not|never|cannot|can'?t|unable|without|absent|lack\w*|does\s+not|do\s+not|did\s+not|is\s+not|was\s+not|were\s+not|has\s+not|have\s+not|insufficient|unconfirmed|unverified|nothing|neither|nor|refrain\w*|must\s+not|may\s+not|do\s+not\s+claim)\b/i;

/**
 * An assertion marker: a copula, an evidentiary verb, or a past-tense lexical
 * verb that does the asserting on its own ("the consignment REACHED…", "the
 * addresses MATCH"). Negation is tested first, so a negated sentence never
 * reaches this test.
 */
const AFFIRMATION =
  /\b(was|were|has\s+been|have\s+been|is|are|confirm\w*|show\w*|demonstrat\w+|record\w*|establish\w*|indicat\w*|evidenc\w+|reach\w*|hand(?:ed|s)|deliver(?:ed|s)|arriv\w+|receiv\w+|left|collect(?:ed|s)|match(?:es|ed)?|align\w*|sign(?:ed|s)|drop(?:ped|s))\b/i;

function stripNonPhysicalAddresses(text: string): string {
  return text.replace(NON_PHYSICAL_ADDRESS, " ");
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Does this ONE sentence make an address-delivery / address-agreement claim? */
function sentenceMakesAddressClaim(sentence: string): boolean {
  const cleaned = stripNonPhysicalAddresses(sentence);
  if (BILLING_SHIPPING_AGREEMENT.test(cleaned) && !ISSUER_RECORDS.test(cleaned)) {
    return true;
  }
  return DELIVERY_TERMS.test(cleaned) && ADDRESS_TERMS.test(cleaned);
}

/**
 * Classify a whole piece of prose.
 *
 * Precedence is deliberate and fails closed: any affirmative sentence makes the
 * text affirmative; otherwise any ambiguous sentence makes it ambiguous; a text
 * whose every claim sentence is negated is `negated`. Ambiguity is never
 * resolved in the merchant's favour — an unresolved address-delivery sentence
 * blocks exactly like an affirmative one.
 */
export function classifyAddressDeliveryClaim(text: string | null | undefined): AddressClaimVerdict {
  if (!text || !text.trim()) return "none";
  let sawAffirmative = false;
  let sawAmbiguous = false;
  let sawNegated = false;
  for (const sentence of sentences(text)) {
    if (!sentenceMakesAddressClaim(sentence)) continue;
    if (NEGATION.test(sentence)) {
      sawNegated = true;
      continue;
    }
    if (AFFIRMATION.test(sentence)) {
      sawAffirmative = true;
      continue;
    }
    sawAmbiguous = true;
  }
  if (sawAffirmative) return "affirmative";
  if (sawAmbiguous) return "ambiguous";
  if (sawNegated) return "negated";
  return "none";
}

/** True when this prose must not ship without the `address_delivery`
 *  capability. Ambiguous counts — fail closed. */
export function claimsAddressDelivery(text: string | null | undefined): boolean {
  const verdict = classifyAddressDeliveryClaim(text);
  return verdict === "affirmative" || verdict === "ambiguous";
}

/**
 * The authorization check itself: is this prose permitted, given the
 * capabilities the case actually holds?
 */
export function checkAddressDeliveryAuthorization(args: {
  text: string | null | undefined;
  capabilities: ReadonlySet<ClaimCapability>;
}): { authorized: true } | { authorized: false; verdict: "affirmative" | "ambiguous" } {
  const verdict = classifyAddressDeliveryClaim(args.text);
  if (verdict !== "affirmative" && verdict !== "ambiguous") return { authorized: true };
  if (args.capabilities.has("address_delivery")) return { authorized: true };
  return { authorized: false, verdict };
}
