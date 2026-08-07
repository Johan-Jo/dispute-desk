/**
 * Structural claim authorization for the verified-address containment (PR-C1).
 *
 * WHY A CAPABILITY LAYER AND NOT ANOTHER REGEX. The only control that ever
 * existed on the "delivered to the verified address" claim was prompt prose in
 * `item_not_received_delivery_proof_stack`, which loads for the INR family
 * only. On production a large share of narratives carry an affirmative
 * address-delivery assertion, and some produced it while the structured flag
 * was FALSE — i.e. the model wrote the claim with no structured basis, on
 * modules whose prompts never mentioned it. A denylist of the phrasings that
 * happened to occur would not have stopped those, and will not stop the next
 * paraphrase. (Population counts live in the PR description and
 * `docs/technical.md` with their census timestamp, not in this comment.)
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
   * billing address."
   *
   * PROHIBITED, AND STRUCTURALLY UNGRANTABLE. `deriveClaimCapabilities` has no
   * branch that can add it — not from a fact property, not from a payload key,
   * not from any combination. The identifier exists only so the validator can
   * NAME the prohibited claim class.
   *
   * An earlier revision of this file granted it on `addressDeliveryContract:
   * true`. That was removed: it recreated the dormant "apparently usable
   * future path" the audit rejected, and a dormant branch that can never
   * legitimately fire is how a later author re-arms a retired claim.
   * Reintroduction requires an independently approved evidence contract AND a
   * deliberate code change here.
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
    // NO BRANCH GRANTS `address_delivery`. Deliberately absent — see the type
    // comment. `lib/defence/__tests__/claimCapabilities.test.ts` proves
    // adversarially that no fact value, including `addressDeliveryContract:
    // true`, the retired keys, AVS values, or a hand-built manual fact, can
    // produce it.
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
  /\b(address(?:es)?|premises|residence|dwelling|doorstep|door)\b/i;

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
  /\b(no|not|never|cannot|can'?t|unable|without|absent|lack\w*|does\s+not|do\s+not|did\s+not|is\s+not|was\s+not|were\s+not|has\s+not|have\s+not|insufficient|unconfirmed|unverified|nothing|neither|nor|refrain\w*|must\s+not|may\s+not)\b/i;

/**
 * A negated CLAIM VERB whose complement is the address sentence — "we do not
 * claim that …", "no assertion is made that …". The negation legitimately
 * scopes over the whole complement, so the sentence is a prohibition, not an
 * assertion. Matched at sentence level because the scope crosses clauses.
 */
const SCOPED_PROHIBITION =
  /\b(?:(?:do|does|did|will|would|shall|can|could|must|may|is|are|was|were)\s+not\s+(?:be\s+)?(?:claim\w*|assert\w*|stat\w+|suggest\w*|impl\w+|argu\w+|contend\w*|alleg\w+|represent\w*|maintain\w*)|(?:no|without)\s+(?:such\s+)?(?:claim|assertion|allegation|representation|suggestion)\b)/i;

/**
 * Litotes / double negation — "there is no reason to doubt that X", "it cannot
 * be denied that X". These are AFFIRMATIONS wearing a negative word, and the
 * clause-level negation test would otherwise clear them. When one matches, the
 * sentence is never treated as negated.
 */
const LITOTES =
  /\b(?:no\s+(?:reason|basis|grounds?|cause)\s+to\s+(?:doubt|dispute|question|contest)|(?:cannot|can'?t|could\s+not)\s+be\s+(?:doubted|denied|disputed|questioned|contested)|not\s+(?:in\s+)?(?:doubt|disputed|contested)|beyond\s+(?:any\s+)?doubt|nothing\s+(?:to\s+)?(?:suggests?|indicates?)\s+otherwise|no\s+(?:evidence|indication|suggestion)\s+(?:to\s+the\s+contrary|otherwise))\b/i;

/**
 * Clause boundaries. Coordination and subordination both open a NEW scope, so
 * "the parcel was not delayed AND was delivered to the cardholder's address"
 * must not let the first clause's negation license the second.
 */
function clausesOf(sentence: string): string[] {
  return sentence
    .split(/\s*(?:,|;|—|–|\n)\s*|\s+(?:and|but|while|whereas|although|though|however|yet|then|so)\s+/i)
    .map((c) => c.trim())
    .filter(Boolean);
}

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

/** The delivery+address coupling, evaluated on ONE clause. */
function clauseCouplesDeliveryAndAddress(clause: string): boolean {
  const cleaned = stripNonPhysicalAddresses(clause);
  return DELIVERY_TERMS.test(cleaned) && ADDRESS_TERMS.test(cleaned);
}

/**
 * Classify one sentence, clause by clause.
 *
 * Negation is scoped. A negative word in one clause must never license an
 * affirmative address-delivery claim in another — that is how
 * "The parcel was not delayed and was delivered to the cardholder's address"
 * used to pass. Three scopes are recognised, in order:
 *
 *   1. LITOTES ("no reason to doubt that…") — a negative word doing
 *      affirmative work. Never counts as negation.
 *   2. SCOPED_PROHIBITION ("we do not claim that…") — the negation
 *      legitimately covers the whole complement, so the sentence is a
 *      prohibition.
 *   3. Otherwise, per clause: the clause that MAKES the claim must itself
 *      carry the negation.
 *
 * Anything that cannot be resolved deterministically is `ambiguous`, which
 * blocks exactly like `affirmative`.
 */
function classifySentence(sentence: string): AddressClaimVerdict {
  const cleaned = stripNonPhysicalAddresses(sentence);
  const litotes = LITOTES.test(cleaned);

  // Sentence-level claim: billing↔shipping agreement. Evaluated whole, because
  // clause splitting would cut "billing and shipping addresses" in half.
  const agreementClaim =
    BILLING_SHIPPING_AGREEMENT.test(cleaned) && !ISSUER_RECORDS.test(cleaned);

  const claimClauses = clausesOf(sentence).filter(clauseCouplesDeliveryAndAddress);

  /**
   * The coupling can straddle clause boundaries — "The order shipped to, and
   * was received at, the cardholder's address." No single clause holds both
   * halves, but the sentence plainly makes the claim.
   *
   * When that happens the clause-level negation scope is, by definition,
   * unresolvable. So: no negation anywhere → judge the sentence normally;
   * negation somewhere → `ambiguous`, because we cannot prove which half it
   * covers. Ambiguous blocks, so this fails closed.
   */
  const straddles =
    claimClauses.length === 0 &&
    DELIVERY_TERMS.test(cleaned) &&
    ADDRESS_TERMS.test(cleaned);

  if (!agreementClaim && claimClauses.length === 0 && !straddles) return "none";

  if (!litotes && SCOPED_PROHIBITION.test(cleaned)) return "negated";

  if (straddles && !agreementClaim) {
    if (!litotes && NEGATION.test(cleaned)) return "ambiguous";
    return AFFIRMATION.test(cleaned) ? "affirmative" : "ambiguous";
  }

  let affirmative = false;
  let ambiguous = false;
  let negated = false;

  const judge = (fragment: string) => {
    if (!litotes && NEGATION.test(fragment)) {
      negated = true;
      return;
    }
    if (AFFIRMATION.test(fragment)) {
      affirmative = true;
      return;
    }
    ambiguous = true;
  };

  if (agreementClaim) judge(sentence);
  for (const clause of claimClauses) judge(clause);

  if (affirmative) return "affirmative";
  if (ambiguous) return "ambiguous";
  if (negated) return "negated";
  return "none";
}

/**
 * Classify a whole piece of prose.
 *
 * Precedence fails closed: any affirmative sentence makes the text
 * affirmative; otherwise any ambiguous sentence makes it ambiguous; a text
 * whose every claim sentence is negated is `negated`. Ambiguity is never
 * resolved in the merchant's favour.
 */
export function classifyAddressDeliveryClaim(text: string | null | undefined): AddressClaimVerdict {
  if (!text || !text.trim()) return "none";
  let sawAffirmative = false;
  let sawAmbiguous = false;
  let sawNegated = false;
  for (const sentence of sentences(text)) {
    switch (classifySentence(sentence)) {
      case "affirmative":
        sawAffirmative = true;
        break;
      case "ambiguous":
        sawAmbiguous = true;
        break;
      case "negated":
        sawNegated = true;
        break;
      default:
        break;
    }
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
