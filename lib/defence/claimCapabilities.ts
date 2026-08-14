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
  /\b(deliver\w*|dispatch\w*|ship(?:ped|ment|ping)?|sent|arriv\w+|reach\w+|receiv\w+|receipt|hand(?:ed|-delivered)?|drop(?:ped)?\s*off|left\s+at|consignment|courier|parcel|package|goods)\b/i;

/**
 * Physical-address nouns. `email address`, `IP address`, `web address` and
 * `URL` are excluded before this runs — they are addresses in name only and
 * appear in legitimate prose.
 */
const ADDRESS_TERMS =
  /\b(address(?:es)?|premises|residence|dwelling|doorstep|door|home)\b/i;

/**
 * Physical-DESTINATION paraphrases that never use the word "address".
 * "reached its stated destination", "arrived at the customer's listed
 * location", "arrived where the buyer asked us to send them" are the same
 * unsupported claim in different words. A detector that only knows "address"
 * is a lexical denylist wearing a structural label.
 */
const DESTINATION_TERMS =
  /\b(destination|location|where\s+(?:the\s+)?(?:buyer|customer|cardholder|purchaser|recipient|they)\s+(?:asked|requested|instructed|told|wanted)\s+(?:us\s+)?to\s+(?:send|ship|deliver)|as\s+(?:instructed|directed|requested|specified|nominated|designated)\s+by\s+(?:the\s+)?(?:buyer|customer|cardholder|purchaser|recipient|account\s+holder)|to\s+the\s+(?:buyer|customer|cardholder|purchaser|recipient)'?s?\s+(?:nominated|stated|chosen|designated|preferred)\s+\w+)\b/i;

/**
 * A literal street address — "42 Elm Road", "1 Main St". Naming the
 * destination outright is the same claim as calling it "the address", and a
 * detector that only knows the WORD "address" misses it entirely.
 *
 * Deliberately requires a house number followed by a street-type noun, so
 * dates ("12 May 2026"), tracking numbers and money amounts do not match.
 */
const STREET_ADDRESS =
  /\b\d{1,6}[a-z]?\s+(?:[\w'’.-]+\s+){0,3}(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|way|court|ct|place|pl|terrace|close|crescent|square|sq|highway|hwy|parkway|pkwy|circle|cir|trail|route|gatan|vägen|strasse|straße)\b\.?/i;

/** Any physical destination: a named address noun, a paraphrase, or a
 *  literal street address. */
function hasDestination(text: string): boolean {
  return ADDRESS_TERMS.test(text) || DESTINATION_TERMS.test(text) || STREET_ADDRESS.test(text);
}

/**
 * A URL is a CITATION, and its path is not prose.
 *
 * Stripped before every other test because no substring of a link is evidence
 * of a claim about where a parcel went. Measured on production 2026-08-12: four
 * blocked packages carried the CANONICAL PERMITTED delivery sentence — the one
 * `narrativeWriter` rule 14 lists as RIGHT —
 *
 *   "The carrier TechSHIP confirmed delivery on 13 July 2026 under tracking
 *    number 420754… (tracking URL: https://www.dhl.com/us-en/home/tracking…)"
 *
 * and were refused because DHL's path contains `/home/`, which `ADDRESS_TERMS`
 * matches as a physical destination. Removing only the URL turns all four from
 * `affirmative` to `none`, so the link was the entire cause: DisputeDesk was
 * refusing to file its own approved wording because of a carrier's URL scheme.
 *
 * This does not narrow what counts as a claim. A destination asserted in the
 * PROSE around a link is untouched — proven by the false-negative cases in
 * `claimCapabilities.test.ts`.
 */
const URL_LITERAL = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;

/** Non-physical "address" / "location" uses, stripped before the coupling
 *  test. `IP location` and `geolocation` are the ip_location_check fact
 *  describing itself, not a delivery destination. */
const NON_PHYSICAL_ADDRESS =
  /\b(?:(?:e-?mail|ip|web|url|internet|billing\s+contact)\s+address(?:es)?|ip\s+location|geo-?locat\w+|home\s*page)\b/gi;

/**
 * WHERE AN IP RESOLVED — not where a parcel went.
 *
 * An IP geolocating to the shipping destination's COUNTRY and a parcel
 * arriving at an ADDRESS are different claims about different evidence. The
 * first is what `ip_location` measures and can prove; the second is
 * `address_delivery`, which no case holds.
 *
 * Without this, the two are indistinguishable to the coupling test, and the
 * bank-facing IP sentence had to be rewritten three times to avoid naming a
 * destination at all — arriving at "The order originated from the same
 * country recorded on this order", which compares one term to itself and
 * never mentions the IP. Safe, and close to meaningless.
 *
 * ── WHY THIS IS NO LONGER ONE REGEX ───────────────────────────────────
 *
 * It used to be a single pattern fitted to the LEAD-IN of the approved
 * sentence `generateBankParagraph` emits:
 *
 *   /(?:placed|originated|made|came)\s+from\s+an?\s+ip\s+address\s+
 *    (?:geo-?locating|geo-?located|…)\s*(?:to)?\s*(?:the\s+)?same\s+country…/
 *
 * The model is told to QUOTE that sentence, and on 2026-08-14 it paraphrased
 * it instead — same fact, same comparison, different opening:
 *
 *   approved:  "The order was placed from an IP address geolocating to the
 *               same country as the order's shipping destination…"
 *   written:   "The order IP address geolocated to the same country as the
 *               order's shipping destination…"
 *
 * The carve-out missed, `NON_PHYSICAL_ADDRESS` consumed "IP address", and what
 * was left — "…geolocated to the same country as the order's SHIPPING
 * DESTINATION" — coupled `ship*` with `destination` and classified
 * `ambiguous`. Blume-box dispute 11051073729 (USD 120) reached its deadline
 * with nothing filed because DisputeDesk refused its own approved wording,
 * reworded. An allowlist keyed to one phrasing is the same lexical denylist
 * this file warns about, wearing the opposite sign.
 *
 * ── WHAT IS RECOGNISED INSTEAD ────────────────────────────────────────
 *
 * The STRUCTURE of the licensed statement: the shipping destination named as
 * the COMPARAND of an IP-origin country comparison. Three parts, checked in
 * `stripIpCountryComparison`:
 *
 *   1. an IP / geo-IP mention,
 *   2. …followed, in the same sentence, by "same country as … shipping
 *      destination|address|country",
 *   3. …with NO transport or receipt term in the gap between them.
 *
 * Condition 3 is what keeps this an exemption for a comparison rather than a
 * licence for a delivery. "The IP record shows the parcel was DELIVERED in the
 * same country as the shipping destination" has `deliver` in the gap, so
 * nothing is stripped and it blocks — as does any sentence whose IP mention
 * comes AFTER the comparand. Only the comparand phrase is consumed, never the
 * clause around it, so a destination asserted elsewhere still blocks: that is
 * what keeps "…geolocated to the same country as the shipping destination; the
 * goods reached that destination" refused, pinned in
 * `ipGeolocationNotDelivery.test.ts` alongside seven other guards that must
 * never pass.
 */
const IP_MENTION = /\b(?:ip\s+address(?:es)?|ip|geo-?ip)\b/gi;

/** The comparand itself — "same country as the order's shipping destination". */
const SHIPPING_COUNTRY_COMPARAND =
  /\bsame\s+country\s+as\s+(?:that\s+of\s+)?(?:the\s+)?(?:order'?s?\s+|customer'?s?\s+|recorded\s+|stated\s+|listed\s+)*shipping\s+(?:destination|address|country)\b/gi;

/** Sentence-ish boundary: an exemption may not reach across one. */
const CLAUSE_TERMINATOR = /[.;!?]/;

/**
 * Remove every shipping-country comparand that is governed by an IP-origin
 * geolocation, and nothing else.
 *
 * Deliberately written as a scan rather than one regex: condition 3 is a
 * statement about what is ABSENT from the gap, and a regex that expresses
 * "no delivery term in between" as a character-class exclusion is unreadable
 * and silently wrong the first time `DELIVERY_TERMS` grows a word.
 */
function stripIpCountryComparison(text: string): string {
  if (!SHIPPING_COUNTRY_COMPARAND.test(text)) {
    SHIPPING_COUNTRY_COMPARAND.lastIndex = 0;
    return text;
  }
  SHIPPING_COUNTRY_COMPARAND.lastIndex = 0;

  const ipEnds: number[] = [];
  IP_MENTION.lastIndex = 0;
  for (let m = IP_MENTION.exec(text); m !== null; m = IP_MENTION.exec(text)) {
    ipEnds.push(m.index + m[0].length);
  }
  if (ipEnds.length === 0) return text;

  let out = "";
  let cursor = 0;
  SHIPPING_COUNTRY_COMPARAND.lastIndex = 0;
  for (
    let m = SHIPPING_COUNTRY_COMPARAND.exec(text);
    m !== null;
    m = SHIPPING_COUNTRY_COMPARAND.exec(text)
  ) {
    // The nearest IP mention that precedes this comparand.
    const ipEnd = ipEnds.filter((end) => end <= m!.index).pop();
    if (ipEnd === undefined) continue;
    const gap = text.slice(ipEnd, m.index);
    // An exemption never reaches across a sentence boundary, and never over a
    // transport or receipt term — that gap holds a delivery predicate, not a
    // geolocation one.
    if (CLAUSE_TERMINATOR.test(gap) || DELIVERY_TERMS.test(gap)) continue;
    out += text.slice(cursor, m.index) + " ";
    cursor = m.index + m[0].length;
  }
  return out + text.slice(cursor);
}

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

/**
 * A clause that OPENS in a destination role — "to the …", "at the …".
 *
 * Load-bearing for `isLicensedAvsClause` below: a clause introduced by a
 * directional preposition is the destination argument of the sentence's
 * delivery predicate, so it may never be discounted as AVS prose however it
 * goes on to read. "…was delivered, to the billing address that matched the
 * issuer's records" must stay blocked; only a clause that mentions the address
 * as the SUBJECT of an AVS predicate is licensed.
 */
const DESTINATION_ROLE_OPENER = /^(?:and\s+|but\s+|then\s+)?(?:to|at|into|onto|toward|towards)\b/i;

/**
 * A clause whose address mention is the licensed AVS statement and nothing
 * else — "payment authentication records indicate the billing address matched
 * the issuer's records".
 *
 * WHY THIS EXISTS. The AVS carve-out was already declared on
 * `BILLING_SHIPPING_AGREEMENT` and applied at clause level, but the
 * sentence-level straddle fallback never consulted it: it asked only whether a
 * delivery term and an address term appear ANYWHERE in the sentence. So a
 * sentence pairing two separately-licensed facts —
 *
 *   "The carrier confirmed delivery on 17 July 2026 (TechSHIP, tracking …),
 *    and payment authentication records indicate that the billing address
 *    matched the issuer's records at the time of purchase."
 *
 * — was classified `affirmative` and failed validation twice, once on the
 * first attempt and once on the fed-back retry, leaving the dispute with no
 * fileable package. Measured on production package
 * 08575d57-c692-4fb5-a5c6-f0112f808008 (2026-08-10), pinned below.
 *
 * A clause is discounted ONLY when all three hold: it cites the issuer's
 * records, it carries no transport/receipt term of its own, and it does not
 * open in a destination role. Any one of those failing leaves the clause in
 * the straddle test, so the fallback keeps its reach over real couplings.
 */
function isLicensedAvsClause(clause: string): boolean {
  const cleaned = stripNonPhysicalAddresses(clause);
  if (!ISSUER_RECORDS.test(cleaned)) return false;
  if (DELIVERY_TERMS.test(cleaned)) return false;
  return !DESTINATION_ROLE_OPENER.test(clause.trim());
}

/**
 * PREDICATE-SCOPED negation.
 *
 * Two earlier revisions failed here. The first treated adjectives
 * (`unverified`, `unconfirmed`, `insufficient`) as negation, so a hedged
 * source cleared an affirmative claim. The second kept a flat word list
 * (`no|not|without|…`), so ANY negative word anywhere in the claim clause
 * negated it — and these all shipped:
 *
 *   "The parcel was delivered to the billing address without delay."
 *   "The package arrived at the customer's home without incident."
 *   "The parcel was not damaged when it was delivered to the billing address."
 *
 * The negated thing there is a delay, an incident, a damage state — never the
 * delivery-to-destination predicate. So negation is now modelled, not matched:
 * the marker must attach to a transport/receipt verb, an evidentiary verb, or
 * an evidence noun. `without` is gone entirely — it introduces a qualifier
 * ("without delay", "without a signature"), never a denial of the destination.
 *
 * Anything not on this list is NOT negation. Fail-closed then makes the
 * sentence affirmative or ambiguous, both of which block.
 */
const NEGATED_DELIVERY_PREDICATES: readonly RegExp[] = [
  // "was not delivered", "has never been received", "were not sent to …"
  /\b(?:was|were|is|are|has|have|had|been|being)\s+(?:not|never)\s+(?:[\w'’-]+\s+){0,3}(?:deliver\w*|ship\w*|dispatch\w*|sent|receiv\w+|arriv\w+|reach\w+|hand\w*|left|collect\w*|drop\w*)\b/i,
  // "does not identify", "did not deliver", "cannot show", "will not reach"
  /\b(?:do|does|did|will|would|can|could|shall|should|may|might|must)\s+not\s+(?:[\w'’-]+\s+){0,3}(?:deliver\w*|ship\w*|send|dispatch\w*|receiv\w+|arriv\w+|reach\w+|identif\w+|show\w*|confirm\w*|establish\w*|prov\w+|record\w*|assert\w*|claim\w*|stat\w+)\b/i,
  /\bnever\s+(?:[\w'’-]+\s+){0,3}(?:deliver\w*|ship\w*|sent|dispatch\w*|receiv\w+|arriv\w+|reach\w+)\b/i,
  /\bnot\s+(?:deliver\w*|ship\w*|sent|dispatch\w*|receiv\w+|arriv\w+|reach\w+|asserted|claimed|alleged)\b/i,
  // "no evidence of…", "no record that…", "no assertion is made…"
  /\bno\s+(?:[\w'’-]+\s+){0,3}(?:proof|evidence|record|confirmation|indication|assertion|claim|allegation|representation|suggestion)\b/i,
  // "no verified-address delivery", "no shipment", "no delivery receipt"
  /\bno\s+(?:[\w'’-]+\s+){0,3}(?:deliver\w*|shipment|receipt)\b/i,
  /\b(?:cannot|can'?t|could\s+not)\s+(?:be\s+)?(?:confirm\w*|verif\w*|establish\w*|deliver\w*|show\w*|demonstrat\w*|determin\w*|evidenc\w+)\b/i,
  /\b(?:unable|failed)\s+to\s+(?:deliver|ship|send|arrive|reach|confirm|verify|establish)\b/i,
  /\b(?:refrain\w*|must\s+not|may\s+not|neither|nor)\b/i,
];

/** True only when a MODELLED negation governs the delivery-destination
 *  predicate in this fragment. */
function negatesDeliveryPredicate(fragment: string): boolean {
  return NEGATED_DELIVERY_PREDICATES.some((re) => re.test(fragment));
}

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
  /\b(?:no\s+(?:reason|basis|grounds?|cause)\s+to\s+(?:doubt|dispute|question|contest)|no\s+(?:question|dispute|doubt|denying)\s+(?:that|but\s+that)|there\s+is\s+no\s+denying|(?:cannot|can'?t|could\s+not)\s+(?:seriously\s+)?be\s+(?:doubted|denied|disputed|questioned|contested)|not\s+(?:in\s+)?(?:doubt|disputed|contested)|beyond\s+(?:any\s+)?doubt|nothing\s+(?:to\s+)?(?:suggests?|indicates?)\s+otherwise|no\s+(?:evidence|indication|suggestion)\s+(?:to\s+the\s+contrary|otherwise))\b/i;

/**
 * Clause boundaries. Coordination and subordination both open a NEW scope, so
 * "the parcel was not delayed AND was delivered to the cardholder's address"
 * must not let the first clause's negation license the second.
 */
function clausesOf(sentence: string): string[] {
  return sentence
    .split(
      /\s*(?:,|;|—|–|\n)\s*|\s+(?:and|but|while|whereas|although|though|however|yet|then|so|when|after|before|because|once|since|until|unless|if|as\s+soon\s+as)\s+/i,
    )
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * A clause that opens as the previous clause's complement — "…do not claim,
 * THAT the parcel was delivered…". This is the ONLY case in which a
 * prohibition survives a clause boundary; every other boundary resets it.
 *
 * Deliberately narrow. A prohibition separated from its complement by an
 * intervening clause ("we do not claim, on the basis of the carrier record,
 * that …") has a scope this parser cannot prove, so it fails closed and the
 * sentence blocks. That costs a regeneration; the alternative — assuming the
 * prohibition reaches — files an unsupported claim.
 */
const COMPLEMENT_CONTINUATION = /^(?:that|which|whether)\b/i;

/**
 * An assertion marker: a copula, an evidentiary verb, or a past-tense lexical
 * verb that does the asserting on its own ("the consignment REACHED…", "the
 * addresses MATCH"). Negation is tested first, so a negated sentence never
 * reaches this test.
 */
const AFFIRMATION =
  /\b(was|were|has\s+been|have\s+been|is|are|confirm\w*|show\w*|demonstrat\w+|record\w*|establish\w*|indicat\w*|evidenc\w+|reach\w*|hand(?:ed|s)|deliver(?:ed|s)|arriv\w+|receiv\w+|left|collect(?:ed|s)|match(?:es|ed)?|align\w*|sign(?:ed|s)|drop(?:ped|s)|went|goes|gone|travel\w*)\b/i;

function stripNonPhysicalAddresses(text: string): string {
  // URLs first: a tracking link's path is not prose, and `/home/` inside one is
  // not a physical destination. Then the self-describing facts, then the
  // IP-origin comparison — which must run BEFORE the coupling test so the
  // `ip_location` fact can name what it compares against without the sentence
  // reading as a delivery.
  const withoutUrls = text.replace(URL_LITERAL, " ");
  /* BEFORE `NON_PHYSICAL_ADDRESS`, which matches the bare "IP address" and
   * would consume the mention this exemption is anchored to — leaving the
   * "…same country as the shipping destination" tail stranded and reading as
   * a delivery. Order is the whole behaviour here, so the two are adjacent
   * with the reason stated rather than separated by chance. */
  return stripIpCountryComparison(withoutUrls).replace(NON_PHYSICAL_ADDRESS, " ");
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The delivery+destination coupling, evaluated on ONE clause. */
function clauseCouplesDeliveryAndAddress(clause: string): boolean {
  const cleaned = stripNonPhysicalAddresses(clause);
  if (!DELIVERY_TERMS.test(cleaned)) return false;
  return hasDestination(cleaned);
}

/**
 * Classify one sentence.
 *
 * Negation and prohibition are both CLAUSE-scoped. A negative word in one
 * clause must never license an affirmative address-delivery claim in another,
 * and — the bypass found in review — a prohibition must cover EVERY
 * delivery-destination assertion in the sentence, including one joined with
 * "and":
 *
 *   "We do not claim that the carrier identified the address, AND the parcel
 *    was delivered to the billing address."
 *
 * The prohibition covers the first clause; the second is a fresh, unprohibited
 * assertion. An earlier revision scoped prohibitions to contrast segments
 * (`but` / `;`) only, so that sentence read as `negated` and shipped.
 *
 * Order of decision, per clause:
 *
 *   1. LITOTES ("no reason to doubt that…", "there is no question that…") —
 *      a negative word doing affirmative work. Never counts as negation.
 *   2. SCOPED_PROHIBITION ("we do not claim that…") — this clause only,
 *      carried forward ONLY into a clause that opens with a complementizer.
 *   3. The billing↔shipping agreement claim, judged on the clause that makes
 *      it — the AVS exception ("matched the issuer's records") applies to that
 *      clause alone and may not immunise the rest of the sentence.
 *   4. A modelled negation of the delivery-destination predicate.
 *   5. Otherwise: an assertion marker makes it affirmative; anything left is
 *      ambiguous.
 *
 * Anything unresolvable is `ambiguous`, which blocks exactly like
 * `affirmative`.
 */
function classifySentence(sentence: string): AddressClaimVerdict {
  const cleanedSentence = stripNonPhysicalAddresses(sentence);
  const litotes = LITOTES.test(cleanedSentence);

  let affirmative = false;
  let ambiguous = false;
  let negated = false;
  let sawClaim = false;

  const judge = (fragment: string, prohibited: boolean) => {
    if (prohibited && !litotes) {
      negated = true;
      return;
    }
    if (!litotes && negatesDeliveryPredicate(fragment)) {
      negated = true;
      return;
    }
    if (AFFIRMATION.test(fragment)) {
      affirmative = true;
      return;
    }
    ambiguous = true;
  };

  let prohibitionActive = false;

  for (const clause of clausesOf(sentence)) {
    const cleanedClause = stripNonPhysicalAddresses(clause);

    // A prohibition dies at the clause boundary unless the next clause is its
    // detached complement.
    if (!COMPLEMENT_CONTINUATION.test(clause)) prohibitionActive = false;
    if (!litotes && SCOPED_PROHIBITION.test(cleanedClause)) prohibitionActive = true;

    const assertsAgreement =
      BILLING_SHIPPING_AGREEMENT.test(cleanedClause) && !ISSUER_RECORDS.test(cleanedClause);
    const assertsDelivery = clauseCouplesDeliveryAndAddress(clause);
    if (!assertsAgreement && !assertsDelivery) continue;

    sawClaim = true;
    judge(cleanedClause, prohibitionActive);
  }

  // The coupling can straddle clause boundaries — "The order shipped to, and
  // was received at, the cardholder's address." No single clause holds both
  // halves, so clause-level scope is unresolvable by definition: a negation
  // anywhere in the sentence makes it ambiguous rather than negated.
  //
  // Licensed AVS clauses are removed BEFORE the coupling is looked for. They
  // are not part of any delivery predicate — they are the `avs_cvv_match`
  // fact stating itself — and leaving them in is what made a carrier-delivery
  // clause couple with an AVS clause that merely stood next to it. Negation,
  // prohibition and affirmation still read the WHOLE sentence: a prohibition
  // in a discounted clause must keep its scope.
  const straddleText = stripNonPhysicalAddresses(
    clausesOf(sentence)
      .filter((clause) => !isLicensedAvsClause(clause))
      .join(", "),
  );
  if (!sawClaim && DELIVERY_TERMS.test(straddleText) && hasDestination(straddleText)) {
    sawClaim = true;
    const prohibited = !litotes && SCOPED_PROHIBITION.test(cleanedSentence);
    if (prohibited) negated = true;
    else if (!litotes && negatesDeliveryPredicate(cleanedSentence)) ambiguous = true;
    else if (AFFIRMATION.test(cleanedSentence)) affirmative = true;
    else ambiguous = true;
  }

  if (!sawClaim) return "none";
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
