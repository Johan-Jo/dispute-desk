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
  type EvidenceCategory,
} from "./canonicalEvidence";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import type { EvidenceFact } from "@/lib/defence/types";
import {
  INTERNAL_ONLY_FIELDS,
  isFieldBankEligible,
} from "@/lib/defence/factClassifier";
import type { CaseStrengthContribution } from "./caseStrength";
import type { ReasonFamily } from "./reasonFamily";

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
  reason: string;
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

const REASON_FOR_METHOD: Record<SubmissionMethod, string> = {
  bank_argument: "Used as positive bank-facing evidence.",
  context_only: "Included in the defence package as context, not as decisive proof.",
  internal_only: "Used internally for assessment; not surfaced to the bank.",
  not_included: "Field is on file but no usable evidence payload was emitted.",
  not_supported: "No bank-facing slot exists for this field.",
  excluded: "Excluded by merchant from the bank submission.",
  failed_upload: "Upload failed; the file did not reach the defence package.",
  waived: "Marked not applicable by the merchant.",
};

const REASON_OVERRIDES: Record<string, Partial<Record<SubmissionMethod, string>>> = {
  ip_location_check: {
    internal_only:
      "This signal is ambiguous or unfavorable and could weaken the fraud response.",
    not_included:
      "IP and location data are not available for this order.",
  },
  device_session_consistency: {
    internal_only:
      "Device/session signals can weaken the fraud response when inconclusive; kept internal.",
    not_included:
      "Device and session signals are not available for this order.",
  },
  fraud_risk_screening: {
    bank_argument:
      "Shopify's own pre-authorization fraud screening recommended ACCEPT for this order — cited as supporting context in the bank argument.",
    context_only:
      "Shopify's own pre-authorization fraud screening reviewed this order at checkout and recommended ACCEPT.",
    internal_only:
      "Pre-authorization risk scoring is informational only; not surfaced to the bank.",
    not_included:
      "Shopify did not return a qualifying pre-authorization risk assessment for this order.",
  },
  refund_policy: {
    context_only:
      "Documents merchant policy, but does not by itself prove authorization for this fraud dispute.",
    not_included:
      "Your refund policy text is not on file for this checkout.",
  },
  shipping_policy: {
    context_only:
      "Documents shipping commitments; supporting context only.",
    not_included:
      "Your shipping policy text is not on file for this checkout.",
  },
  cancellation_policy: {
    context_only:
      "Documents cancellation rules; supporting context only.",
    not_included:
      "Your cancellation policy text is not on file for this checkout.",
  },
  order_confirmation: {
    context_only:
      "Confirms order details, but does not prove the customer authorized the transaction.",
    not_included:
      "The order confirmation data could not be loaded from Shopify.",
  },
  avs_cvv_match: {
    bank_argument: "Payment verification supports cardholder identity.",
    not_included:
      "The payment processor did not return AVS or CVV verification codes for this transaction. Nothing to include — these codes come from the payment gateway at checkout, not after the fact.",
  },
  billing_address_match: {
    not_included:
      "The payment gateway did not return an AVS match result for this transaction. The billing address is on file, but no match/mismatch decision is available.",
  },
  shipping_tracking: {
    not_included:
      "The order has not shipped yet, so no carrier tracking is available. Once you ship the order this row will populate automatically.",
  },
  delivery_proof: {
    not_included:
      "Delivery has not been confirmed yet. Once the carrier marks the order delivered (or you upload a signature/photo) this row will populate automatically.",
  },
  tds_authentication: {
    not_included:
      "The payment receipt does not include 3-D Secure authentication data for this transaction.",
  },
  customer_communication: {
    not_included:
      "No customer correspondence is on file for this order. Upload a transcript from your helpdesk to add one.",
  },
  customer_account_info: {
    not_included:
      "Customer account history is not available for this order.",
  },
  activity_log: {
    not_included:
      "Customer activity history is not available for this order.",
  },
  supporting_documents: {
    not_included:
      "No supplementary documents have been uploaded yet. Add one from the Evidence tab to include it.",
  },
  product_description: {
    not_included:
      "Product description text is not on file for this order.",
  },
  duplicate_explanation: {
    not_included:
      "No duplicate-charge explanation has been provided yet.",
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
  "billing_address_match",
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
): string {
  // Payload-aware specificity for internal-only signals: the merchant
  // gets to see WHY a signal was kept internal (e.g. "IP country
  // mismatch" vs "VPN/proxy detected") instead of the generic
  // "ambiguous or unfavourable" line. Mirrors the granular reasons
  // already produced for the standalone Internal-only Signals UI
  // section by `lib/argument/internalSignals.ts` — keeping the two
  // surfaces in lockstep.
  if (method === "internal_only") {
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
  return REASON_OVERRIDES[field]?.[method] ?? REASON_FOR_METHOD[method];
}

/**
 * Builds the row reason for fraud_risk_screening with the actual
 * Shopify positiveFacts inlined. Returns null when the payload doesn't
 * carry usable signals — callers fall back to the static
 * REASON_OVERRIDES entry.
 */
function fraudScreeningReasonWithSignals(
  payload: unknown,
  method: "bank_argument" | "context_only",
): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const facts = Array.isArray(p.positiveFacts)
    ? (p.positiveFacts as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];
  if (facts.length === 0) return null;
  const signals = facts.join("; ");
  if (method === "bank_argument") {
    return `Shopify's own pre-authorization fraud screening recommended ACCEPT for this order — cited as supporting context in the bank argument. Signals: ${signals}.`;
  }
  return `Shopify's own pre-authorization fraud screening reviewed this order at checkout and recommended ACCEPT. Signals: ${signals}.`;
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
function specificInternalReason(field: string, payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  if (field === "ip_location_check") {
    const locationMatch =
      typeof p.locationMatch === "string" ? p.locationMatch : null;
    const riskLevel = typeof p.riskLevel === "string" ? p.riskLevel : null;
    if (locationMatch === "different_country") {
      return "The customer's IP address resolved to a different country than the shipping address. Kept internal so the bank doesn't read it as a fraud weakness.";
    }
    if (locationMatch === "different_region") {
      return "The customer's IP region differs from the shipping address region. Kept internal so the bank doesn't read it as a fraud weakness.";
    }
    if (riskLevel === "high") {
      return "The IP routes through a VPN, proxy, or data center, which makes the geolocation unreliable. Kept internal because the bank could read it as a fraud weakness.";
    }
    if (p.bankEligible === false) {
      return "The upstream collector marked this signal as not bank-eligible — kept internal.";
    }
  }

  if (field === "avs_cvv_match") {
    const avs = typeof p.avsResultCode === "string" ? p.avsResultCode.toUpperCase() : null;
    const cvv = typeof p.cvvResultCode === "string" ? p.cvvResultCode.toUpperCase() : null;
    // Both codes returned a no-match — the LLM narrative can't lean
    // on AVS/CVV, but the merchant deserves to see what was actually
    // returned by the gateway.
    if (avs === "N" && cvv === "N") {
      return "Both the billing address (AVS) and the card verification code (CVV) failed to match the issuer's records. Kept internal — citing this to the bank would undermine the fraud response.";
    }
    if (avs === "N") {
      return "The billing address (AVS) did not match the issuer's records. Kept internal — citing this to the bank would undermine the fraud response.";
    }
    if (cvv === "N") {
      return "The card verification code (CVV) did not match the issuer's records. Kept internal — citing this to the bank would undermine the fraud response.";
    }
  }

  if (field === "device_session_consistency") {
    if (p.consistent === false) {
      return "Device or session signals were inconsistent between checkout and prior activity. Kept internal because the bank could read it as a fraud weakness.";
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

const AVS_MATCH_CODES = new Set(["Y", "A", "W", "X", "D", "M"]);
const CVV_MATCH_CODES = new Set(["M"]);

function readString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * Negative-or-ambiguous detector. Fires for:
 *   - the three INTERNAL_ONLY_FIELDS (ip/device/fraud-screening),
 *     unconditionally — they ride a separate channel
 *   - `avs_cvv_match` when BOTH codes are non-match (i.e. the payment
 *     authentication failed), per user-spec §H
 *
 * Used as a belt-and-suspenders check so even if an inclusion override
 * slips past the API guard, the derivation refuses to elevate. Also
 * used to gate `includedInBankArgument` so a negative row never feeds
 * the bank narrative.
 */
function isNegativeOrAmbiguous(
  field: string,
  payload: Record<string, unknown> | null,
): boolean {
  if (INTERNAL_ONLY_FIELDS.has(field)) return true;
  if (!payload) return false;

  if (field === "avs_cvv_match") {
    const avs = readString(payload.avsResultCode);
    const cvv = readString(payload.cvvResultCode);
    const avsPresent = avs !== null && avs !== "";
    const cvvPresent = cvv !== null && cvv !== "";
    const avsFail = avsPresent && !AVS_MATCH_CODES.has(avs.toUpperCase());
    const cvvFail = cvvPresent && !CVV_MATCH_CODES.has(cvv.toUpperCase());
    // Both codes present AND both fail → unambiguously negative.
    if (avsPresent && cvvPresent && avsFail && cvvFail) return true;
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
    const unsafe = ctx.internalFlag || isNegativeOrAmbiguous(ctx.field, ctx.payload);
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
  if (ctx.status === "available" && isNegativeOrAmbiguous(ctx.field, ctx.payload)) {
    return "internal_only";
  }

  // The row exists in the registry but has no canonical PDF representation.
  // Today every registered field has either a fact pathway or a context
  // pathway, so this branch is reserved for future "not_supported" cases.

  // Bank-argument: row contributes strong/moderate AND has an approved fact.
  if (ctx.contributesStrongOrModerate && ctx.factLookup?.hasApprovedFact) {
    return "bank_argument";
  }

  // Context-only: row contributes (or is on file as supporting) and has
  // an approved fact, but doesn't reach strong/moderate.
  if (
    ctx.status === "available" &&
    (ctx.factLookup?.hasApprovedFact ||
      ctx.naturalCategory === "supporting" ||
      ctx.naturalCategory === "moderate")
  ) {
    return "context_only";
  }

  return "not_included";
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
    const internalFlag = INTERNAL_ONLY_FIELDS.has(item.field);
    const negativeOrAmbiguous = isNegativeOrAmbiguous(item.field, payload);
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
      label: item.label || spec.label,
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
      reason: reasonFor(item.field, submissionMethod, payload),
      canBeForceIncluded,
      ...(internalSignals && internalSignals.length > 0
        ? { internalSignals }
        : {}),
    });
  }

  return out;
}
