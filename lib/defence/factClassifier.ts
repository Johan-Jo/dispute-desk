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
  type EvidenceCategory,
} from "@/lib/argument/canonicalEvidence";
import type { CaseStrengthLevel } from "@/lib/argument/types";
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
  "ip_location_check",
  "device_session_consistency",
  "fraud_risk_screening",
]);

/** Field keys whose facts must never appear in bank-facing surfaces by
 *  default. The LLM payload filter excludes them; `submission_risk=true`
 *  is set on the persisted row for the same reason. */
export const INTERNAL_ONLY_FIELDS = new Set([
  "ip_location_check",
  "device_session_consistency",
  "fraud_risk_screening",
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
  if (INTERNAL_ONLY_FIELDS.has(fieldKey)) return false;
  const cat = categoryFor({ fieldKey, payload });
  return cat === "strong" || cat === "moderate";
}

export function categoryForField(fieldKey: string, payload: Record<string, unknown> | null): EvidenceFactCategory {
  switch (fieldKey) {
    case "avs_cvv_match":
    case "tds_authentication":
      return "payment_authentication";
    case "billing_address_match":
      return "billing_match";
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

function extractValue(
  fieldKey: string,
  payload: Record<string, unknown> | null,
  section: PackSectionLike,
): Record<string, unknown> {
  const p = payload ?? {};
  switch (fieldKey) {
    case "avs_cvv_match": {
      const avsResult =
        typeof p.avsResultCode === "string"
          ? (p.avsResultCode as string).toUpperCase()
          : null;
      const cvvResult =
        typeof p.cvvResultCode === "string"
          ? (p.cvvResultCode as string).toUpperCase()
          : null;
      // Translated phrase the LLM is told to quote instead of the raw
      // gateway codes (Y/M/N/etc.). Issuers know what the letters mean
      // but quoting them verbatim ("AVS Y, CVV M") in merchant prose
      // looks amateurish and forces the merchant to trust we didn't
      // misquote. The plain-language summary preserves the same evidentiary
      // signal in language that reads naturally.
      const parts: string[] = [];
      if (avsResult === "Y" || avsResult === "X") {
        parts.push("the billing address matched the issuer's records");
      } else if (avsResult === "A") {
        parts.push("the billing street matched the issuer's records");
      } else if (avsResult === "Z" || avsResult === "W") {
        parts.push("the billing postal code matched the issuer's records");
      }
      if (cvvResult === "M") {
        parts.push("the card verification code matched the issuer's records");
      }
      const verificationSummary =
        parts.length > 0
          ? parts.join(" and ")
          : null;
      return {
        avsResult,
        cvvResult,
        verificationSummary,
      };
    }
    case "tds_authentication":
      return {
        threeDS: p.tdsAuthenticated === true || p.tdsVerified === true,
        liabilityShift: p.liabilityShift === true,
        verifiedSource: typeof p.verifiedSource === "string" ? p.verifiedSource : null,
        tdsVerified: p.tdsVerified === true,
      };
    case "billing_address_match":
      return { match: p.match === true };
    case "delivery_proof":
    case "shipping_tracking":
      return {
        proofType: typeof p.proofType === "string" ? p.proofType : null,
        carrier: typeof p.carrier === "string" ? p.carrier : null,
        deliveredAt: typeof p.deliveredAt === "string" ? p.deliveredAt : null,
        deliveredToVerifiedAddress: p.deliveredToVerifiedAddress === true,
      };
    case "customer_communication":
      return {
        customerConfirmsOrder: p.customerConfirmsOrder === true,
        messageCount: typeof p.messageCount === "number" ? p.messageCount : null,
        lastMessageAt: typeof p.lastMessageAt === "string" ? p.lastMessageAt : null,
      };
    case "customer_account_info":
      return {
        priorOrderCount: typeof p.priorUndisputedOrders === "number"
          ? p.priorUndisputedOrders
          : typeof p.totalOrders === "number"
            ? p.totalOrders
            : 0,
        disputeFreeHistory: p.disputeFreeHistory !== false,
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
    case "fraud_risk_screening":
      return {
        positiveFactCount: Array.isArray(p.positiveFacts) ? p.positiveFacts.length : 0,
        // Coarse level only — never the raw risk JSON.
        riskLevel: typeof p.riskLevel === "string" ? p.riskLevel : null,
      };
    case "ip_location_check":
      return {
        locationMatch: typeof p.locationMatch === "string" ? p.locationMatch : null,
      };
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

function labelForField(fieldKey: string): string {
  return CANONICAL_EVIDENCE[fieldKey]?.label ?? fieldKey;
}

/* ── Package mode derivation ── */

function derivePackageMode(input: {
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

      const fact: EvidenceFact = {
        id: factId,
        category,
        label: labelForField(fieldKey),
        value: { ...value, fieldKey },
        source: section.source,
        sourceRef,
        strength: cat,
        bankEligible: !isInternalOnly && (cat === "strong" || cat === "moderate"),
        merchantVisible: true,
        internalOnly: isInternalOnly,
        includeInBankNarrative: !isInternalOnly && !isSubmissionRisk && (cat === "strong" || cat === "moderate"),
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
  const eligible = approved.some((f) => f.bankEligible && f.includeInBankNarrative && !f.submissionRisk);
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
