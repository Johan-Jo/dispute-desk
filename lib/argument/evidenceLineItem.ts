/**
 * Evidence line-item derivation — single source of truth for per-row
 * dispute-detail UI state.
 *
 * Inputs come from the workspace pipeline (`ChecklistItemV2[]` + the
 * already-classified `EvidenceFact[]` + raw payloads). The output is
 * consumed by:
 *
 *   - The Overview tab's "Evidence collected" list
 *   - The Evidence tab's "Evidence in your defence package" section
 *   - The Review/Submit tab's "Inclusion review" interface
 *   - The Submission Summary panel
 *
 * Every UI surface reads the booleans (`includedInDefencePackage`,
 * `includedInBankArgument`, `usedAsPositiveBankEvidence`) — never the
 * `submissionMethod` enum — for gating "is this in X?" questions. The
 * enum only describes WHY a row landed in its current state.
 *
 * Hard invariant: a merchant `force_include` override NEVER, by itself,
 * elevates a row to positive bank evidence. The override is honored
 * only when the payload independently qualifies via the canonical
 * categorizer.
 *
 * Plan: C:\Users\johan\.claude\plans\do-a-plan-for-scalable-parrot.md
 */

import {
  CANONICAL_EVIDENCE,
  categorizeEvidenceField,
  disputeFreeHistoryState,
  effectivePriorOrders,
  type EvidenceCategory,
} from "./canonicalEvidence";
import { bankFacingScreeningSignals } from "./fraudScreeningSignals";
import {
  numberFromTrackingUrl,
  resolveDeliveryTitle,
  resolveDeliveryReceipt,
} from "./deliveryPresentation";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import type { EvidenceFact } from "@/lib/defence/types";
import {
  INTERNAL_ONLY_FIELDS,
  isFieldBankEligible,
} from "@/lib/defence/factClassifier";
import { isNonEvidenceAccountHistoryRow } from "@/lib/automation/merchantUiHiddenFields";
import { readPaymentVerification } from "./paymentVerification";
import type { CaseStrengthContribution } from "./caseStrength";
import type { ReasonFamily } from "./reasonFamily";
import type { I18nToken } from "@/lib/i18n/token";
import enMessages from "@/messages/en.json";

/**
 * Resolve an `I18nToken` to its English string using `messages/en.json`.
 * Used to populate the legacy `EvidenceLineItem.reason` field for
 * non-UI consumers (emails, PDFs, tests) that still read resolved
 * English copy. UI render sites should resolve `reasonToken` via the
 * active translator instead so non-English locales display correctly.
 */
function resolveTokenEn(token: I18nToken): string {
  const parts = token.key.split(".");
  let node: unknown = enMessages as unknown;
  for (const p of parts) {
    if (node && typeof node === "object" && p in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[p];
    } else {
      return token.key;
    }
  }
  if (typeof node !== "string") return token.key;
  let out = node;
  if (token.params) {
    for (const [k, v] of Object.entries(token.params)) {
      if (typeof v === "object" && v !== null && (v as { type?: string }).type === "i18n-key") {
        // Nested key params — rare in this surface. Resolve recursively.
        const inner = resolveTokenEn({
          key: (v as { key: string }).key,
          params: (v as { params?: Record<string, string | number> }).params as
            | Record<string, string | number>
            | undefined,
        });
        out = out.replace(new RegExp(`\\{${k}\\}`, "g"), inner);
      } else {
        out = out.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
  }
  return out;
}

export type StrengthContribution =
  | "strong"
  | "moderate"
  | "supporting"
  | "internal_only"
  | "none";

export type SubmissionMethod =
  | "bank_argument"
  | "context_only"
  | "internal_only"
  | "not_included"
  | "not_supported"
  | "excluded"
  | "failed_upload"
  | "waived";

export type EvidenceSource =
  | "shopify"
  | "merchant_upload"
  | "carrier"
  | "helpdesk"
  | "derived"
  | "manual";

/**
 * An internal-only warning attached to a row that still carries useful
 * context. For example: `order_confirmation` may stay `context_only`
 * (order details flow into the PDF) while a billing/shipping mismatch
 * is surfaced here as a warning. Standalone synthetic signals with no
 * field anchor continue to render through `deriveInternalOnlySignals`
 * in the dedicated Internal-only Signals UI section.
 */
export interface InternalSignalWarning {
  id: string;
  label: string;
  reason: string;
  severity: "info" | "warning";
}

export interface EvidenceLineItem {
  id: string;
  field: string;
  label: string;
  source: EvidenceSource;
  hasEvidence: boolean;
  strengthContribution: StrengthContribution;
  bankEligible: boolean;
  merchantVisible: boolean;
  /** True iff `submissionMethod ∈ {bank_argument, context_only}`. */
  includedInDefencePackage: boolean;
  /** True iff `submissionMethod === "bank_argument" && bankEligible && !isNegativeOrAmbiguous`. */
  includedInBankArgument: boolean;
  /** True iff `includedInBankArgument && strengthContribution ∈ {strong, moderate} && includeInBankNarrative`. */
  usedAsPositiveBankEvidence: boolean;
  submittedToShopify: boolean;
  submissionMethod: SubmissionMethod;
  isNegativeOrAmbiguous: boolean;
  /** Legacy English reason string — resolved from `reasonToken` at
   *  derivation time. Kept as a back-compat shim for non-UI consumers
   *  (emails, PDFs, tests asserting on shape). UI surfaces that render
   *  in-locale should resolve `reasonToken` through next-intl instead. */
  reason: string;
  /** Structural-i18n token form of the reason copy. Resolve via
   *  `resolveToken(useTranslations(), li.reasonToken)` at the leaf JSX
   *  boundary. The token shape supports params (e.g. `{ prior, sinceLabel,
   *  signals, facts }`) so dynamic payload-aware helpers translate
   *  correctly without exposing raw English to non-English locales. */
  reasonToken: I18nToken;
  /** True when a `force_include` would actually surface something
   *  bank-facing. False when the row has no payload to elevate (e.g.
   *  AVS codes the gateway never returned, delivery proof for an
   *  unshipped order). The Inclusion Review section uses this to
   *  disable the "Include in package" button — clicking it on a row
   *  with no payload is a no-op. */
  canBeForceIncluded: boolean;
  /** Optional internal-only warnings attached to a row whose primary
   *  evidentiary value is still useful as context. Surfaced by UI
   *  components that want to flag the row without changing its
   *  submission state. */
  internalSignals?: InternalSignalWarning[];
  /** Most recent acknowledged-risk override on this field, if any.
   *  Surfaces the merchant's explicit risk acknowledgement on the
   *  Inclusion Review row as a caption ("You overrode this on Month
   *  DD"). Only set when an `evidence_inclusion_overridden_with_warning`
   *  audit row exists for this field — routine include/exclude
   *  toggles do not produce an override history entry. */
  overrideHistory?: OverrideHistoryEntry;
  /** Proof-state-specific display label token, resolved by every render
   *  surface INSTEAD of the generic canonical `labelKey` when present.
   *  Currently set only on the collapsed delivery row so a shipped-but-
   *  unconfirmed order reads "Shipping & tracking" and a confirmed one
   *  reads "Delivery confirmation (signature/carrier)" — never a bare
   *  "Delivery confirmation" that the score contradicts. */
  displayLabelToken?: I18nToken;
  /** Compact one-line concrete facts for the row (carrier · tracking ·
   *  shipped/delivered dates). Structural: an ordered list of tokens
   *  the leaf renderer joins with " · ". Present only on the delivery
   *  row today. `trackingUrl` (below) turns the tracking segment into a
   *  link. */
  factsTokens?: I18nToken[];
  /** Clickable carrier tracking URL for the facts line, when the
   *  fulfillment payload carried one. */
  trackingUrl?: string | null;
  /** Raw tracking number, so a renderer can show it as the link text
   *  even when it isn't wrapped in a facts token. */
  trackingNumber?: string | null;
}

/** Audit-derived record of the merchant's most recent acknowledged
 *  override on a field. Comes from the workspace API's lookup of
 *  `evidence_inclusion_overridden_with_warning` audit events. */
export interface OverrideHistoryEntry {
  /** "force_include" or "force_exclude" or "clear" — matches the
   *  `action` enum in the audit row. */
  action: "force_include" | "force_exclude" | "clear" | null;
  /** ISO timestamp when the merchant confirmed the risk acknowledgement
   *  via the warning modal. */
  confirmedAt: string;
  /** Actor type from the audit row — typically "merchant". */
  actorType: string | null;
}

export interface DeriveEvidenceLineItemsInput {
  checklist: ChecklistItemV2[];
  facts: EvidenceFact[];
  payloadByField: Map<string, unknown>;
  contributions: {
    strong: CaseStrengthContribution[];
    moderate: CaseStrengthContribution[];
  };
  packSavedToShopify: boolean;
  excludedFields: Set<string>;
  attachmentUploadFailures: Map<string, string>;
  inclusionOverrides: Map<string, "force_include" | "force_exclude">;
  reasonFamily: ReasonFamily;
  /** Optional map of internal-only warnings to attach to field-keyed
   *  rows. Keyed by field. Mirrors the synthetic signals emitted by
   *  `deriveInternalOnlySignals` so the dedicated Internal-only Signals
   *  UI section and the line items stay consistent. */
  internalSignalsByField?: Map<string, InternalSignalWarning[]>;
  /** Optional map of acknowledged-risk override audit entries, keyed
   *  by field. Populated by the workspace API from
   *  `evidence_inclusion_overridden_with_warning` audit rows. The
   *  derivation just attaches the entry to the matching line item —
   *  no behavioural change, purely a display surface. */
  overrideHistoryByField?: Map<string, OverrideHistoryEntry>;
}

/* ── Source inference ────────────────────────────────────────────── */

const MERCHANT_FIELDS = new Set<string>([
  "supporting_documents",
  "product_description",
  "duplicate_explanation",
  "customer_communication",
]);

const DERIVED_FIELDS = new Set<string>([
  "ip_location_check",
  "device_session_consistency",
  "avs_cvv_match",
]);

function inferSource(field: string): EvidenceSource {
  if (MERCHANT_FIELDS.has(field)) return "merchant_upload";
  if (DERIVED_FIELDS.has(field)) return "derived";
  return "shopify";
}

/* ── Reason copy ─────────────────────────────────────────────────── */
/**
 * Reason copy lives in `messages/{locale}.json` under
 * `disputes.reviewTab.inclusion.reasons.*`. The lib emits structural
 * `I18nToken` objects; the leaf JSX renderer resolves them via
 * `resolveToken(useTranslations(), li.reasonToken)`. Non-UI consumers
 * (emails, PDFs, tests asserting on shape) read `li.reason`, which is
 * the resolved English equivalent.
 *
 * NEVER hardcode the resolved English here — every new reason needs a
 * matching `messages/en.json` key AND translations in all locales
 * (sv/de/es/fr/pt). The `find-english-placeholders.mjs` scanner CI
 * gate catches missing translations.
 */

const REASONS_NS = "disputes.reviewTab.inclusion.reasons";

const REASON_FOR_METHOD: Record<SubmissionMethod, I18nToken> = {
  bank_argument: { key: `${REASONS_NS}.method.bank_argument` },
  context_only: { key: `${REASONS_NS}.method.context_only` },
  internal_only: { key: `${REASONS_NS}.method.internal_only` },
  not_included: { key: `${REASONS_NS}.method.not_included` },
  not_supported: { key: `${REASONS_NS}.method.not_supported` },
  excluded: { key: `${REASONS_NS}.method.excluded` },
  failed_upload: { key: `${REASONS_NS}.method.failed_upload` },
  waived: { key: `${REASONS_NS}.method.waived` },
};

const REASON_OVERRIDES: Record<string, Partial<Record<SubmissionMethod, I18nToken>>> = {
  ip_location_check: {
    bank_argument: { key: `${REASONS_NS}.ipLocation.bankArgumentDefault` },
    context_only: { key: `${REASONS_NS}.ipLocation.contextOnlyDefault` },
    internal_only: { key: `${REASONS_NS}.ipLocation.internalAmbiguous` },
    not_included: { key: `${REASONS_NS}.ipLocation.notIncluded` },
  },
  device_session_consistency: {
    internal_only: { key: `${REASONS_NS}.deviceSession.internal` },
    not_included: { key: `${REASONS_NS}.deviceSession.notIncluded` },
  },
  fraud_risk_screening: {
    bank_argument: { key: `${REASONS_NS}.fraudScreening.bankArgument` },
    context_only: { key: `${REASONS_NS}.fraudScreening.contextOnly` },
    internal_only: { key: `${REASONS_NS}.fraudScreening.internal` },
    not_included: { key: `${REASONS_NS}.fraudScreening.notIncluded` },
  },
  refund_policy: {
    context_only: { key: `${REASONS_NS}.refundPolicy.contextOnly` },
    not_included: { key: `${REASONS_NS}.refundPolicy.notIncluded` },
  },
  shipping_policy: {
    context_only: { key: `${REASONS_NS}.shippingPolicy.contextOnly` },
    not_included: { key: `${REASONS_NS}.shippingPolicy.notIncluded` },
  },
  cancellation_policy: {
    context_only: { key: `${REASONS_NS}.cancellationPolicy.contextOnly` },
    not_included: { key: `${REASONS_NS}.cancellationPolicy.notIncluded` },
  },
  order_confirmation: {
    context_only: { key: `${REASONS_NS}.orderConfirmation.contextOnly` },
    not_included: { key: `${REASONS_NS}.orderConfirmation.notIncluded` },
  },
  avs_cvv_match: {
    bank_argument: { key: `${REASONS_NS}.avsCvv.bankArgument` },
    not_included: { key: `${REASONS_NS}.avsCvv.notIncluded` },
  },
  shipping_tracking: {
    not_included: { key: `${REASONS_NS}.shippingTracking.notIncluded` },
  },
  delivery_proof: {
    not_included: { key: `${REASONS_NS}.deliveryProof.notIncluded` },
  },
  refund_record: {
    not_included: { key: `${REASONS_NS}.refundRecord.notIncluded` },
  },
  tds_authentication: {
    not_included: { key: `${REASONS_NS}.tdsAuthentication.notIncluded` },
  },
  customer_communication: {
    not_included: { key: `${REASONS_NS}.customerCommunication.notIncluded` },
  },
  customer_account_info: {
    not_included: { key: `${REASONS_NS}.customerAccount.notIncluded` },
  },
  activity_log: {
    not_included: { key: `${REASONS_NS}.activityLog.notIncluded` },
  },
  supporting_documents: {
    not_included: { key: `${REASONS_NS}.supportingDocuments.notIncluded` },
  },
  product_description: {
    not_included: { key: `${REASONS_NS}.productDescription.notIncluded` },
  },
  duplicate_explanation: {
    not_included: { key: `${REASONS_NS}.duplicateExplanation.notIncluded` },
  },
};

/**
 * Fields where a force_include can never produce a useful row because
 * the underlying payload comes from a source DisputeDesk cannot
 * influence (the payment gateway, the carrier, Shopify's risk engine,
 * etc.). The button in the Inclusion Review UI is disabled for these
 * when they're in the `not_included` state.
 */
const SOURCE_OUTSIDE_MERCHANT_CONTROL = new Set<string>([
  "avs_cvv_match",
  "tds_authentication",
  "fraud_risk_screening",
  "ip_location_check",
  "device_session_consistency",
  "shipping_tracking",
  "delivery_proof",
  "order_confirmation",
  "customer_account_info",
  "activity_log",
  "product_description",
]);

/**
 * Fields that DO accept merchant-driven force_include even when no
 * fact is on the row yet — uploading a document or pasting in a
 * snippet IS the payload-producing action. Listed explicitly so the
 * UI surfaces an actionable button.
 */
const FIELDS_MERCHANT_CAN_FORCE_INCLUDE = new Set<string>([
  "supporting_documents",
  "customer_communication",
  "duplicate_explanation",
  "refund_policy",
  "shipping_policy",
  "cancellation_policy",
]);

function reasonFor(
  field: string,
  method: SubmissionMethod,
  payload: unknown,
): I18nToken {
  // Payload-aware specificity for internal-only signals: the merchant
  // gets to see WHY a signal was kept internal (e.g. "IP country
  // mismatch" vs "VPN/proxy detected") instead of the generic
  // "ambiguous or unfavourable" line. Mirrors the granular reasons
  // already produced for the standalone Internal-only Signals UI
  // section by `lib/argument/internalSignals.ts` — keeping the two
  // surfaces in lockstep.
  if (method === "internal_only") {
    if (field === "customer_account_info") {
      const specific = customerAccountInternalReason(payload);
      if (specific) return specific;
    }
    const specific = specificInternalReason(field, payload);
    if (specific) return specific;
  }
  // Payload-aware specificity for fraud_risk_screening: the merchant
  // and the bank reviewer both deserve to see exactly which signals
  // Shopify returned, not a generic "recommended ACCEPT" line.
  if (
    field === "fraud_risk_screening" &&
    (method === "bank_argument" || method === "context_only")
  ) {
    const specific = fraudScreeningReasonWithSignals(payload, method);
    if (specific) return specific;
  }
  // Payload-aware specificity for customer_account_info: "context not
  // decisive" is too generic — the reason WHY this is supporting
  // depends entirely on the payload (new customer vs. returning vs.
  // returning-with-prior-chargebacks). The bank reviewer reads the row
  // very differently in each case.
  if (
    field === "customer_account_info" &&
    (method === "bank_argument" || method === "context_only")
  ) {
    const specific = customerAccountReasonFromPayload(payload, method);
    if (specific) return specific;
  }
  // Payload-aware specificity for ip_location_check: surface WHAT
  // matched (same city vs. same country) rather than the generic
  // "consistent with the cardholder's location" line.
  if (
    field === "ip_location_check" &&
    (method === "bank_argument" || method === "context_only")
  ) {
    const specific = ipLocationReasonFromPayload(payload, method);
    if (specific) return specific;
  }
  // Payload-aware specificity for avs_cvv_match: name EXACTLY what the
  // gateway verified (address and/or CVV) instead of a generic line. The
  // copy states what matched the issuer's records — it never claims the
  // match proves cardholder identity or authorization, and it never
  // claims both matched when only one did.
  if (
    field === "avs_cvv_match" &&
    (method === "bank_argument" || method === "context_only")
  ) {
    const specific = avsCvvReasonFromPayload(payload);
    if (specific) return specific;
  }
  return REASON_OVERRIDES[field]?.[method] ?? REASON_FOR_METHOD[method];
}

/**
 * Builds the row reason for avs_cvv_match from the actual gateway result,
 * read through the single owner (`lib/argument/paymentVerification.ts`).
 * Returns null when nothing matched (callers fall back to the static
 * REASON_OVERRIDES entry).
 *
 * The copy variant never reports a single successful verification as "both
 * matched":
 *   - address + security code both match → bothMatched
 *   - address only: the canonical `street_match` result → streetMatched;
 *     `postal_match` → postalMatched; any other match → addressMatched
 *   - CVV only → `cvvOnlyInternal`. PR-C2 decision 1: that row is no longer
 *     bank-eligible, so the copy says what is true — the match is on record
 *     and kept internal, because a security-code match is not an address
 *     match. The old `cvvMatched` string described it as cited evidence.
 */
function avsCvvReasonFromPayload(payload: unknown): I18nToken | null {
  const v = readPaymentVerification(payload);

  if (v.addressVerified && v.securityCodeVerified) {
    return { key: `${REASONS_NS}.avsCvv.bothMatched` };
  }
  if (v.addressVerified) {
    // Selected from the CANONICAL normalized result, never from the letter
    // (PR-C3). `A`/`W` were a seventh reading of the code space living in the
    // copy layer, and a copy layer that knows what a letter means is a copy
    // layer that can disagree with the grader about it.
    switch (v.avs.normalized) {
      case "street_match":
        return { key: `${REASONS_NS}.avsCvv.streetMatched` };
      case "postal_match":
        return { key: `${REASONS_NS}.avsCvv.postalMatched` };
      default:
        return { key: `${REASONS_NS}.avsCvv.addressMatched` };
    }
  }
  if (v.securityCodeVerified) return { key: `${REASONS_NS}.avsCvv.cvvOnlyInternal` };
  return null;
}

/**
 * Builds the row reason token for fraud_risk_screening with the actual
 * Shopify positiveFacts inlined as a param. Returns null when the
 * payload doesn't carry usable signals — callers fall back to the
 * static REASON_OVERRIDES entry.
 */
function fraudScreeningReasonWithSignals(
  payload: unknown,
  method: "bank_argument" | "context_only",
): I18nToken | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  /* BANK-FACING SUBSET ONLY. These signals are inlined verbatim into the
   * Evidence Basis row, which reaches the issuer with no claim guard between
   * it and the page — so a verification phrase here is an unlicensed
   * verification claim on a bank surface. Same owner as the LLM payload
   * (`fraudScreeningSignals.ts`); a second regex here is the drift that
   * module exists to prevent. */
  const facts = bankFacingScreeningSignals(p.positiveFacts);
  if (facts.length === 0) return null;
  const signals = facts.join("; ");
  if (method === "bank_argument") {
    return {
      key: `${REASONS_NS}.fraudScreening.bankArgumentWithSignals`,
      params: { signals },
    };
  }
  return {
    key: `${REASONS_NS}.fraudScreening.contextOnlyWithSignals`,
    params: { signals },
  };
}

/**
 * Builds the row reason for customer_account_info from the actual
 * payload (totalOrders, priorUndisputedOrders, disputeFreeHistory,
 * customerSince). Returns null when no payload is present — callers
 * fall back to the static REASON_OVERRIDES entry.
 *
 * Two cases reach the bank-facing methods (bank_argument /
 * context_only):
 *   1. Returning customer (>=1 prior order) with no prior disputes →
 *      cite the count and the dispute-free history. This is genuinely
 *      supportive on a fraud rebuttal.
 *   2. Returning customer with prior chargebacks → context only with
 *      an explicit caveat so the bank reviewer reads it correctly.
 *
 * First-time customers (prior === 0) do NOT reach this helper on a
 * fraud dispute — the derivation routes them to `internal_only` via
 * `isNegativeOrAmbiguous`, because "new account" on an unauthorized-
 * transaction rebuttal is a fraud INDICATOR, not supporting evidence.
 * Surfacing it would invite the bank to weigh it AGAINST the merchant.
 * Non-fraud reason codes (INR, subscription canceled, etc.) still
 * route through this helper because new-customer status is neutral
 * there — the helper handles that case too.
 */
function customerAccountReasonFromPayload(
  payload: unknown,
  method: "bank_argument" | "context_only",
): I18nToken | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  // Prior orders EXCLUDING the disputed one — keeps the "returning
  // customer (N prior orders)" copy from counting the disputed order as
  // its own history.
  const prior = effectivePriorOrders(p);
  const state = disputeFreeHistoryState(p);
  const sinceRaw = typeof p.customerSince === "string" ? p.customerSince : null;
  const sinceLabel = formatCustomerSince(sinceRaw);

  // VERIFIED dispute-free — the only branch allowed to tell the issuer
  // the history is dispute-free. Requires `disputeFreeHistory === true`,
  // which only `loadPriorOrderHistory` writes and only when it checked
  // our full ingested history for this customer.
  if (prior !== null && prior >= 1 && state === "dispute_free") {
    const isSingular = prior === 1;
    const hasSince = sinceLabel != null;
    const variantStem =
      method === "bank_argument" ? "returningBank" : "returningContext";
    const numberSuffix = isSingular ? "Singular" : "Plural";
    const sinceSuffix = hasSince ? "Since" : "";
    const key = `${REASONS_NS}.customerAccount.${variantStem}${numberSuffix}${sinceSuffix}`;
    const params: Record<string, string | number> = { prior };
    if (hasSince) params.sinceLabel = sinceLabel;
    return { key, params };
  }

  // UNVERIFIED — a returning customer whose prior orders we could not
  // fully check for disputes. State the count, claim nothing about
  // whether that history is clean. This branch used to be swallowed by
  // the one above via `disputeFreeHistory !== false`.
  if (prior !== null && prior >= 1 && state === "unknown") {
    const isSingular = prior === 1;
    const hasSince = sinceLabel != null;
    const numberSuffix = isSingular ? "Singular" : "Plural";
    const sinceSuffix = hasSince ? "Since" : "";
    const key = `${REASONS_NS}.customerAccount.returningUnverified${numberSuffix}${sinceSuffix}`;
    const params: Record<string, string | number> = { prior };
    if (hasSince) params.sinceLabel = sinceLabel;
    return { key, params };
  }

  if (prior !== null && prior >= 1 && state === "has_disputes") {
    const isSingular = prior === 1;
    const key = `${REASONS_NS}.customerAccount.returningWithDisputes${isSingular ? "Singular" : "Plural"}`;
    return { key, params: { prior } };
  }

  // First-time customer on a NON-fraud reason code (fraud codes don't
  // reach this branch — see the function header). Honest plain text.
  if (prior === 0) {
    if (sinceLabel) {
      return {
        key: `${REASONS_NS}.customerAccount.firstTimeSince`,
        params: { sinceLabel },
      };
    }
    return { key: `${REASONS_NS}.customerAccount.firstTime` };
  }

  return null;
}

/**
 * Builds the row reason for ip_location_check from the actual payload
 * (locationMatch, ipinfo.country). Returns null when the payload
 * doesn't carry usable signals — callers fall back to the static
 * REASON_OVERRIDES entry.
 *
 * The collector pre-gates emission on a clean payload, so by the time
 * this fires we know: locationMatch ∈ {same_city, same_country}, no
 * VPN/proxy/hosting, IP history consistent. Phrasing surfaces the
 * country/region match grain without exposing the raw IP, city, ISP
 * or coordinates — same rule the LLM narrative obeys.
 */
function ipLocationReasonFromPayload(
  payload: unknown,
  method: "bank_argument" | "context_only",
): I18nToken | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const match = typeof p.locationMatch === "string" ? p.locationMatch : null;
  if (match !== "same_city" && match !== "same_country") return null;

  if (match === "same_city") {
    return {
      key:
        method === "bank_argument"
          ? `${REASONS_NS}.ipLocation.sameCityBank`
          : `${REASONS_NS}.ipLocation.sameCityContext`,
    };
  }
  // same_country
  return {
    key:
      method === "bank_argument"
        ? `${REASONS_NS}.ipLocation.sameCountryBank`
        : `${REASONS_NS}.ipLocation.sameCountryContext`,
  };
}

/**
 * Merchant-facing reason text shown when customer_account_info is
 * kept internal because the payload is weakening on a fraud dispute
 * (first-time customer, or returning customer with prior chargebacks).
 * Never reaches the bank.
 */
function customerAccountInternalReason(payload: unknown): I18nToken | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  // Same corrected prior-order count as the guard above.
  const prior = effectivePriorOrders(p);
  const sinceRaw = typeof p.customerSince === "string" ? p.customerSince : null;
  const sinceLabel = formatCustomerSince(sinceRaw);

  if (prior === 0 || prior === null) {
    if (sinceLabel) {
      return {
        key: `${REASONS_NS}.customerAccount.internalFirstTimeSince`,
        params: { sinceLabel },
      };
    }
    return { key: `${REASONS_NS}.customerAccount.internalFirstTime` };
  }
  if (disputeFreeHistoryState(p) === "has_disputes") {
    return { key: `${REASONS_NS}.customerAccount.internalWithDisputes` };
  }
  return null;
}

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Format an ISO timestamp as "Month YYYY" for prose. Returns null on
 *  garbage input so callers can drop the parenthetical. */
function formatCustomerSince(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Specific "kept internal" reason text, derived from the payload
 * when present. Returns null when no payload-specific reason
 * applies; callers fall back to the generic REASON_OVERRIDES entry.
 *
 * The strings mirror `lib/argument/internalSignals.ts` line-by-line
 * so the Inclusion Review row and the Internal-only Signals card on
 * the Evidence tab say the same thing for the same payload.
 */
function specificInternalReason(field: string, payload: unknown): I18nToken | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  if (field === "ip_location_check") {
    const locationMatch =
      typeof p.locationMatch === "string" ? p.locationMatch : null;
    const riskLevel = typeof p.riskLevel === "string" ? p.riskLevel : null;
    if (locationMatch === "different_country") {
      return { key: `${REASONS_NS}.ipLocation.internalDifferentCountry` };
    }
    if (locationMatch === "different_region") {
      return { key: `${REASONS_NS}.ipLocation.internalDifferentRegion` };
    }
    if (riskLevel === "high") {
      return { key: `${REASONS_NS}.ipLocation.internalHighRisk` };
    }
    if (p.bankEligible === false) {
      return { key: `${REASONS_NS}.ipLocation.internalNotBankEligible` };
    }
  }

  if (field === "avs_cvv_match") {
    const v = readPaymentVerification(p);
    // A security-code match with no address match: the row is on record for
    // the merchant and withheld from the bank (PR-C2 decision 1). Checked
    // BEFORE the failure branches so the reason names the reason it is
    // internal, not just the half that failed.
    if (v.cvvOnly) {
      return { key: `${REASONS_NS}.avsCvv.cvvOnlyInternal` };
    }
    // A no-match — the LLM narrative can't lean on AVS/CVV, but the merchant
    // deserves to see what was actually returned by the gateway.
    if (v.avs.outcome === "no_match" && v.cvv.outcome === "no_match") {
      return { key: `${REASONS_NS}.avsCvv.internalBothFail` };
    }
    if (v.avs.outcome === "no_match") {
      return { key: `${REASONS_NS}.avsCvv.internalAvsFail` };
    }
    if (v.cvv.outcome === "no_match") {
      return { key: `${REASONS_NS}.avsCvv.internalCvvFail` };
    }
  }

  if (field === "device_session_consistency") {
    if (p.consistent === false) {
      return { key: `${REASONS_NS}.deviceSession.internalInconsistent` };
    }
  }

  if (field === "fraud_risk_screening") {
    // Surface the actual Shopify verdict so the merchant knows we
    // checked AND what came back. The verdict itself is intentionally
    // never sent to the bank — citing "Shopify recommended cancel" in a
    // rebuttal would tank the response by acknowledging our own
    // platform thought the order was risky.
    //
    // When Shopify returned NEGATIVE-sentiment facts, inline them so the
    // merchant reads WHY the verdict landed where it did (e.g. shipping
    // far from IP, billing country mismatch). The negativeFacts payload
    // is merchant-UI-only — the canonicalEvidence categorizer returns
    // "invalid" for empty positiveFacts so the row never reaches the
    // LLM or the bank submission.
    const recommendation =
      typeof p.recommendation === "string" ? p.recommendation.toUpperCase() : null;
    const riskLevel =
      typeof p.riskLevel === "string" ? p.riskLevel.toUpperCase() : null;
    const negativeFacts = Array.isArray(p.negativeFacts)
      ? (p.negativeFacts as unknown[]).filter(
          (x): x is string => typeof x === "string" && x.trim().length > 0,
        )
      : [];
    const hasFacts = negativeFacts.length > 0;
    const factsJoined = hasFacts ? negativeFacts.join("; ") : "";
    const withSuffix = hasFacts ? "WithFacts" : "";
    const buildToken = (stem: string): I18nToken => {
      const key = `${REASONS_NS}.fraudScreening.${stem}${withSuffix}`;
      return hasFacts ? { key, params: { facts: factsJoined } } : { key };
    };
    if (recommendation === "CANCEL") {
      return buildToken("internalCancel");
    }
    if (recommendation === "REJECT") {
      return buildToken("internalReject");
    }
    if (recommendation === "INVESTIGATE") {
      return buildToken("internalInvestigate");
    }
    if (riskLevel === "HIGH") {
      return buildToken("internalRiskHigh");
    }
    if (riskLevel === "MEDIUM") {
      return buildToken("internalRiskMedium");
    }
  }

  return null;
}

/* ── Categorizer helpers ─────────────────────────────────────────── */

function payloadObjectFor(
  payloadByField: Map<string, unknown>,
  field: string,
): Record<string, unknown> | null {
  const p = payloadByField.get(field);
  if (p == null || typeof p !== "object" || Array.isArray(p)) return null;
  return p as Record<string, unknown>;
}

function strengthFromCategory(cat: EvidenceCategory): StrengthContribution {
  if (cat === "strong") return "strong";
  if (cat === "moderate") return "moderate";
  if (cat === "supporting") return "supporting";
  return "none";
}

function categoryForField(field: string, payload: Record<string, unknown> | null): EvidenceCategory {
  return categorizeEvidenceField(field, payload);
}

/* AVS / CVV match semantics live in `lib/argument/paymentVerification.ts`
 * (PR-C2). This file held one of the six copies. */

function readString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * Negative-or-ambiguous detector. Fires for:
 *   - the three INTERNAL_ONLY_FIELDS (ip/device/fraud-screening),
 *     unconditionally — they ride a separate channel
 *   - `avs_cvv_match` when BOTH codes are non-match (i.e. the payment
 *     authentication failed), per user-spec §H
 *   - `customer_account_info` when the customer has ZERO prior orders
 *     AND the dispute is a fraud claim. A brand-new account on an
 *     unauthorized-transaction rebuttal is a fraud INDICATOR, not
 *     supporting evidence; surfacing it to the bank invites the
 *     reviewer to weigh it AGAINST the merchant. For non-fraud claims
 *     (INR, subscription, etc.) new-customer status is genuinely
 *     neutral, so the gate is fraud-scoped.
 *
 * Used as a belt-and-suspenders check so even if an inclusion override
 * slips past the API guard, the derivation refuses to elevate. Also
 * used to gate `includedInBankArgument` so a negative row never feeds
 * the bank narrative.
 */
function isNegativeOrAmbiguous(
  field: string,
  payload: Record<string, unknown> | null,
  reasonFamily: ReasonFamily,
): boolean {
  if (INTERNAL_ONLY_FIELDS.has(field)) return true;
  if (!payload) return false;

  if (field === "avs_cvv_match") {
    const v = readPaymentVerification(payload);
    // Both codes present AND neither matched → unambiguously negative.
    if (v.avs.present && v.cvv.present && !v.addressVerified && !v.securityCodeVerified) {
      return true;
    }
  }

  if (field === "customer_account_info" && reasonFamily === "fraud") {
    // Prior orders EXCLUDING the disputed one — `effectivePriorOrders`
    // corrects for Shopify's numberOfOrders counting the disputed order
    // itself (pre-fix, totalOrders === 1 read as "one prior order" and a
    // brand-new account sailed into the positive bucket; prod dispute
    // 235d4152, 2026-07-23).
    const prior = effectivePriorOrders(payload);
    // Treat first-order accounts (and missing-history payloads) as a
    // fraud-indicator signal — keep internal so the bank doesn't read
    // "new customer" as a reason to side with the cardholder.
    if (prior === 0 || prior === null) return true;
    // Returning customer but the account has prior chargebacks — also
    // a fraud-weakening signal. Account history with disputes carries
    // the OPPOSITE inference from a clean history.
    //
    // `unknown` deliberately stays bank-facing: "returning customer with
    // N prior orders" is true and useful even unverified. Honesty is
    // carried by the COPY (returningUnverified*), which omits the
    // dispute-free claim, not by hiding the row.
    if (disputeFreeHistoryState(payload) === "has_disputes") return true;
  }

  if (field === "ip_location_check") {
    // Belt-and-suspenders. The collector already pre-computes
    // `bankEligible: boolean` covering the same three conditions —
    // location match, no privacy flags, IP consistency. We restate the
    // negative cases here so a payload that bypasses the collector
    // (legacy row, hand-rolled fixture) can't slip through as
    // bank-facing.
    if (payload.bankEligible === false) return true;
    const match = readString(payload.locationMatch);
    if (match === "different_country" || match === "different_region") return true;
    const privacy = (payload.ipinfo as { privacy?: { vpn?: boolean; proxy?: boolean; hosting?: boolean } } | undefined)?.privacy;
    if (privacy?.vpn === true || privacy?.proxy === true || privacy?.hosting === true) return true;
    if (payload.riskLevel === "high") return true;
  }

  if (field === "fraud_risk_screening") {
    // The source collector emits a section in two flavors:
    //   - ACCEPT path: positiveFacts non-empty + isNegativeVerdict undefined → bank-facing
    //   - Negative path: positiveFacts === [] AND isNegativeVerdict === true → internal-only
    // The explicit flag is the primary signal; positiveFacts.length is a
    // belt-and-suspenders backstop for older payloads that pre-date the flag.
    if (payload.isNegativeVerdict === true) return true;
    const positiveFacts = payload.positiveFacts;
    if (Array.isArray(positiveFacts) && positiveFacts.length === 0) {
      // No positive facts to cite. If the collector ran and we have a
      // recommendation, that recommendation is non-ACCEPT — treat as
      // negative regardless of the flag being set.
      const recommendation = readString(payload.recommendation);
      if (recommendation !== null && recommendation !== "") return true;
    }
  }

  return false;
}

/* ── Inclusion fact lookup ───────────────────────────────────────── */

interface FactLookup {
  hasApprovedFact: boolean;
  includeInBankNarrative: boolean;
  bankEligibleFromFact: boolean;
}

function buildFactLookup(facts: EvidenceFact[]): Map<string, FactLookup> {
  const byField = new Map<string, FactLookup>();
  for (const f of facts) {
    // `value` carries `fieldKey` per `factClassifier.extractValue`.
    const fieldKey = (f.value as { fieldKey?: string } | null)?.fieldKey;
    if (typeof fieldKey !== "string") continue;
    const existing = byField.get(fieldKey);
    const merged: FactLookup = {
      hasApprovedFact: existing?.hasApprovedFact ? true : !f.internalOnly,
      includeInBankNarrative:
        existing?.includeInBankNarrative ? true : f.includeInBankNarrative === true,
      bankEligibleFromFact:
        existing?.bankEligibleFromFact ? true : f.bankEligible === true,
    };
    byField.set(fieldKey, merged);
  }
  return byField;
}

/* ── Submission method resolver ──────────────────────────────────── */

interface ResolutionContext {
  field: string;
  status: ChecklistItemV2["status"];
  payload: Record<string, unknown> | null;
  excluded: boolean;
  failed: boolean;
  override: "force_include" | "force_exclude" | undefined;
  internalFlag: boolean;
  contributesStrongOrModerate: boolean;
  naturalCategory: EvidenceCategory;
  factLookup: FactLookup | undefined;
  reasonFamily: ReasonFamily;
  /** Pre-computed `!internalFlag && isFieldBankEligible(field, payload)`
   *  from the derivation loop. Gates EVERY path into `bank_argument` so
   *  `submissionMethod === "bank_argument"` can never disagree with the
   *  downstream `includedInBankArgument` flag (which requires it too). */
  bankEligible: boolean;
}

function resolveSubmissionMethod(ctx: ResolutionContext): SubmissionMethod {
  // First-match wins, in priority order:
  if (ctx.failed) return "failed_upload";

  // Explicit merchant exclusion (via the new inclusion override or the
  // legacy excludedFields set).
  if (ctx.override === "force_exclude" || ctx.excluded) return "excluded";

  if (ctx.status === "waived") return "waived";

  // `force_include` rules (per plan §"Architectural decisions" #3):
  //   1. If internal-only / negative — IGNORE the override; preserve
  //      the natural state.
  //   2. If the payload independently qualifies as decisive (categorizer
  //      returns strong/moderate) — promote to bank_argument.
  //   3. Otherwise — context_only. The override NEVER itself elevates
  //      strength or sets usedAsPositiveBankEvidence=true.
  if (ctx.override === "force_include") {
    const unsafe = ctx.internalFlag || isNegativeOrAmbiguous(ctx.field, ctx.payload, ctx.reasonFamily);
    if (!unsafe) {
      if (ctx.naturalCategory === "strong" || ctx.naturalCategory === "moderate") {
        return "bank_argument";
      }
      return "context_only";
    }
    // Fall through to the natural resolution.
  }

  // Internal-only fields. The default is "internal_only" — we
  // collected the signal and deliberately withhold it from the bank.
  // EXCEPTION: when no payload AND no approved fact exist for the
  // field, we don't actually have any signal to withhold. Saying
  // "kept internal" in that case is dishonest — it implies we ran
  // a check and hid the result. Route those rows to "not_included"
  // instead, so the merchant reads the field-specific honest
  // message (e.g. "Shopify did not return a qualifying
  // pre-authorization risk assessment for this order").
  if (ctx.internalFlag) {
    const hasAnySignal =
      ctx.payload != null || ctx.factLookup?.hasApprovedFact === true;
    return hasAnySignal ? "internal_only" : "not_included";
  }

  // Negative-or-ambiguous payloads on otherwise-bank-facing fields
  // (e.g. avs_cvv_match with both codes failing) — surface as
  // internal_only so the row doesn't read as a positive bank argument.
  if (ctx.status === "available" && isNegativeOrAmbiguous(ctx.field, ctx.payload, ctx.reasonFamily)) {
    return "internal_only";
  }

  // The row exists in the registry but has no canonical PDF representation.
  // Today every registered field has either a fact pathway or a context
  // pathway, so this branch is reserved for future "not_supported" cases.

  // Bank-argument: row contributes strong/moderate, is bank-eligible, and
  // is not negative/ambiguous. Eligibility + the negative guard gate BOTH
  // ways in:
  //   (a) an approved bank-eligible fact exists (generated defence
  //       package), OR
  //   (b) the categorizer's own category is strong/moderate — the signal
  //       stands on its own even before the LLM narrative is generated.
  // Case (b) closes the remaining half of the draft-pack contradiction
  // (prod: blume-box dispute 306080eb, draft pack 2026-07-21): the
  // context_only branch below already keeps strong rows IN the package
  // pre-narrative, but a contributing Strong signal (e.g. AVS+CVV both
  // matched) still read "context, not decisive proof" under a "no
  // decisive bank-facing evidence" banner while its pill said Strong.
  // A contributing, eligible, non-negative strong/moderate row IS the
  // positive bank argument — generation state only refines the wording.
  // NOTE: this resolver does not classify evidence; `naturalCategory`
  // comes from the canonical categorizer unchanged.
  if (
    ctx.contributesStrongOrModerate &&
    ctx.bankEligible &&
    !isNegativeOrAmbiguous(ctx.field, ctx.payload, ctx.reasonFamily) &&
    (ctx.factLookup?.hasApprovedFact ||
      ctx.naturalCategory === "strong" ||
      ctx.naturalCategory === "moderate")
  ) {
    return "bank_argument";
  }

  // Context-only: the row is on file and independently categorizes as
  // decisive-or-supporting evidence, even without an approved fact or a
  // same-field scoring contribution. This is the pre-narrative / draft
  // path: a freshly-built pack has no `facts_json` yet, so no field has
  // `hasApprovedFact`, and the delivery signal's single contribution is
  // deduped (by shared `signalId: "delivery"`) to only ONE of the two
  // delivery field keys. WITHOUT `strong` here, a genuinely-delivered
  // order's `shipping_tracking` row — category `strong`, `available`,
  // its own facts line reading "Delivered {date}" — fell through to
  // `not_included` and printed the field-generic "The order has not
  // shipped yet" reason: a Strong badge sitting in "On file — not
  // included" contradicting its own data (prod: blume-box dispute
  // 5e63afa7, draft pack 2026-07-21). Including `strong` keeps such a
  // row in the package as context; once the narrative runs and stamps
  // an approved fact + contribution, the earlier `bank_argument` branch
  // promotes it. Applies to every field, not just delivery.
  if (
    ctx.status === "available" &&
    (ctx.factLookup?.hasApprovedFact ||
      ctx.naturalCategory === "supporting" ||
      ctx.naturalCategory === "moderate" ||
      ctx.naturalCategory === "strong")
  ) {
    return "context_only";
  }

  return "not_included";
}

/* ── Delivery-row collapse ───────────────────────────────────────────
 *
 * The fulfillment collector emits TWO field keys — `shipping_tracking`
 * and `delivery_proof` — from one fulfillment, both sharing the generic
 * `disputes.signalLabel.delivery` → "Delivery confirmation" label and
 * the same `signalId: "delivery"`. Rendered as-is they produce two
 * identical rows on every surface (Overview summary, Overview strength
 * list, Evidence tab, Review & Submit tab).
 *
 * This collapses them into ONE line item carrying a proof-state-specific
 * `displayLabelToken` + `factsTokens` + `trackingUrl`, so every surface
 * that already prefers `displayLabelToken` shows a single, honest row:
 *
 *   signature_confirmed  → "Delivery confirmation (signature)"  [strong]
 *   delivered_confirmed  → "Delivery confirmation (carrier)"    [moderate/strong]
 *   delivered_unverified → "Shipping & tracking"                [supporting]
 *   label_created        → "Shipping label created"             [invalid]
 *
 * We keep the row with the more decisive proofType (and prefer an
 * `available` one), drop the other, and preserve the kept row's
 * submissionMethod / strength / inclusion flags untouched.
 */

const DELIVERY_FIELDS = new Set(["shipping_tracking", "delivery_proof"]);

type DeliveryProofType =
  | "signature_confirmed"
  | "delivered_confirmed"
  | "delivered_unverified"
  | "label_created";

const PROOF_RANK: Record<DeliveryProofType, number> = {
  signature_confirmed: 3,
  delivered_confirmed: 2,
  delivered_unverified: 1,
  label_created: 0,
};

function readProofType(payload: Record<string, unknown> | null): DeliveryProofType {
  const p = typeof payload?.proofType === "string" ? payload.proofType : null;
  if (
    p === "signature_confirmed" ||
    p === "delivered_confirmed" ||
    p === "delivered_unverified" ||
    p === "label_created"
  ) {
    return p;
  }
  // Manual upload with a file but no proofType reads as unverified —
  // mirrors categorizeEvidenceField's default.
  const looksLikeUpload =
    typeof payload?.fileName === "string" && (payload.fileName as string).length > 0;
  return looksLikeUpload ? "delivered_unverified" : "label_created";
}

function deliveryLabelToken(proof: DeliveryProofType): I18nToken {
  switch (proof) {
    case "signature_confirmed":
      return { key: "disputes.deliveryProof.signature" };
    case "delivered_confirmed":
      return { key: "disputes.deliveryProof.carrierConfirmed" };
    case "delivered_unverified":
      return { key: "disputes.deliveryProof.shippedUnconfirmed" };
    case "label_created":
    default:
      return { key: "disputes.deliveryProof.labelOnly" };
  }
}

/** Proof-state-specific why-context, replacing the generic
 *  "context, not decisive proof" line on the collapsed delivery row so
 *  the merchant reads WHY the row lands where it does. */
function deliveryReasonToken(proof: DeliveryProofType): I18nToken {
  const NS = "disputes.deliveryProof";
  switch (proof) {
    case "signature_confirmed":
      return { key: `${NS}.whySignature` };
    case "delivered_confirmed":
      return { key: `${NS}.whyCarrierConfirmed` };
    case "label_created":
      return { key: `${NS}.whyLabelOnly` };
    case "delivered_unverified":
    default:
      return { key: `${NS}.whyShippedUnconfirmed` };
  }
}

const SHORT_MONTHS = [
  "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec",
];

/** ISO → "Mon D" (UTC). Null on garbage so the segment drops out. */
function shortDate(iso: unknown): string | null {
  if (typeof iso !== "string") return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Build the compact facts tokens + tracking link from the fulfillment
 *  section payload. Shape mirrors `fulfillmentSource.extractTrackingData`. */
function buildDeliveryFacts(
  proof: DeliveryProofType,
  payload: Record<string, unknown> | null,
): { factsTokens: I18nToken[]; trackingUrl: string | null; trackingNumber: string | null } {
  const p = payload ?? {};
  const fulfillments = Array.isArray(p.fulfillments) ? p.fulfillments : [];
  let carrier: string | null = null;
  let trackingNumber: string | null = null;
  let trackingUrl: string | null = null;
  let shippedAt: string | null = null;
  let estimatedDeliveryAt: string | null = null;
  for (const f of fulfillments) {
    if (!f || typeof f !== "object") continue;
    const ff = f as Record<string, unknown>;
    if (shippedAt == null && typeof ff.createdAt === "string") shippedAt = ff.createdAt;
    if (estimatedDeliveryAt == null && typeof ff.estimatedDeliveryAt === "string") {
      estimatedDeliveryAt = ff.estimatedDeliveryAt;
    }
    const tracking = Array.isArray(ff.tracking) ? ff.tracking : [];
    for (const t of tracking) {
      if (!t || typeof t !== "object") continue;
      const tr = t as Record<string, unknown>;
      const url =
        typeof tr.url === "string" && /^https?:\/\//i.test(tr.url.trim()) ? tr.url.trim() : null;
      // Shopify fulfillments sometimes carry an EMPTY number next to a
      // tracking URL that embeds it (PostNord SE via 17track) — recover
      // it from the URL so the facts line still shows the number.
      const num =
        (typeof tr.number === "string" && tr.number.trim() ? tr.number.trim() : null) ??
        (url ? numberFromTrackingUrl(url) : null);
      const car = typeof tr.carrier === "string" && tr.carrier.trim() ? tr.carrier.trim() : null;
      if (trackingNumber == null) trackingNumber = num;
      if (trackingUrl == null) trackingUrl = url;
      if (carrier == null) carrier = car;
    }
  }
  const deliveredAt = typeof p.deliveredAt === "string" ? p.deliveredAt : null;
  const signedByName = typeof p.signedByName === "string" ? p.signedByName : null;

  const NS = "disputes.deliveryProof";
  const factsTokens: I18nToken[] = [];

  // Shipped {date} [via {carrier}] — pick the token that fits what we
  // actually have so we never render a stray "Shipped  via" gap.
  const shipped = shortDate(shippedAt);
  if (shipped && carrier) {
    factsTokens.push({ key: `${NS}.factsShippedVia`, params: { date: shipped, carrier } });
  } else if (shipped) {
    factsTokens.push({ key: `${NS}.factsShipped`, params: { date: shipped } });
  } else if (carrier) {
    factsTokens.push({ key: `${NS}.factsCarrier`, params: { carrier } });
  }

  // Delivery segment — proof-state AND receipt-state aware: a collection
  // at a pickup point reads "Collected at pickup point {date}", never a
  // bare "Delivered {date}" (and an awaiting-collection arrival never
  // reads as the misleading "Not delivered").
  const receipt = resolveDeliveryReceipt(payload);
  if (proof === "signature_confirmed" && signedByName) {
    factsTokens.push({ key: `${NS}.factsSignedBy`, params: { name: signedByName } });
  } else if (
    (proof === "signature_confirmed" || proof === "delivered_confirmed") &&
    shortDate(receipt.date ?? deliveredAt)
  ) {
    const date = shortDate(receipt.date ?? deliveredAt)!;
    factsTokens.push(
      receipt.state === "collected"
        ? { key: `${NS}.factsCollected`, params: { date } }
        : { key: `${NS}.factsDelivered`, params: { date } },
    );
  } else if (proof === "delivered_unverified") {
    if (receipt.state === "awaiting_collection") {
      factsTokens.push({ key: `${NS}.factsAwaitingCollection` });
    } else {
      const eta = shortDate(estimatedDeliveryAt);
      factsTokens.push(
        eta
          ? { key: `${NS}.factsNotDeliveredEta`, params: { date: eta } }
          : { key: `${NS}.factsNotDelivered` },
      );
    }
  }

  return { factsTokens, trackingUrl, trackingNumber };
}

/** Collapse the two delivery rows into one, in place. Returns a new
 *  array with the redundant delivery row removed and the survivor
 *  augmented with `displayLabelToken` / `factsTokens` / `trackingUrl`.
 *  A no-op when zero or one delivery row is present. */
function collapseDeliveryRows(
  out: EvidenceLineItem[],
  payloadByField: Map<string, unknown>,
): EvidenceLineItem[] {
  const deliveryRows = out.filter((li) => DELIVERY_FIELDS.has(li.field));
  if (deliveryRows.length === 0) return out;

  // Read the shared fulfillment payload (either field carries it).
  const payload =
    (payloadObjectFor(payloadByField, "delivery_proof") ??
      payloadObjectFor(payloadByField, "shipping_tracking")) ?? null;
  const proof = readProofType(payload);
  const facts = buildDeliveryFacts(proof, payload);

  // Pick the survivor: prefer an `available` row, then higher proof
  // rank is identical across both (shared payload) so fall back to the
  // one that's included in the package, else first-seen.
  const rank = (li: EvidenceLineItem): number => {
    let r = 0;
    if (li.hasEvidence) r += 100;
    if (li.includedInDefencePackage) r += 10;
    if (li.usedAsPositiveBankEvidence) r += 5;
    return r;
  };
  const survivor = [...deliveryRows].sort((a, b) => rank(b) - rank(a))[0];

  // Fact-stating title shared with the Overview card ("Delivered Jun 4",
  // "Collected at pickup point Jun 4"); falls back to the proof-tier
  // wording for payloads with no receipt state.
  const displayLabelToken = resolveDeliveryTitle(proof, payload);
  // Proof-specific why-context replaces the generic reason when the row is
  // in the package as context/bank evidence — AND for a `not_included`
  // survivor whose payload nonetheless proves the parcel moved (proofType
  // above `label_created`). The field-generic `not_included` copy claims
  // "The order has not shipped yet, so no carrier tracking is available";
  // for a shipped/delivered parcel that is flatly false and contradicts
  // the row's own facts line ("Shipped Jul 7 · Delivered Jul 13"). The
  // proof-state "why" copy (whyShippedUnconfirmed / whyCarrierConfirmed /
  // whySignature) tells the honest story instead. Only a genuine
  // `label_created` (label printed, never scanned) — or an excluded /
  // waived row — keeps its status-specific reason. See prod blume-box
  // dispute 5e63afa7 (draft pack 2026-07-21).
  const proofReasonToken = deliveryReasonToken(proof);
  const useProofReason = (li: EvidenceLineItem): boolean =>
    li.submissionMethod === "bank_argument" ||
    li.submissionMethod === "context_only" ||
    (li.submissionMethod === "not_included" && proof !== "label_created");
  return out
    .filter((li) => !DELIVERY_FIELDS.has(li.field) || li.field === survivor.field)
    .map((li) =>
      li.field === survivor.field
        ? {
            ...li,
            displayLabelToken,
            factsTokens: facts.factsTokens,
            trackingUrl: facts.trackingUrl,
            trackingNumber: facts.trackingNumber,
            ...(useProofReason(li)
              ? {
                  reason: resolveTokenEn(proofReasonToken),
                  reasonToken: proofReasonToken,
                }
              : {}),
          }
        : li,
    );
}

/* ── Public derivation ───────────────────────────────────────────── */

export function deriveEvidenceLineItems(
  input: DeriveEvidenceLineItemsInput,
): EvidenceLineItem[] {
  const {
    checklist,
    facts,
    payloadByField,
    contributions,
    packSavedToShopify,
    excludedFields,
    attachmentUploadFailures,
    inclusionOverrides,
  } = input;

  const factLookup = buildFactLookup(facts);

  const strongSignalFields = new Set(
    contributions.strong.map((c) => c.evidenceFieldKey),
  );
  const moderateSignalFields = new Set(
    contributions.moderate.map((c) => c.evidenceFieldKey),
  );

  const out: EvidenceLineItem[] = [];

  for (const item of checklist) {
    const spec = CANONICAL_EVIDENCE[item.field];
    if (!spec) continue; // Off-registry fields are invisible everywhere.

    const payload = payloadObjectFor(payloadByField, item.field);

    // First-time customer on a fraud dispute: "account history" with
    // zero prior orders is not evidence — it's the absence of history.
    // No line item is emitted, so the row renders NOWHERE merchant-
    // facing (Evidence tab buckets, Submission Summary, Inclusion
    // Review). Returning customers keep the row — that IS evidence.
    // (2026-07-23 user decision; scoring/pack builder unaffected.)
    if (
      isNonEvidenceAccountHistoryRow(item.field, payload, input.reasonFamily)
    ) {
      continue;
    }
    const internalFlag = INTERNAL_ONLY_FIELDS.has(item.field);
    const negativeOrAmbiguous = isNegativeOrAmbiguous(item.field, payload, input.reasonFamily);
    const override = inclusionOverrides.get(item.field);
    const failed = attachmentUploadFailures.has(item.field);
    const excluded = excludedFields.has(item.field);

    const naturalCategory = categoryForField(item.field, payload);
    const hasContribution =
      strongSignalFields.has(item.field) || moderateSignalFields.has(item.field);

    const lookup = factLookup.get(item.field);
    const bankEligibleField =
      !internalFlag && isFieldBankEligible(item.field, payload);

    const submissionMethod = resolveSubmissionMethod({
      field: item.field,
      status: item.status,
      payload,
      excluded,
      failed,
      override,
      internalFlag,
      contributesStrongOrModerate: hasContribution,
      naturalCategory,
      factLookup: lookup,
      reasonFamily: input.reasonFamily,
      bankEligible: bankEligibleField,
    });

    // Strength contribution. Internal-only fields are always rendered
    // as `internal_only` (regardless of category); excluded/waived rows
    // collapse to `none` because they don't influence the argument.
    let strengthContribution: StrengthContribution;
    if (internalFlag) {
      strengthContribution = "internal_only";
    } else if (submissionMethod === "excluded" || submissionMethod === "waived") {
      strengthContribution = "none";
    } else if (item.status !== "available") {
      strengthContribution = "none";
    } else {
      strengthContribution = strengthFromCategory(naturalCategory);
    }

    const hasEvidence = item.status === "available" || item.status === "waived";

    const includedInDefencePackage =
      submissionMethod === "bank_argument" || submissionMethod === "context_only";

    const includedInBankArgument =
      submissionMethod === "bank_argument" &&
      bankEligibleField &&
      !negativeOrAmbiguous;

    const usedAsPositiveBankEvidence =
      includedInBankArgument &&
      (strengthContribution === "strong" || strengthContribution === "moderate") &&
      (lookup?.includeInBankNarrative ?? bankEligibleField);

    const submittedToShopify = includedInDefencePackage && packSavedToShopify;

    const internalSignals = input.internalSignalsByField?.get(item.field);
    const overrideHistory = input.overrideHistoryByField?.get(item.field);

    // canBeForceIncluded — true only when clicking "Include in package"
    // would actually surface a row. Already-included rows (bank_argument
    // or context_only) don't expose the button at all, so the flag is
    // irrelevant there. For not_included or waived rows: merchant-
    // actionable fields (uploads, policy text) can be force-included
    // even without an existing payload, because the merchant CAN add
    // one. Auto-only fields (AVS, 3DS, shipping, fraud risk) require a
    // payload from an upstream system the merchant doesn't control —
    // force-including an empty row would be a no-op, so the button is
    // disabled with the "Nothing to include — data is outside
    // DisputeDesk's control" tooltip. For `excluded` (a force_exclude
    // override), restoring is always allowed because there's a known
    // payload behind the override.
    const hasPayload = payload != null;
    const isMerchantActionable =
      hasPayload || FIELDS_MERCHANT_CAN_FORCE_INCLUDE.has(item.field);
    const canBeForceIncluded =
      submissionMethod === "not_included" || submissionMethod === "waived"
        ? isMerchantActionable
        : submissionMethod === "excluded"
          ? true
          : false;
    // Reference the source-control allowlist so future maintenance has
    // a clear hook — the set is the inverse of FIELDS_MERCHANT_CAN_FORCE_INCLUDE.
    void SOURCE_OUTSIDE_MERCHANT_CONTROL;

    out.push({
      id: `line:${item.field}`,
      field: item.field,
      // `item.label` carries the English checklist label from the
      // backend completeness evaluator — kept as-is until the
      // ChecklistItemV2 label flips to a token in a later refactor.
      // Fallback to the field key (not `spec.label`, which no longer
      // exists post-Phase 3).
      label: item.label || item.field,
      source: inferSource(item.field),
      hasEvidence,
      strengthContribution,
      bankEligible: bankEligibleField,
      merchantVisible: true,
      includedInDefencePackage,
      includedInBankArgument,
      usedAsPositiveBankEvidence,
      submittedToShopify,
      submissionMethod,
      isNegativeOrAmbiguous: negativeOrAmbiguous,
      ...(() => {
        const token = reasonFor(item.field, submissionMethod, payload);
        return { reason: resolveTokenEn(token), reasonToken: token };
      })(),
      canBeForceIncluded,
      ...(internalSignals && internalSignals.length > 0
        ? { internalSignals }
        : {}),
      ...(overrideHistory ? { overrideHistory } : {}),
    });
  }

  // Collapse the two delivery field keys into one proof-labeled row so
  // every render surface shows a single, honest delivery line instead
  // of "Delivery confirmation" twice.
  return collapseDeliveryRows(out, payloadByField);
}
