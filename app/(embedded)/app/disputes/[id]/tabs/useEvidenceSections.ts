/**
 * Pure derivation hook for the EvidenceTab four-section IA.
 *
 * NO fetching, NO state, NO API calls. Reads from the existing workspace
 * shape and returns a typed view-model bucketed into:
 *   1. Case summary
 *   2. Evidence used in defense       (all supporting signals — submitted or not)
 *   3. Missing or weak evidence       (only what is missing/incomplete)
 *   4. Internal-only signals          (always rendered; empty state when none)
 *
 * The hook NEVER recomputes scoring or strength. The raw backend
 * `caseStrength.overall` value is preserved verbatim in the view-model;
 * the display-time mapping of "insufficient" → "Weak" lives in
 * `CaseSummaryCard`, not here.
 *
 * `includedAs` is a deterministic destination — `form_field` |
 * `rebuttal_text` | `not_included`. Derived signals that influence
 * the bank-facing narrative resolve to `rebuttal_text`; mapped
 * Shopify fields with payload presence resolve to `form_field`;
 * waived/excluded items resolve to `not_included`. There is no
 * "unknown" state — every supporting row gets a definitive answer.
 */

"use client";

import { useTranslations } from "next-intl";
import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";
import type {
  EvidenceItemWithStrength,
  WorkspaceData,
} from "../workspace-components/types";

/** Minimal translator shape — accepts a key and optional params. Lets
 *  the pure helpers below stay React-free while still producing
 *  locale-correct strings. */
type Translate = (key: string, params?: Record<string, string | number>) => string;
import type { CaseStrengthLevel } from "@/lib/argument/types";
import { MERCHANT_UI_HIDDEN_FIELDS } from "@/lib/automation/merchantUiHiddenFields";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

/* ── View-model types ── */

/** Item-level row strength. Case-level uses CaseStrengthLevel directly. */
export type ItemStrength = "strong" | "moderate" | "supporting";

export type EvidenceSource = "shopify" | "merchant" | "derived" | "store_policy";
export type CaseStatus = "submitted" | "needs_attention" | "in_progress";
export type AutomationMode = "automatic" | "review_required";

/**
 * Where a piece of evidence lands in the case sent to Shopify.
 *
 *   - form_field:    structured Shopify evidence field or attached file
 *                    (e.g., refundPolicyDisclosure, shippingDocumentationFile,
 *                    customer-uploaded supporting docs).
 *   - rebuttal_text: folded into the bank-facing narrative — derived
 *                    signals like AVS/CVV result, IP/location consistency,
 *                    and device/session signals. They influence the
 *                    rebuttal prose rather than producing a discrete
 *                    Shopify field.
 *   - not_included:  intentionally kept out of the Shopify submission
 *                    (waived, merchant-excluded, or internal-only).
 *
 * No "unknown" state — every row in §2 gets a deterministic answer.
 */
export type EvidenceSubmissionDestination =
  | "form_field"
  | "not_included";

/**
 * Four merchant-facing next-step copies. Each maps 1:1 to a stable
 * i18n key and is selected by the readiness + automation state.
 *   - ready_no_action     → "Ready — no action needed"
 *   - submit_now          → "Submit now"
 *   - review_missing      → "Review missing evidence below"
 *   - submitted_no_action → "Submitted — no further action required"
 */
export type NextStep =
  | { kind: "ready_no_action" }
  | { kind: "submit_now" }
  | { kind: "review_missing" }
  | { kind: "submitted_no_action" };

export interface CaseSummaryViewModel {
  /** Raw backend value, preserved verbatim. Display-time coercion of
   *  `insufficient` → `Weak` lives in CaseSummaryCard. */
  strength: CaseStrengthLevel;
  status: CaseStatus;
  automationMode: AutomationMode;
  nextStep: NextStep;
  /** Merchant-facing one-line summary of why the case is at this
   *  strength (from `caseStrength.strengthReason`). Surfaces context
   *  the merchant can't deduce from the badge alone — e.g. for the
   *  fraud "moderate-from-AVS-only" path it explains that one
   *  decisive signal exists but more would help. Null when not
   *  meaningful (e.g. covered cases). */
  strengthReason: string | null;
  /** Concrete suggestion for the highest-leverage missing item
   *  (from `caseStrength.improvementHint`). Renders as a subtle
   *  call-to-action so the merchant sees a specific path to a
   *  stronger case. Null when overall is already strong, when no
   *  actionable missing field stands out, or when the case is
   *  covered / fatal-loss. */
  improvementHint: string | null;
}

export interface EvidenceRowViewModel {
  id: string;
  field: string;
  title: string;
  strength: ItemStrength;
  whyThisMatters: string;
  source: EvidenceSource;
  /**
   * Where this row's evidence lands in the bank-facing case. Always
   * deterministic — see EvidenceSubmissionDestination doc.
   */
  includedAs: EvidenceSubmissionDestination;
  /**
   * File evidence layer (Phase 6). Set when the most recent save run
   * uploaded a focused PDF for this field key into a Shopify `*File`
   * slot. Drives the clip-icon badge in EvidenceRow.
   */
  nativeAttachment?: {
    /** The Shopify mutation field key (e.g. `shippingDocumentationFile`). */
    targetField: string;
    /** ISO timestamp captured when the upload landed. */
    uploadedAt: string;
  };
}

export interface MissingItemViewModel {
  id: string;
  field: string;
  title: string;
  whyItMatters: string;
  required: boolean;
  actionInstruction: string | null;
}

export interface InternalSignalViewModel {
  id: string;
  title: string;
  explanation: string;
}

export interface EvidenceSectionsViewModel {
  caseSummary: CaseSummaryViewModel;
  usedInDefense: EvidenceRowViewModel[];
  missingOrWeak: MissingItemViewModel[];
  internalOnly: InternalSignalViewModel[];
}

/* ── Strength + status helpers ── */

const STRENGTH_RANK: Record<ItemStrength, number> = {
  strong: 3,
  moderate: 2,
  supporting: 1,
};

function deriveStatus(args: {
  isReadOnly: boolean;
  readiness: string;
  isFailed: boolean;
}): CaseStatus {
  if (args.isReadOnly) return "submitted";
  if (args.isFailed) return "needs_attention";
  if (args.readiness === "blocked" || args.readiness === "ready_with_warnings") {
    return "needs_attention";
  }
  return "in_progress";
}

function deriveAutomationMode(
  appliedRule: { mode: "auto" | "review" } | null,
): AutomationMode {
  // When no rule has fired yet, default to review_required — the safer
  // bucket. Honors the two-mode rule (memory: feedback_two_automation_modes.md).
  if (!appliedRule) return "review_required";
  return appliedRule.mode === "auto" ? "automatic" : "review_required";
}

/**
 * Decision table:
 *
 *   isReadOnly === true                                   → submitted_no_action
 *   readiness === "blocked"                               → review_missing
 *   readiness === "ready_with_warnings"                   → submit_now
 *   readiness === "ready" + automationMode === "automatic" → ready_no_action
 *   readiness === "ready" + automationMode === "review"    → submit_now
 *   anything else (loading, unknown)                      → review_missing
 *
 * The automation mode disambiguates `ready`: in auto mode the merchant
 * has nothing left to do; in review mode they must click submit.
 */
function deriveNextStep(args: {
  isReadOnly: boolean;
  readiness: string;
  automationMode: AutomationMode;
}): NextStep {
  if (args.isReadOnly) return { kind: "submitted_no_action" };
  if (args.readiness === "blocked") return { kind: "review_missing" };
  if (args.readiness === "ready_with_warnings") return { kind: "submit_now" };
  if (args.readiness === "ready") {
    return args.automationMode === "automatic"
      ? { kind: "ready_no_action" }
      : { kind: "submit_now" };
  }
  return { kind: "review_missing" };
}

/* ── Source classification ──
 *
 * Maps a canonical evidence field key to one of the three merchant-facing
 * source buckets. Fields not in this map fall through to "shopify" because
 * the overwhelming majority of evidence is pulled from Shopify order data;
 * the merchant-upload and derived buckets are explicit allowlists.
 */

const MERCHANT_FIELDS: ReadonlySet<string> = new Set([
  "supporting_documents",
  "product_description",
  "duplicate_explanation",
  "customer_communication",
]);

const DERIVED_FIELDS: ReadonlySet<string> = new Set([
  "ip_location_check",
  "device_session_consistency",
  "avs_cvv_match",
]);

const STORE_POLICY_FIELDS: ReadonlySet<string> = new Set([
  "refund_policy",
  "shipping_policy",
  "cancellation_policy",
]);

function inferSource(field: string): EvidenceSource {
  if (MERCHANT_FIELDS.has(field)) return "merchant";
  if (DERIVED_FIELDS.has(field)) return "derived";
  if (STORE_POLICY_FIELDS.has(field)) return "store_policy";
  return "shopify";
}

/* ── Submission destination derivation ──
 *
 * Maps each canonical evidence field to the set of Shopify mutation
 * field names it can contribute to. Drawn from
 * `lib/shopify/fieldMapping.ts` + `formatEvidenceForShopify.ts` —
 * the same source the actual payload uses.
 *
 * Empty list = the evidence is not directly addressable as a Shopify
 * field; it influences the rebuttal narrative instead (AVS/CVV,
 * IP/location, device/session). Those rows resolve to `rebuttal_text`,
 * never to a fake "Yes" claim on a non-existent field.
 *
 * Each entry is the COMPLETE list of Shopify field names this
 * evidence can land in; the row resolves to `form_field` when at
 * least one of them is `included: true` in `data.submissionFields`.
 */
const EVIDENCE_TO_SHOPIFY: Record<string, readonly string[]> = {
  // Order facts → access activity log (timeline)
  order_confirmation: ["accessActivityLog"],
  billing_address_match: ["accessActivityLog"],
  customer_account_info: ["accessActivityLog"],
  activity_log: ["accessActivityLog"],

  // Fulfillment → carrier doc + activity log
  shipping_tracking: ["shippingDocumentationFile", "accessActivityLog"],
  delivery_proof: ["shippingDocumentationFile", "accessActivityLog"],

  // Policies → dedicated Shopify fields
  refund_policy: ["refundPolicyDisclosure"],
  cancellation_policy: ["cancellationPolicyDisclosure"],
  // No dedicated `shippingPolicyDisclosure` exists in Shopify's schema.
  // Shipping policy text is folded into uncategorizedText when emitted.
  shipping_policy: ["uncategorizedText"],

  // Customer communication → uncategorizedText (per fieldMapping.ts:91)
  customer_communication: ["uncategorizedText"],

  // Merchant evidence
  product_description: ["uncategorizedText"],
  duplicate_explanation: ["uncategorizedText", "refundRefusalExplanation"],

  // Embedded / derived signals: appear (if at all) inside other fields'
  // narrative text, never as a dedicated Shopify field. Rows resolve
  // to `rebuttal_text` — they do reach the bank, just not as a discrete
  // structured field.
  avs_cvv_match: [],
  ip_location_check: [],
  device_session_consistency: [],
};

/**
 * Fields whose merchant-visible "available" status implies they ride
 * along with the Shopify submission as attachments rather than as
 * mutation fields (so they don't appear in `submissionFields`). Treated
 * as `form_field` when present — they ARE structured submission inputs,
 * just on the file-attachment channel.
 */
const ATTACHMENT_FIELDS: ReadonlySet<string> = new Set([
  "supporting_documents",
]);

function buildIncludedShopifyFieldSet(
  data: WorkspaceData,
): ReadonlySet<string> {
  const set = new Set<string>();
  for (const f of data.submissionFields ?? []) {
    if (f.included) set.add(f.shopifyFieldName);
  }
  return set;
}

function deriveSubmissionDestination(args: {
  field: string;
  evidenceStatus: EvidenceItemWithStrength["status"] | undefined;
  excludedFields: ReadonlySet<string>;
  includedShopifyFields: ReadonlySet<string>;
}): EvidenceSubmissionDestination {
  // Waived items are explicitly excluded from the bank-visible payload.
  if (args.evidenceStatus === "waived") return "not_included";

  // Merchant has explicitly toggled this field off in the review UI.
  if (args.excludedFields.has(args.field)) return "not_included";

  // File-attachment fields ride the submission's attachments channel
  // rather than `submissionFields`. Available + not-excluded = form_field.
  if (ATTACHMENT_FIELDS.has(args.field)) return "form_field";

  // Post-retirement: every piece of evidence that's not a structured
  // Shopify file field rides inside the defence-package PDF (which IS
  // the bank-facing submission). The legacy rebuttal_text destination
  // doesn't exist anymore; evidence either lands in a discrete Shopify
  // field or — much more commonly now — is woven into the PDF.
  const mapped = EVIDENCE_TO_SHOPIFY[args.field];
  if (!mapped || mapped.length === 0) return "not_included";

  for (const shopifyField of mapped) {
    if (args.includedShopifyFields.has(shopifyField)) return "form_field";
  }
  return "not_included";
}

/* ── Why-this-matters copy ──
 *
 * Single reason-aware sentence per evidence field. Mirrors the existing
 * WHY_TEXT in EvidenceTab.tsx and useDisputeWorkspace.ts, consolidated
 * here so the new IA does not read from two divergent copies. A future
 * cleanup PR can collapse all three back to a single shared module.
 */

const WHY_THIS_MATTERS: Record<string, string> = {
  order_confirmation: "Anchors the case — proves a real transaction with itemized totals and customer details.",
  shipping_tracking: "Carrier confirmation that the order shipped — required for item-not-received disputes.",
  delivery_proof: "Signature or photo confirmation that the customer received the package.",
  billing_address_match: "Ties the cardholder to the order — critical for fraud rebuttal.",
  avs_cvv_match: "Card security checks the bank weighs heavily in fraud cases.",
  product_description: "Shows the product matched what was advertised — defense for not-as-described claims.",
  refund_policy: "Customer agreed to refund terms before purchase — protects against buyer's remorse.",
  shipping_policy: "Documents shipping commitments — supports delivery-timing rebuttals.",
  cancellation_policy: "Proves cancellation rules were disclosed before purchase.",
  customer_communication: "Shows engagement with the customer — banks favor merchants who tried to resolve.",
  customer_account_info: "Account age and activity supporting a legitimate customer profile.",
  duplicate_explanation: "Explains why the charges are not duplicates — required for duplicate disputes.",
  supporting_documents: "Additional proof that strengthens the case.",
  activity_log: "Prior successful transactions from the same customer.",
  device_session_consistency: "Consistent device and session behavior across the purchase flow.",
  ip_location_check: "Location verification compared to billing details and prior activity.",
};

function whyThisMatters(field: string, fallbackLabel: string): string {
  return WHY_THIS_MATTERS[field] ?? `Strengthens the response on ${fallbackLabel}.`;
}

/* ── Internal-only signal classifier ──
 *
 * Reads existing payloads from the workspace (no new fetches, no
 * scoring changes) and surfaces signals that are *known* to the
 * merchant but intentionally NOT transmitted to Shopify. Conservative
 * by design — only emits when the payload contains a definitively
 * negative or weakening signal. Absence of data is never an internal
 * signal.
 *
 * Sources of truth:
 *   - AVS/CVV codes: per `classifyEvidenceRow` tests, code "Y"/"A" is
 *     an address match, "M" is a CVV match. Anything else (especially
 *     "N") is a mismatch.
 *   - IP/location: per `deviceLocationSource.ts`, `locationMatch ===
 *     "different_country"` is a country mismatch and `riskLevel === "high"`
 *     means VPN/proxy/data-center.
 */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

const AVS_MATCH_CODES = new Set(["Y", "A"]);
const CVV_MATCH_CODES = new Set(["M"]);

function classifyAvsCvv(payload: unknown, t: Translate): InternalSignalViewModel | null {
  if (!isPlainObject(payload)) return null;
  const avs = readString(payload.avsResultCode);
  const cvv = readString(payload.cvvResultCode);
  // Only emit when at least one code is present AND that code is a
  // mismatch. Absence of codes (null/empty) is not a negative signal.
  const avsMismatch = avs !== null && avs !== "" && !AVS_MATCH_CODES.has(avs);
  const cvvMismatch = cvv !== null && cvv !== "" && !CVV_MATCH_CODES.has(cvv);
  if (!avsMismatch && !cvvMismatch) return null;

  const parts: string[] = [];
  if (avsMismatch) parts.push(t("internalSignals.avsCodePrefix", { code: avs ?? "" }));
  if (cvvMismatch) parts.push(t("internalSignals.cvvCodePrefix", { code: cvv ?? "" }));
  return {
    id: "internal:avs_cvv_mismatch",
    title: t("internalSignals.avsCvvMismatch.title"),
    explanation: t("internalSignals.avsCvvMismatch.explanation", { codes: parts.join(", ") }),
  };
}

/**
 * Classify billing/shipping address mismatch as an internal-only signal.
 *
 * `billing_address_match` is auto-collected from Shopify order data
 * (`lib/packs/sources/orderSource.ts`) — the merchant cannot upload it.
 * When billing and shipping addresses do not align by city + country,
 * surfacing that to the bank would expose a weakness; instead the
 * merchant sees it as an internal-only signal.
 *
 * Sources of truth:
 *   - The order section payload (under the `order_confirmation` field)
 *     carries redacted `billingAddress` and `shippingAddress` objects
 *     with `{ city, provinceCode, countryCode, zipPrefix }`.
 *   - The collector only adds `billing_address_match` to `fieldsProvided`
 *     when city + countryCode match. Absence of the field in the
 *     checklist's "available" state therefore implies non-match
 *     (provided both addresses exist).
 *
 * Conservative: emits ONLY when both addresses are present AND at least
 * one of city/countryCode mismatches. Missing addresses → no signal
 * (absence is not a negative signal, per the existing classifier rules).
 */
export function classifyBillingAddressMismatch(
  effectiveChecklist: EvidenceItemWithStrength[],
  t: Translate,
): InternalSignalViewModel | null {
  // If billing_address_match is already available, the collector confirmed
  // a match — nothing to surface internally.
  const billingItem = effectiveChecklist.find(
    (i) => i.field === "billing_address_match",
  );
  if (billingItem?.status === "available") return null;

  // Read the order section payload (carried on the order_confirmation row).
  const orderItem = effectiveChecklist.find(
    (i) => i.field === "order_confirmation",
  );
  const payload = orderItem?.payload;
  if (!isPlainObject(payload)) return null;

  const billing = payload.billingAddress;
  const shipping = payload.shippingAddress;
  if (!isPlainObject(billing) || !isPlainObject(shipping)) return null;

  const billingCountry = readString(billing.countryCode);
  const shippingCountry = readString(shipping.countryCode);
  const billingCity = readString(billing.city);
  const shippingCity = readString(shipping.city);

  // Need both countryCodes to make a meaningful claim. If either is
  // null/empty, treat as insufficient data rather than a mismatch.
  if (
    billingCountry === null ||
    billingCountry === "" ||
    shippingCountry === null ||
    shippingCountry === ""
  ) {
    return null;
  }

  const countryMismatch = billingCountry !== shippingCountry;
  const cityMismatch =
    billingCity !== null &&
    billingCity !== "" &&
    shippingCity !== null &&
    shippingCity !== "" &&
    billingCity !== shippingCity;

  if (!countryMismatch && !cityMismatch) return null;

  const detail = countryMismatch
    ? t("internalSignals.billingAddress.countryDetail", { billingCountry, shippingCountry })
    : t("internalSignals.billingAddress.cityDetail");

  return {
    id: "internal:billing_address_mismatch",
    title: t("internalSignals.billingAddress.title"),
    explanation: t("internalSignals.billingAddress.explanation", { detail }),
  };
}

function classifyIpLocation(payload: unknown, t: Translate): InternalSignalViewModel | null {
  if (!isPlainObject(payload)) return null;
  const locationMatch = readString(payload.locationMatch);
  const riskLevel = readString(payload.riskLevel);
  const bankEligible = payload.bankEligible;

  const countryMismatch = locationMatch === "different_country";
  const highRisk = riskLevel === "high";
  // bankEligible === false is an explicit "do not transmit" flag from
  // deviceLocationSource. When present, treat as an internal signal.
  const explicitlyInternal = bankEligible === false;

  if (!countryMismatch && !highRisk && !explicitlyInternal) return null;

  if (countryMismatch) {
    return {
      id: "internal:ip_country_mismatch",
      title: t("internalSignals.ipCountryMismatch.title"),
      explanation: t("internalSignals.ipCountryMismatch.explanation"),
    };
  }
  if (highRisk) {
    return {
      id: "internal:ip_high_risk",
      title: t("internalSignals.ipHighRisk.title"),
      explanation: t("internalSignals.ipHighRisk.explanation"),
    };
  }
  // explicitlyInternal but no specific reason — generic internal note.
  return {
    id: "internal:ip_bank_ineligible",
    title: t("internalSignals.ipBankIneligible.title"),
    explanation: t("internalSignals.ipBankIneligible.explanation"),
  };
}

function deriveInternalOnlySignals(
  effectiveChecklist: EvidenceItemWithStrength[],
  t: Translate,
): InternalSignalViewModel[] {
  const out: InternalSignalViewModel[] = [];
  // Index payloads by field for quick lookup. The checklist iteration
  // order is stable, so signals appear in a deterministic order on the
  // page (AVS/CVV first if present, then IP).
  const byField = new Map<string, unknown>();
  for (const item of effectiveChecklist) {
    if (item.payload) byField.set(item.field, item.payload);
  }

  const avs = classifyAvsCvv(byField.get("avs_cvv_match"), t);
  if (avs) out.push(avs);

  const billing = classifyBillingAddressMismatch(effectiveChecklist, t);
  if (billing) out.push(billing);

  const ip = classifyIpLocation(byField.get("ip_location_check"), t);
  if (ip) out.push(ip);

  // fraud_risk_screening is NO LONGER an internal-only signal as of
  // bbe0ab3. When Shopify returned ACCEPT, the screening is
  // supporting bank evidence (surfaces in EvidenceUsedSection +
  // Inclusion Review + PDF Evidence Basis via the normal
  // `usedAsPositiveBankEvidence` / `includedInDefencePackage`
  // pathways). When Shopify returned an unfavourable result, the
  // source-collector emits no section at all (absence is never a
  // negative signal — same rule as 3-D Secure). So this card
  // intentionally never carries a fraud-screening row.

  // Generic "bank-ineligible" pass for any other field whose payload
  // explicitly opts out of bank submission. Conservative: only emit
  // when the payload itself sets bankEligible: false.
  for (const item of effectiveChecklist) {
    if (item.field === "avs_cvv_match" || item.field === "ip_location_check") continue;
    const payload = item.payload;
    if (!isPlainObject(payload)) continue;
    if (payload.bankEligible === false) {
      out.push({
        id: `internal:${item.field}:bank_ineligible`,
        title: `${item.label} kept internal`,
        explanation:
          "The upstream collector marked this signal as not bank-eligible. Used internally for assessment; not submitted to Shopify.",
      });
    }
  }

  return out;
}

/* ── Hook ── */

export function useEvidenceSections(workspace: Workspace): EvidenceSectionsViewModel {
  const { data, derived, clientState } = workspace;
  const tInternal = useTranslations("disputes");

  // Defensive empty-state when workspace data hasn't loaded yet. The
  // upstream tab is responsible for showing a loading state; this hook
  // just returns a coherent empty view-model so consumers can render
  // unconditionally without null checks.
  if (!data) {
    return {
      caseSummary: {
        strength: "insufficient",
        status: "in_progress",
        automationMode: "review_required",
        nextStep: { kind: "review_missing" },
        strengthReason: null,
        improvementHint: null,
      },
      usedInDefense: [],
      missingOrWeak: [],
      internalOnly: [],
    };
  }

  const excludedFields: ReadonlySet<string> =
    clientState?.excludedFields ?? new Set();
  const includedShopifyFields = buildIncludedShopifyFieldSet(data);

  // Quick lookup: evidence checklist item by field key. Used for both
  // the Strong/Moderate contributions (which only carry an
  // evidenceFieldKey) and the supporting list.
  const checklistByField = new Map<string, EvidenceItemWithStrength>();
  for (const item of derived.effectiveChecklist) {
    checklistByField.set(item.field, item);
  }

  // ── Case summary ──
  // strength is the RAW backend value. No mutation. CaseSummaryCard
  // does the display-time mapping of "insufficient" → "Weak" label.
  const automationMode = deriveAutomationMode(data.appliedRule);
  const caseSummary: CaseSummaryViewModel = {
    strength: derived.caseStrength.overall,
    status: deriveStatus({
      isReadOnly: derived.isReadOnly,
      readiness: derived.readiness,
      isFailed: derived.isFailed,
    }),
    automationMode,
    nextStep: deriveNextStep({
      isReadOnly: derived.isReadOnly,
      readiness: derived.readiness,
      automationMode,
    }),
    strengthReason: derived.caseStrength.strengthReason ?? null,
    improvementHint: derived.caseStrength.improvementHint ?? null,
  };

  // ── Evidence used in defense ──
  // Includes ALL supporting signals (strong + moderate + supporting),
  // regardless of submission destination. Each row carries an explicit
  // `includedAs` chip — form_field / rebuttal_text / not_included —
  // derived from the same source as the Shopify payload.
  const usedInDefense: EvidenceRowViewModel[] = [];

  // File evidence layer (Phase 6) — index by evidenceFieldKey for O(1)
  // lookup when building each row's `nativeAttachment` flag. Multiple
  // uploads for the same field key (rare; e.g. delivery_proof primary
  // + shipping_tracking overflow) collapse to the most recent.
  const nativeAttachmentsByField = new Map<
    string,
    { targetField: string; uploadedAt: string }
  >();
  for (const u of data.pack?.attachmentUploads ?? []) {
    const prior = nativeAttachmentsByField.get(u.evidenceFieldKey);
    if (!prior || u.uploadedAt > prior.uploadedAt) {
      nativeAttachmentsByField.set(u.evidenceFieldKey, {
        targetField: u.targetField,
        uploadedAt: u.uploadedAt,
      });
    }
  }

  function buildRow(
    idPrefix: string,
    field: string,
    label: string,
    strength: ItemStrength,
  ): EvidenceRowViewModel {
    const checklistItem = checklistByField.get(field);
    const native = nativeAttachmentsByField.get(field);
    return {
      id: `${idPrefix}:${field}`,
      field,
      title: label,
      strength,
      whyThisMatters: whyThisMatters(field, label),
      source: inferSource(field),
      includedAs: deriveSubmissionDestination({
        field,
        evidenceStatus: checklistItem?.status,
        excludedFields,
        includedShopifyFields,
      }),
      ...(native ? { nativeAttachment: native } : {}),
    };
  }

  for (const c of derived.contributions.strong) {
    usedInDefense.push(buildRow("strong", c.evidenceFieldKey, c.label, "strong"));
  }
  for (const c of derived.contributions.moderate) {
    usedInDefense.push(buildRow("moderate", c.evidenceFieldKey, c.label, "moderate"));
  }
  // Supporting items — items that exist in the checklist as available
  // but did not reach moderate or strong category. They still support
  // the case and belong in §2 with strength: "supporting".
  //
  // We dedupe by checking what was already pushed from
  // `derived.contributions.strong/moderate` above (single source of
  // truth for strong/moderate placement). The previous version also
  // gated on `item.strength`, but `deriveEvidenceWithStrength` upgrades
  // every available item to `"moderate"` by default — including fields
  // whose canonical category is `supporting` (e.g. `customer_communication`
  // with a manual upload that lacks `customerConfirmsOrder`). That gate
  // silently dropped supporting rows that were never in contributions,
  // so the merchant's upload never appeared in Evidence Used in Defense.
  // Pinned by `tests/unit/evidenceSectionsUsedInDefense.test.ts`.
  for (const item of derived.effectiveChecklist) {
    if (item.status !== "available") continue;
    if (usedInDefense.some((row) => row.field === item.field)) continue;
    usedInDefense.push(buildRow("supporting", item.field, item.label, "supporting"));
  }

  usedInDefense.sort(
    (a, b) => STRENGTH_RANK[b.strength] - STRENGTH_RANK[a.strength],
  );

  // ── Missing or weak evidence ──
  // The two freeform manual-upload fields (customer_communication and
  // supporting_documents) are intentionally hidden from every merchant-
  // facing list (decision 2026-05-21 — dev mode, no prod merchants).
  // The underlying checklist still carries them so the pack builder,
  // scoring, coverage gate, and bank-facing rebuttal are untouched;
  // only the merchant UI filters them out. Hide-list shared from
  // lib/automation/completeness.ts so all three tabs agree.
  const missingOrWeak: MissingItemViewModel[] = derived.missingItems
    .filter((m) => !MERCHANT_UI_HIDDEN_FIELDS.has(m.field))
    .map((m) => ({
      id: `missing:${m.field}`,
      field: m.field,
      title: m.label,
      whyItMatters: m.impact,
      required: m.priority === "critical",
      actionInstruction: m.ctaLabel || null,
    }));

  // ── Internal-only signals ──
  // Minimal classifier reading existing payloads. Surfaces AVS/CVV
  // mismatches, IP geolocation mismatches, high-risk IP routing
  // (VPN/proxy/data-center), and any payload explicitly flagged
  // bankEligible:false. Conservative — absence of data is never a
  // negative signal.
  const internalOnly = deriveInternalOnlySignals(derived.effectiveChecklist, tInternal);

  return {
    caseSummary,
    usedInDefense,
    missingOrWeak,
    internalOnly,
  };
}
