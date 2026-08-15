/**
 * Fact classifier — the system→LLM boundary.
 *
 * Reads raw collector output (`pack_json.sections[*]`), the canonical
 * evidence registry (`lib/argument/canonicalEvidence.ts`), and case-level
 * gate summaries; emits normalised `EvidenceFact[]` records and a
 * `packageMode`. Nothing downstream may consume raw Shopify JSON.
 *
 * Eligibility short-circuits:
 *   - coverage.state === "covered_shopify"  → eligible=false (covered_shopify)
 *   - no approved bank-eligible facts        → eligible=false (no_bank_eligible_facts)
 *
 * See `lib/defence/types.ts` for the output shape, and the plan at
 * C:\Users\johan\.claude\plans\cozy-zooming-popcorn.md.
 */

import {
  CANONICAL_EVIDENCE,
  categoryFor,
  disputeFreeHistoryState,
  effectivePriorOrders,
  type EvidenceCategory,
} from "@/lib/argument/canonicalEvidence";
import {
  citableVerificationSummaryEn,
  readPaymentVerification,
} from "@/lib/argument/paymentVerification";
import type { CaseStrengthLevel } from "@/lib/argument/types";
import {
  isRetiredFieldKey,
  stripRetiredPayloadKeys,
} from "@/lib/evidence/model/retiredKeys";
import { trackingLinkUrl } from "@/lib/carriers/trackingLinkUrl";
import { isBankIncludedFact } from "./bankInclusion";
import { evaluateAllPredicates } from "./factPredicates";
import type {
  EvidenceFact,
  EvidenceFactCategory,
  FactClassificationResult,
  ManualEvidenceRecord,
  MissingEvidence,
  PackageMode,
  ReasonCodeGuidance,
} from "./types";

/* ── Input shapes (intentionally narrow — only what we read) ── */

export interface PackSectionLike {
  type: string;
  label: string;
  source: string;
  data: Record<string, unknown>;
  fieldsProvided: string[];
}

export interface EvidenceItemLike {
  id: string;
  payload: (Record<string, unknown> & { fieldsProvided?: string[] }) | null;
  source: string | null;
}

export interface ChecklistItemLike {
  field: string;
  status: "available" | "waived" | "missing" | "not_applicable";
}

export interface CoverageLike {
  state: "covered_shopify" | "not_covered";
}

export interface FatalLossLike {
  triggered: boolean;
  reason: string | null;
}

export interface ManualRowInput {
  id: string;
  evidenceItemId: string;
  filename: string;
  fileUrl?: string | null;
  fileType?: string | null;
  uploadedBy?: string | null;
  uploadedAt?: string | null;
  description?: string | null;
  bankEligible?: boolean | null;
  includeInPackage?: boolean | null;
  includeInBankNarrative?: boolean | null;
  evidenceCategory?: EvidenceFactCategory | null;
}

export interface ClassifyFactsInput {
  packageId: string;
  sections: PackSectionLike[];
  evidenceItems: EvidenceItemLike[];
  checklist: ChecklistItemLike[];
  coverage: CoverageLike;
  fatalLoss: FatalLossLike;
  caseStrength: CaseStrengthLevel;
  manualRows: ManualRowInput[];
  reasonCodeModule: ReasonCodeGuidance;
}

/* ── Field-key → fact category map ── */

export const SUBMISSION_RISK_FIELDS = new Set([
  "device_session_consistency",
  // NOTE: fraud_risk_screening was previously in this set. Removed
  // 2026-05-19 because the source-collector
  // (`lib/packs/sources/fraudRiskSource.ts`) is already a strict
  // gate — it ONLY emits a section when:
  //   - provider = "shopify" (third-party scores stay out)
  //   - risk_level ∈ {LOW, NONE}
  //   - recommendation ∈ {ACCEPT, NONE}
  //   - ≥ 1 POSITIVE-sentiment fact (negative facts are dropped)
  // So if a fraud_risk_screening section reaches the classifier, it
  // is bank-safe by construction. Treating it as
  // submission-risk/internal-only here would silently drop the
  // strongest pre-authorization corroboration Shopify gives us.
  //
  // NOTE: ip_location_check was previously in this set. Removed
  // 2026-05-20 because the source-collector
  // (`lib/packs/sources/deviceLocationSource.ts`) pre-computes a
  // `bankEligible: boolean` that is true ONLY when ALL three positive
  // conditions hold: (1) locationMatch ∈ {same_city, same_country},
  // (2) no VPN/proxy/hosting flag in ipinfo.privacy, and (3) IP
  // consistency is "consistent" or "first_seen". Negative payloads
  // still ride the safe rail via `isNegativeOrAmbiguous` in
  // `lib/argument/evidenceLineItem.ts`. Blanket internal-only hid
  // every clean IP match — supporting evidence we were discarding.
]);

/**
 * 3-D Secure is bank-citable only when it actually helps: a liability shift
 * (ECI 02/05, authenticated, no SCA exemption) or a merchant-confirmed
 * authentication. Everything else — "attempted", exempted, or a bare receipt
 * read we cannot verify — stays out of every bank-facing surface.
 *
 * Extracted from the inline expression in `classifyFacts` (2026-08-04) so the
 * canonical evidence model derives citation eligibility from the SAME
 * predicate the bank filter uses, instead of a second copy that could drift.
 * Behaviour is unchanged — `classifyFacts` calls this.
 *
 * The predicate belongs to the classifier by contract (see the header of
 * `buildLlmFactPayload`): the LLM payload, the Evidence Basis rows and the
 * workspace line items then agree by construction. They did not before — on
 * blume-box #352552 the narrative correctly refused to argue 3DS while the
 * PDF's Evidence Basis table asserted "3DS authenticated" to the same issuer,
 * three lines below.
 */
export function isUnciteableThreeDsFact(
  fieldKey: string,
  value: { liabilityShift?: unknown; tdsVerified?: unknown } | null | undefined,
): boolean {
  return (
    fieldKey === "tds_authentication" &&
    value?.liabilityShift !== true &&
    value?.tdsVerified !== true
  );
}

/**
 * A payment-verification fact is bank-citable only through its ADDRESS half.
 *
 * DECISION 1 (PR-C2 / C-12, maintainer 2026-08-08): a CVV-only match is a
 * valid internal merchant fact and is not issuer-citable. A security-code
 * match says the person at checkout held the card; it says nothing about the
 * address, and the Visa CE rule this evidence is cited under (register R-E,
 * chart Item 3) is an address rule. Citing it invited the issuer to answer the
 * half we did not have.
 *
 * Same shape as `isUnciteableThreeDsFact` and for the same reason: bank-
 * inclusion predicates belong to the classifier by contract, so the LLM
 * payload, the Evidence Basis rows, the workspace line items and the canonical
 * model's citation state agree by construction instead of by comment.
 *
 * The grade is untouched — `categorizeEvidenceField` still returns `moderate`
 * for a CVV-only match, so case strength and completeness see exactly what
 * they saw before the split.
 */
export function isUnciteablePaymentVerificationFact(
  fieldKey: string,
  payload: Record<string, unknown> | null | undefined,
): boolean {
  if (fieldKey !== "avs_cvv_match") return false;
  return !readPaymentVerification(payload).citable;
}

/** Field keys whose facts must never appear in bank-facing surfaces by
 *  default. The LLM payload filter excludes them; `submission_risk=true`
 *  is set on the persisted row for the same reason. */
export const INTERNAL_ONLY_FIELDS = new Set([
  "device_session_consistency",
  // fraud_risk_screening removed 2026-05-19 — see SUBMISSION_RISK_FIELDS
  // note above. The source-collector enforces the safety contract;
  // duplicating it here meant the LLM never saw the favourable
  // ACCEPT/LOW/NONE signal even when it was the cleanest piece of
  // pre-auth evidence available.
  //
  // ip_location_check removed 2026-05-20 — same pattern. The source
  // collector (`lib/packs/sources/deviceLocationSource.ts`) emits a
  // pre-computed `bankEligible` flag that is true ONLY for clean
  // matches (same country/city, no VPN/proxy/hosting, consistent IP
  // history). Negative payloads are caught by `isNegativeOrAmbiguous`
  // in the line-item resolver. The blanket internal-only gate was
  // discarding a valid positive fraud signal.
]);

/**
 * Bank-eligibility predicate for a single field + payload.
 *
 * A field is bank-eligible when it is NOT in `INTERNAL_ONLY_FIELDS` AND
 * its categorizer-derived category is `strong` or `moderate`. Extracted
 * so `deriveEvidenceLineItems` (lib/argument/evidenceLineItem.ts) can
 * share the rule without re-classifying facts.
 *
 * Mirrors the inline check in the per-section classifier loop below
 * (line 349 — `bankEligible: !isInternalOnly && (cat === "strong" || cat === "moderate")`).
 */
export function isFieldBankEligible(
  fieldKey: string,
  payload: Record<string, unknown> | null,
): boolean {
  // A retired field is never bank-eligible, whatever a historical payload says.
  if (isRetiredFieldKey(fieldKey)) return false;
  if (INTERNAL_ONLY_FIELDS.has(fieldKey)) return false;
  if (isUnciteablePaymentVerificationFact(fieldKey, payload)) return false;
  const cat = categoryFor({ fieldKey, payload });
  return cat === "strong" || cat === "moderate";
}

export function categoryForField(fieldKey: string, payload: Record<string, unknown> | null): EvidenceFactCategory {
  switch (fieldKey) {
    case "avs_cvv_match":
    case "tds_authentication":
      return "payment_authentication";
    // `billing_address_match` mapped to `billing_match` until 2026-08-09
    // (PR-C4). The field is retired; the category keeps its declaration and
    // loses its only member. Nothing maps to it now — asserted in
    // `tests/unit/retiredFieldKeyContainment.test.ts` — so `derivePackageMode`
    // sees exactly what it sees on prod today (0 such facts).
    case "delivery_proof":
      return "delivery_proof";
    case "shipping_tracking":
      return "shipping_tracking";
    case "ip_location_check":
      return "ip_location";
    case "device_session_consistency":
      return "device_session";
    case "fraud_risk_screening":
      return "fraud_screening";
    case "customer_communication":
      return "customer_communication";
    case "customer_account_info":
      return "prior_customer_history";
    case "activity_log":
      // Strong only when digitalAccessUsed=true → service_access; otherwise
      // treat as prior_customer_history (still useful, but not delivery).
      return payload?.digitalAccessUsed === true ? "service_access" : "prior_customer_history";
    case "supporting_documents":
      return "manual_evidence";
    case "refund_policy":
      return "policy_refund";
    case "refund_record":
      return "refund_record";
    case "no_return_initiated":
      return "no_return_initiated";
    case "shipping_policy":
      return "policy_shipping";
    case "cancellation_policy":
      return "policy_cancellation";
    case "order_confirmation":
      return "order_record";
    case "product_description":
      return "order_record";
    case "duplicate_explanation":
      return "duplicate_explanation";
    default:
      return "order_record";
  }
}

/* ── Value extraction (no raw Shopify JSON crosses this boundary) ── */

/**
 * First tracking entry carrying anything usable, across all fulfillments.
 *
 * Shape written by `lib/packs/sources/fulfillmentSource.ts`:
 *   { fulfillments: [ { tracking: [ { carrier, number, url } ], … } ], … }
 *
 * Multi-parcel orders produce several entries; the defence cites one, and the
 * first with a number is the parcel the carrier confirmed. Entries with no
 * number at all (Shopify records a tracking row with only a URL sometimes)
 * are skipped so a URL-only row can't shadow a real number.
 */
function firstTrackingEntry(
  payload: Record<string, unknown>,
): { carrier?: unknown; number?: unknown; url?: unknown } | null {
  const fulfillments = Array.isArray(payload.fulfillments) ? payload.fulfillments : [];
  let urlOnly: { carrier?: unknown; number?: unknown; url?: unknown } | null = null;
  for (const f of fulfillments) {
    const rows = Array.isArray((f as { tracking?: unknown })?.tracking)
      ? ((f as { tracking: unknown[] }).tracking)
      : [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const entry = row as { carrier?: unknown; number?: unknown; url?: unknown };
      if (typeof entry.number === "string" && entry.number.trim().length > 0) return entry;
      if (!urlOnly && (entry.url || entry.carrier)) urlOnly = entry;
    }
  }
  return urlOnly;
}

function extractValue(
  fieldKey: string,
  payload: Record<string, unknown> | null,
  section: PackSectionLike,
): Record<string, unknown> {
  // Retired collector keys are removed at the boundary of fact extraction, so
  // no historical value can enter `defence_evidence_facts`, `facts_json`, the
  // Evidence Basis rows, or the LLM payload. See
  // `lib/evidence/model/retiredKeys.ts` for why each key was retired.
  const p = stripRetiredPayloadKeys(payload) ?? {};
  switch (fieldKey) {
    case "avs_cvv_match": {
      // TWO facts, one row (PR-C2). `paymentVerification` owns which codes
      // mean what; this branch only projects them.
      //
      // `verificationSummary` is the plain-language phrase the LLM is told to
      // quote instead of the raw gateway codes (Y/M/N/etc.) — issuers know
      // what the letters mean, but quoting them verbatim reads amateurishly
      // and forces the merchant to trust we did not misquote.
      //
      // DECISION 1: when the address half is missing, NOTHING here is
      // citable, so the codes themselves are withheld from the fact value as
      // well as the summary. A CVV-only fact reaches the LLM payload with no
      // quotable content even if a later change forgot to check
      // `bankEligible` — the codes are not there to misuse.
      const verification = readPaymentVerification(p);
      const verificationSummary = citableVerificationSummaryEn(verification);
      return {
        // The NETWORK travels with the codes (PR-C3). Citation authority is a
        // property of the (network, code) cell, so a fact that loses its
        // network loses the only thing that could authorize it — and this
        // projection used to drop `cardCompany` on the floor, which meant a
        // Visa-citable fact re-read as unknown-network downstream. Persisted
        // even when nothing is citable: it is not a claim, it is the context
        // every re-validation needs.
        network: verification.network,
        avsResult: verification.citable ? verification.avs.code : null,
        cvvResult: verification.citable ? verification.cvv.code : null,
        addressVerified: verification.addressVerified,
        securityCodeVerified: verification.securityCodeVerified,
        verificationSummary,
      };
    }
    case "tds_authentication": {
      // `liabilityShift` was read here long before anything wrote it, so the
      // guard that depends on it (claimGuards.three_d_secure) could never
      // pass. `threeDSecureSource` now derives it from the ECI (02/05,
      // authenticated, no exemption), so the flag finally means something.
      //
      // The DS transaction id travels with it: an issuer can match that
      // against their own authentication record, which is the difference
      // between "3DS authenticated" as an adjective and as a fact.
      const strv = (v: unknown): string | null =>
        typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
      return {
        threeDS: p.tdsAuthenticated === true || p.tdsVerified === true,
        liabilityShift: p.liabilityShift === true,
        verifiedSource: typeof p.verifiedSource === "string" ? p.verifiedSource : null,
        tdsVerified: p.tdsVerified === true,
        eci: strv(p.eci),
        dsTransactionId: strv(p.dsTransactionId),
        tdsVersion: strv(p.tdsVersion),
        authenticationFlow: strv(p.authenticationFlow),
        exemptionIndicator: strv(p.exemptionIndicator),
      };
    }
    case "delivery_proof":
    case "shipping_tracking": {
      // The carrier, tracking number and tracking URL live INSIDE
      // `fulfillments[].tracking[]` (fulfillmentSource writes them there),
      // not at the top level of the payload.
      //
      // This branch used to read `p.carrier` and pass no tracking identifier
      // at all. Consequences, measured on prod 2026-08-03: the carrier name
      // appeared in 0 of 142 defence packages, and the tracking number in 0 of
      // 12 packages that had one. So a confirmed delivery reached the issuer
      // as a bare date — "Delivered Jun 20, 2026" — with nothing they could
      // verify. Blume-box #345920's issuer response asked for exactly this:
      // "Requesting evidence from merchant providing a tracking number or
      // tracking details that show the order was successfully delivered."
      //
      // Flat-payload fallbacks are kept: not every collector nests, and a
      // manual upload may set the fields directly.
      const tracking = firstTrackingEntry(p);
      const str = (v: unknown): string | null =>
        typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
      const carrier = str(tracking?.carrier) ?? str(p.carrier);
      const trackingNumber = str(tracking?.number) ?? str(p.trackingNumber);
      return {
        proofType: typeof p.proofType === "string" ? p.proofType : null,
        carrier,
        trackingNumber,
        // The LLM is instructed to cite this URL verbatim, so whatever is
        // put here is what reaches the issuer. It must therefore be the
        // CANONICAL carrier link — rebuilt to open the shipment's result
        // page — not the merchant's app-generated URL, which on prod is
        // 35% plain http and thousands of times an empty search form.
        // Null when nothing citable exists: the narrative then states the
        // carrier and number alone, which is still verifiable.
        trackingUrl: trackingLinkUrl({
          company: carrier,
          number: trackingNumber,
          url: str(tracking?.url) ?? str(p.trackingUrl),
        }),
        deliveredAt: typeof p.deliveredAt === "string" ? p.deliveredAt : null,
        signedByName: typeof p.signedByName === "string" ? p.signedByName : null,
        // `deliveredToVerifiedAddress` is NOT emitted (PR-C1, 2026-08-07). It
        // was the licence the LLM read for "delivered to the verified
        // address", and its input was a billing-vs-shipping city comparison.
        // The retired keys are also stripped from `p` before this switch runs
        // (see `extractValue`), so a historical pack cannot reintroduce it.
      };
    }
    case "customer_communication":
      return {
        customerConfirmsOrder: p.customerConfirmsOrder === true,
        messageCount: typeof p.messageCount === "number" ? p.messageCount : null,
        lastMessageAt: typeof p.lastMessageAt === "string" ? p.lastMessageAt : null,
      };
    case "customer_account_info":
      // Prior orders EXCLUDING the disputed one. `totalOrders` mirrors
      // Shopify's numberOfOrders, which counts the disputed order itself
      // — passing it through unadjusted made the LLM narrative claim
      // "one prior undisputed order" on a customer's only, disputed,
      // order (prod dispute 235d4152, defence package 7304e09f).
      //
      // `disputeFreeHistory` is passed through as a TRI-STATE (true /
      // false / null). It used to be coerced with `!== false`, which
      // handed the LLM `disputeFreeHistory: true` for every account we
      // had never checked — and the repeat-customer strategy is
      // explicitly instructed to cite that flag (see
      // `strategies/unauthorized_fraud_repeat_customer_pattern.ts`).
      // null must stay null so the narrative cannot assert a clean
      // history we never verified.
      return {
        priorOrderCount: effectivePriorOrders(p) ?? 0,
        disputeFreeHistory:
          disputeFreeHistoryState(p) === "unknown"
            ? null
            : disputeFreeHistoryState(p) === "dispute_free",
      };
    case "activity_log":
      return {
        digitalAccessUsed: p.digitalAccessUsed === true,
        decisiveSessionProof: p.decisiveSessionProof === true,
        lastAccessAt: typeof p.lastAccessAt === "string" ? p.lastAccessAt : null,
      };
    case "supporting_documents":
      return {
        signedContract: p.signedContract === true,
        documentCount: typeof p.documentCount === "number" ? p.documentCount : null,
      };
    case "refund_policy":
    case "shipping_policy":
    case "cancellation_policy":
      return {
        acceptedAtCheckout: p.acceptedAtCheckout === true,
        acceptanceTimestamp:
          typeof p.acceptanceTimestamp === "string" ? p.acceptanceTimestamp : null,
      };
    case "refund_record": {
      // `refundStatus` is the load-bearing key: the refund_processed
      // predicate matches value.refundStatus === "processed". Amount/date
      // give the narrative a concrete, citable refund fact.
      const amount =
        typeof p.amount === "number"
          ? p.amount
          : typeof p.amount === "string"
            ? Number.parseFloat(p.amount)
            : null;
      const residual =
        typeof p.creditResidual === "number" ? p.creditResidual : null;
      return {
        refundStatus: typeof p.refundStatus === "string" ? p.refundStatus : null,
        amount: amount != null && Number.isFinite(amount) ? amount : null,
        currency: typeof p.currency === "string" ? p.currency : null,
        refundedAt: typeof p.refundedAt === "string" ? p.refundedAt : null,
        // Timing + coverage for the credit-already-issued defence. Only
        // `true` when the collector positively established the ordering
        // — the `credit_preceded_dispute` predicate gates the whole
        // strategy on it, so a guess here becomes a claim to an issuer.
        precededDispute: p.precededDispute === true,
        coversDisputedAmount: p.creditCoversDisputedAmount === true,
        residual: residual != null && Number.isFinite(residual) ? residual : null,
      };
    }
    case "no_return_initiated":
      // `returnInitiated: false` is the load-bearing key the
      // return_not_initiated predicate matches. The collector only emits
      // this field when returnStatus === NO_RETURN AND no refund exists.
      return {
        returnInitiated: false,
        returnStatus: typeof p.returnStatus === "string" ? p.returnStatus : null,
      };
    case "fraud_risk_screening": {
      // Pass the actual positive fact descriptions through to the
      // LLM payload so the narrative can cite specific Shopify
      // signals ("the cardholder's CVV matched", "the billing
      // street address matched the issuer's records") rather than
      // a meaningless count. Safety is enforced upstream:
      // `lib/packs/sources/fraudRiskSource.ts` already filters to
      // POSITIVE-sentiment facts only and caps at
      // MAX_POSITIVE_FACTS_CITED. Negative + neutral facts never
      // reach this extractor.
      //
      // Pre-2026-05-19 this returned only positiveFactCount to keep
      // raw risk JSON away from the LLM under the
      // fraud-screening-is-internal-only policy. That policy was
      // reversed in bbe0ab3 — the screening is now bank-facing
      // supporting evidence — so passing the specific fact text is
      // the whole point of citing it at all.
      const positiveFacts = Array.isArray(p.positiveFacts)
        ? (p.positiveFacts as unknown[])
            .filter((x): x is string => typeof x === "string")
            .slice(0, 5) // hard cap as a second line of defence
        : [];
      return {
        positiveFacts,
        positiveFactCount: positiveFacts.length,
        riskLevel: typeof p.riskLevel === "string" ? p.riskLevel : null,
        recommendation:
          typeof p.recommendation === "string" ? p.recommendation : null,
      };
    }
    case "ip_location_check": {
      /* ONE APPROVED SENTENCE, like `verificationSummary`.
       *
       * The fact used to carry `locationMatch` alone — a bare enum — and the
       * model was left to phrase the signal itself. On 2026-08-11 it wrote
       * "the order IP geolocated to the same country as the billing and
       * shipping address": an assertion about two addresses, from a fact that
       * names neither, which is the retired billing/shipping agreement claim
       * and failed validation as an address-delivery claim.
       *
       * Neither the pack nor the facts contained that phrase — it was
       * generated. Correcting the prompt's EXAMPLE did not stop it, because
       * the model was not copying an example; it was filling a gap. So the
       * gap is closed the way the AVS gap was: the wording is produced here,
       * from the collector that owns the comparison, and the model quotes it
       * or says nothing.
       *
       * `bankLocationSummary` describes the SHIPPING comparison, because
       * `computeLocationMatch` compares the IP against `order.shippingAddress`
       * and nothing else. */
      const summary =
        typeof p.bankParagraph === "string" && p.bankParagraph.trim().length > 0
          ? p.bankParagraph.trim()
          : null;
      return {
        locationMatch: typeof p.locationMatch === "string" ? p.locationMatch : null,
        bankLocationSummary: summary,
      };
    }
    case "device_session_consistency":
      return {
        consistent: p.consistent === true,
        loginPresent: p.loginPresent === true,
      };
    case "order_confirmation": {
      // Pull the order's fulfillment status so claim guards can use it.
      const fulfillmentStatus =
        typeof p.fulfillmentStatus === "string"
          ? p.fulfillmentStatus
          : typeof p.displayFulfillmentStatus === "string"
            ? p.displayFulfillmentStatus
            : null;
      // channel: Shopify Order.sourceName. Gates the
      // transaction_channel_online_present predicate (v2.2+).
      const channel = typeof p.channel === "string" ? p.channel : null;
      return {
        confirmationSent: p.confirmationSent === true || typeof p.confirmationEmail === "string",
        fulfillmentStatus,
        channel,
      };
    }
    case "product_description":
      return {
        hasListing: section.data?.title !== undefined || section.data?.productTitle !== undefined,
      };
    case "duplicate_explanation":
      return {
        distinct: p.distinct === true,
      };
    default:
      return {};
  }
}

/** English labels for the LLM context. The canonical registry stopped
 *  carrying English in Phase 3 because merchant-UI labels must be
 *  translated; the bank-rebuttal LLM, however, always speaks English
 *  to a bank reviewer, so the prompt context needs concrete English
 *  identifiers. Keep this map in sync with `messages/en.json`
 *  `disputes.signalLabel.*` — the strings match by construction. */
const FIELD_LABEL_EN: Record<string, string> = {
  avs_cvv_match: "Payment authentication",
  tds_authentication: "3-D Secure authentication",
  fraud_risk_screening: "Pre-authorization fraud screening",
  delivery_proof: "Delivery confirmation",
  shipping_tracking: "Shipping tracking",
  ip_location_check: "IP & location consistency",
  device_session_consistency: "Device & session signals",
  customer_communication: "Customer communication",
  customer_account_info: "Customer account history",
  activity_log: "Customer activity log",
  supporting_documents: "Supplementary documents",
  refund_policy: "Refund policy",
  refund_record: "Refund record",
  no_return_initiated: "No return initiated",
  shipping_policy: "Shipping policy",
  cancellation_policy: "Cancellation policy",
  order_confirmation: "Order record",
  product_description: "Product listing",
  duplicate_explanation: "Duplicate-charge explanation",
};

function labelForField(fieldKey: string): string {
  return FIELD_LABEL_EN[fieldKey] ?? fieldKey;
}

/* ── Package mode derivation ── */

/**
 * Exported for the D-1 replay (`docs/evidence-model/p4/d1-billing-match-replay.md`).
 *
 * The replay must enumerate mode transitions through the REAL rule, not a copy
 * of it: a measurement taken against a re-implementation measures the
 * re-implementation. Production callers still reach it only via `classifyFacts`.
 */
export function derivePackageMode(input: {
  approvedFacts: EvidenceFact[];
  caseStrength: CaseStrengthLevel;
  fatalLoss: FatalLossLike;
  reasonCodeModule: ReasonCodeGuidance;
}): PackageMode {
  if (input.caseStrength === "weak" || input.caseStrength === "insufficient") {
    return "narrow";
  }
  if (input.fatalLoss.triggered) {
    return "narrow";
  }
  const distinctCategories = new Set(input.approvedFacts.map((f) => f.category));
  if (distinctCategories.size < 2) {
    return "narrow";
  }
  for (const required of input.reasonCodeModule.criticalCategories) {
    if (!distinctCategories.has(required)) {
      return "narrow";
    }
  }
  return "full";
}

/* ── Main classifier ── */

export function classifyFacts(input: ClassifyFactsInput): FactClassificationResult {
  // Coverage short-circuit.
  if (input.coverage.state === "covered_shopify") {
    return {
      approved: [],
      internalOnly: [],
      submissionRisk: [],
      missing: [],
      manual: [],
      packageMode: "narrow",
      eligible: false,
      ineligibilityReason: "covered_shopify",
      predicateEvaluations: evaluateAllPredicates([]),
    };
  }

  const approved: EvidenceFact[] = [];
  const internalOnly: EvidenceFact[] = [];
  const submissionRisk: EvidenceFact[] = [];

  let factIndex = 0;
  const itemBySectionIdx = new Map<number, EvidenceItemLike>();
  // Best-effort mapping: section[i] ↔ evidence_items[i] when sourced from the
  // same build. Not load-bearing — sourceRef is informational.
  input.evidenceItems.forEach((it, i) => itemBySectionIdx.set(i, it));

  for (let i = 0; i < input.sections.length; i += 1) {
    const section = input.sections[i];
    const sourceRef = itemBySectionIdx.get(i)?.id ?? null;

    for (const fieldKey of section.fieldsProvided) {
      // A RETIRED field key produces no fact — no category, no strength, no
      // value in the LLM payload, no citation. Stated explicitly rather than
      // relying on the `!spec` fall-through below, because a deliberate
      // retirement and an unregistered key must never look the same in code
      // (`lib/evidence/model/retiredKeys.ts`).
      if (isRetiredFieldKey(fieldKey)) continue;
      const spec = CANONICAL_EVIDENCE[fieldKey];
      if (!spec) continue;

      const cat: EvidenceCategory = categoryFor({
        fieldKey,
        payload: section.data,
      });
      if (cat === "invalid") continue;

      const value = extractValue(fieldKey, section.data, section);
      const category = categoryForField(fieldKey, section.data);
      const factId = `f${factIndex++}`;

      const isSubmissionRisk = SUBMISSION_RISK_FIELDS.has(fieldKey);
      const isInternalOnly = INTERNAL_ONLY_FIELDS.has(fieldKey);

      // 3-D Secure is bank-citable only when it actually helps: a liability
      // shift (ECI 02/05, authenticated, no SCA exemption) or a merchant-
      // confirmed authentication. Everything else — "attempted", exempted, or
      // a bare receipt read we cannot verify — stays out of every bank-facing
      // surface.
      //
      // This lives here, not in the PDF renderer, because bank-inclusion
      // predicates belong to the classifier by contract (see the header of
      // buildLlmFactPayload): the LLM payload, the Evidence Basis rows and the
      // workspace line items then agree by construction. They did not before:
      // on blume-box #352552 the narrative correctly refused to argue 3DS
      // while the PDF's Evidence Basis table asserted "3DS authenticated" to
      // the same issuer, three lines below.
      const isUnciteableThreeDs = isUnciteableThreeDsFact(fieldKey, value);

      // A CVV-only payment-verification match: kept as an internal fact,
      // never citable (PR-C2 decision 1). Read from the SECTION payload, not
      // from `value` — `extractValue` has already dropped the raw codes for
      // any fact whose address half is missing.
      const isUnciteableVerification = isUnciteablePaymentVerificationFact(
        fieldKey,
        section.data,
      );

      const fact: EvidenceFact = {
        id: factId,
        category,
        label: labelForField(fieldKey),
        value: { ...value, fieldKey },
        source: section.source,
        sourceRef,
        strength: cat,
        bankEligible:
          !isInternalOnly &&
          !isUnciteableThreeDs &&
          !isUnciteableVerification &&
          (cat === "strong" || cat === "moderate"),
        merchantVisible: true,
        internalOnly: isInternalOnly,
        includeInBankNarrative:
          !isInternalOnly &&
          !isSubmissionRisk &&
          !isUnciteableThreeDs &&
          !isUnciteableVerification &&
          (cat === "strong" || cat === "moderate"),
        submissionRisk: isSubmissionRisk,
        confidence: null,
      };

      if (isInternalOnly) {
        internalOnly.push(fact);
        if (isSubmissionRisk) submissionRisk.push(fact);
        continue;
      }
      if (isSubmissionRisk) {
        submissionRisk.push(fact);
        continue;
      }
      approved.push(fact);
    }
  }

  // Missing-evidence rows — internal only, never sent to the LLM.
  const missing: MissingEvidence[] = input.checklist
    .filter((c) => c.status === "missing")
    // A persisted `checklist_v2` written before the retirement still carries a
    // row for the retired field (112 packs on prod at the PR-C4 census).
    // `reconcileChecklistWithCollectedFields` drops it on every read, but this
    // classifier is also called with checklists from other paths — so the
    // retirement is enforced here too rather than assumed upstream.
    .filter((c) => !isRetiredFieldKey(c.field))
    .map((c) => ({
      category: categoryForField(c.field, null),
      label: labelForField(c.field),
      reason: "Not collected at build time",
      merchantRecommendation: `Add ${labelForField(c.field).toLowerCase()} to strengthen the case.`,
      bankVisible: false as const,
    }));

  // Manual evidence — keep only bank-eligible + include-in-package rows.
  const manual: ManualEvidenceRecord[] = input.manualRows
    .filter((m) => m.includeInPackage !== false)
    .map((m) => ({
      id: m.id,
      packageId: input.packageId,
      evidenceItemId: m.evidenceItemId,
      filename: m.filename,
      fileUrl: m.fileUrl ?? null,
      fileType: m.fileType ?? null,
      uploadedBy: m.uploadedBy ?? null,
      uploadedAt: m.uploadedAt ?? new Date().toISOString(),
      description: m.description ?? null,
      bankEligible: m.bankEligible ?? false,
      includeInPackage: m.includeInPackage ?? true,
      includeInBankNarrative: m.includeInBankNarrative ?? false,
      evidenceCategory: m.evidenceCategory ?? null,
    }));

  // Promote bank-eligible manual evidence into the approved list so the LLM
  // sees something it can reference. They get strength=supporting because
  // their content is merchant-supplied and uncategorised by the registry.
  for (const m of manual) {
    if (!m.bankEligible) continue;
    const factId = `f${factIndex++}`;
    approved.push({
      id: factId,
      category: m.evidenceCategory ?? "manual_evidence",
      label: m.filename,
      value: {
        description: m.description ?? null,
        fileType: m.fileType ?? null,
        manualEvidenceId: m.id,
      },
      source: "manual_upload",
      sourceRef: m.evidenceItemId,
      strength: "supporting",
      bankEligible: true,
      merchantVisible: true,
      internalOnly: false,
      includeInBankNarrative: m.includeInBankNarrative,
      submissionRisk: false,
      confidence: null,
    });
  }

  // Eligibility check.
  // Delegated to the ONE bank-inclusion predicate (`lib/defence/bankInclusion.ts`).
  // Same rule, same result — the expression was identical here, in the Evidence
  // Basis renderer and in the workspace route, and identical-by-comment is how
  // the LLM payload's weaker copy went unnoticed (C-1).
  const eligible = approved.some(isBankIncludedFact);
  if (!eligible) {
    return {
      approved,
      internalOnly,
      submissionRisk,
      missing,
      manual,
      packageMode: "narrow",
      eligible: false,
      ineligibilityReason: "no_bank_eligible_facts",
      predicateEvaluations: evaluateAllPredicates(approved),
    };
  }

  const packageMode = derivePackageMode({
    approvedFacts: approved,
    caseStrength: input.caseStrength,
    fatalLoss: input.fatalLoss,
    reasonCodeModule: input.reasonCodeModule,
  });

  return {
    approved,
    internalOnly,
    submissionRisk,
    missing,
    manual,
    packageMode,
    eligible: true,
    ineligibilityReason: null,
    predicateEvaluations: evaluateAllPredicates(approved),
  };
}

/**
 * Test-only re-export of the internal value extractor. Production
 * callers go through `classifyFacts`. Used by
 * `narrativeQualityInvariants.test.ts` to lock in the
 * `verificationSummary` translation on `avs_cvv_match`.
 */
export function extractValueForTest(
  fieldKey: string,
  payload: Record<string, unknown> | null,
): Record<string, unknown> {
  return extractValue(fieldKey, payload, {
    type: "test",
    label: "test",
    source: "test",
    fieldsProvided: [],
    data: {},
  } as unknown as PackSectionLike);
}
