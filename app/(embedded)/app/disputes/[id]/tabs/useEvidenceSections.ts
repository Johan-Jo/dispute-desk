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
import {
  CANONICAL_EVIDENCE,
  disputeFreeHistoryState,
  effectivePriorOrders,
} from "@/lib/argument/canonicalEvidence";
import {
  cardholderNameFromPayload,
  detectCardholderNameMismatch,
} from "@/lib/argument/nameMismatch";
import { readPaymentVerification } from "@/lib/argument/paymentVerification";
import { resolveReasonFamily } from "@/lib/argument/reasonFamily";
import type { Localized } from "@/lib/i18n/localized";
import { resolveToken } from "@/lib/i18n/resolveToken";
import {
  MERCHANT_UI_HIDDEN_FIELDS,
  isNonEvidenceAccountHistoryRow,
} from "@/lib/automation/merchantUiHiddenFields";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

/* ── View-model types ── */

/** Item-level row strength. Case-level uses CaseStrengthLevel directly. */
export type ItemStrength = "strong" | "moderate" | "supporting";

export type EvidenceSource =
  | "shopify"
  | "merchant"
  | "derived"
  | "store_policy"
  | "payment_gateway";
export type CaseStatus = "submitted" | "needs_attention" | "in_progress" | "won" | "lost" | "closed";
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
 * Merchant-facing next-step copies. Each maps 1:1 to a stable i18n key
 * and is selected by the readiness + automation state.
 *
 * Review mode is a HARD gate (2026-07-06): the deadline-submit cron
 * (`/api/cron/defence-package-deadline-submit`) auto-submits AUTO-mode
 * disputes only — a `needs_review` dispute is never auto-sent. So
 * review-mode copy must read as a "you must submit" CTA, NOT a promise
 * that we'll send it on the deadline. AUTO-mode copy still surfaces the
 * cron's due-date submission.
 *
 * `dueAt` is threaded through the `ready_*` and `ready_with_warnings_*`
 * variants so the rendered copy can show the deadline. When unknown
 * (rare — Shopify webhook hasn't delivered the deadline yet) the renderer
 * falls back to "before the deadline".
 */
export type NextStep =
  | { kind: "ready_auto"; dueAt: string | null }
  | { kind: "ready_review"; dueAt: string | null }
  | { kind: "ready_with_warnings_auto"; dueAt: string | null }
  | { kind: "ready_with_warnings_review"; dueAt: string | null }
  | { kind: "review_missing" }
  | { kind: "submitted_no_action" };

export interface CaseSummaryViewModel {
  /** Raw backend value, preserved verbatim. Display-time coercion of
   *  `insufficient` → `Weak` lives in CaseSummaryCard. */
  strength: CaseStrengthLevel;
  status: CaseStatus;
  /** null on a DECIDED dispute (won/lost/closed) — no automation pill. */
  automationMode: AutomationMode | null;
  nextStep: NextStep;
  /** Merchant-facing one-line summary of why the case is at this
   *  strength (resolved from `caseStrength.strengthReasonI18n`).
   *  Surfaces context the merchant can't deduce from the badge alone —
   *  e.g. for the fraud "moderate-from-AVS-only" path it explains that
   *  one decisive signal exists but more would help. Empty `Localized`
   *  string when not meaningful (e.g. covered cases). */
  strengthReasonText: Localized;
  /** Concrete suggestion for the highest-leverage missing item
   *  (resolved from `caseStrength.improvementHintI18n`). Renders as a
   *  subtle call-to-action so the merchant sees a specific path to a
   *  stronger case. Null when overall is already strong, when no
   *  actionable missing field stands out, or when the case is
   *  covered / fatal-loss. */
  improvementHintText: Localized | null;
}

export interface EvidenceRowViewModel {
  id: string;
  field: string;
  title: string;
  strength: ItemStrength;
  whyThisMatters: string;
  source: EvidenceSource;
  /**
   * File evidence layer (Phase 6). Set when the most recent save run
   * uploaded a focused PDF for this field key into a Shopify `*File`
   * slot. Drives the clip-icon badge in EvidenceRow.
   */
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
  /** Resolved outcome from the presentation model (won/lost/closed) — a
   *  DECIDED dispute must show its outcome on the Evidence + Review tabs,
   *  not the generic "Submitted". Takes precedence over everything. */
  outcome?: "won" | "lost" | "closed" | "pending" | null;
}): CaseStatus {
  if (args.outcome === "won") return "won";
  if (args.outcome === "lost") return "lost";
  if (args.outcome === "closed") return "closed";
  if (args.isReadOnly) return "submitted";
  if (args.isFailed) return "needs_attention";
  if (args.readiness === "blocked" || args.readiness === "ready_with_warnings") {
    return "needs_attention";
  }
  return "in_progress";
}

/** A decided dispute has a terminal outcome — used to suppress the
 *  automation pill + next-step CTA (nothing left to review/submit). */
function isDecided(status: CaseStatus): boolean {
  return status === "won" || status === "lost" || status === "closed";
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
 *   isReadOnly === true                                            → submitted_no_action
 *   readiness === "blocked"                                        → review_missing
 *   readiness === "ready"               + mode === "automatic"     → ready_auto
 *   readiness === "ready"               + mode === "review"        → ready_review (merchant must submit; no auto-send)
 *   readiness === "ready_with_warnings" + mode === "automatic"     → ready_with_warnings_auto
 *   readiness === "ready_with_warnings" + mode === "review"        → ready_with_warnings_review
 *   anything else (loading, unknown)                               → review_missing
 *
 * All non-blocked, non-submitted variants carry `dueAt` so the renderer
 * can surface the deadline. The cron
 * (`/api/cron/defence-package-deadline-submit`) auto-submits on the due
 * date for AUTO-mode disputes only. Review mode is a hard gate — the copy
 * is a "review and submit before the deadline" CTA, and nothing is sent
 * automatically.
 */
function deriveNextStep(args: {
  isReadOnly: boolean;
  readiness: string;
  automationMode: AutomationMode;
  dueAt: string | null;
}): NextStep {
  if (args.isReadOnly) return { kind: "submitted_no_action" };
  if (args.readiness === "blocked") return { kind: "review_missing" };
  if (args.readiness === "ready_with_warnings") {
    return args.automationMode === "automatic"
      ? { kind: "ready_with_warnings_auto", dueAt: args.dueAt }
      : { kind: "ready_with_warnings_review", dueAt: args.dueAt };
  }
  if (args.readiness === "ready") {
    return args.automationMode === "automatic"
      ? { kind: "ready_auto", dueAt: args.dueAt }
      : { kind: "ready_review", dueAt: args.dueAt };
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
]);

// AVS/CVV result codes are returned verbatim by the Shopify Payments
// gateway at authorization — nothing is inferred by DisputeDesk. Labelling
// them "Derived" undersold their provenance, so they get their own source
// bucket rendered as "Shopify Payments".
const PAYMENT_GATEWAY_FIELDS: ReadonlySet<string> = new Set([
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
  if (PAYMENT_GATEWAY_FIELDS.has(field)) return "payment_gateway";
  if (STORE_POLICY_FIELDS.has(field)) return "store_policy";
  return "shopify";
}

/*
 * DELETED 2026-08-04: EVIDENCE_TO_SHOPIFY, ATTACHMENT_FIELDS,
 * buildIncludedShopifyFieldSet, deriveSubmissionDestination.
 *
 * They described a submission model we abandoned — individual evidence fields
 * routed to named Shopify slots (accessActivityLog, shippingDocumentationFile,
 * refundPolicyDisclosure …). `composeShopifyMutationPayload` has only ever
 * sent ONE file, the defence-package PDF, plus the customer name and email.
 *
 * None of it ever reached a merchant: `submissionFields` was declared in
 * WorkspaceData but never populated by any writer, so `includedShopifyFields`
 * was always empty, and the resulting `includedAs` was computed and never
 * rendered by any component. Worse, had `submissionFields` ever been
 * populated, this would have reported `not_included` for nearly every field —
 * telling merchants their evidence was left out when all of it is woven into
 * the PDF that IS the submission. Dead code that encodes the wrong answer is
 * worse than no code.
 */

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

// AVS / CVV match semantics come from `lib/argument/paymentVerification.ts`
// (PR-C2). This file used to keep its own copy "in lockstep" by comment —
// one of six, and they had already drifted.

/**
 * MERCHANT-LANGUAGE RULE (2026-07-23): never lead with a bare gateway
 * code — nobody but a bank knows what a bare AVS letter indicates. One
 * combined plain-words sentence covers both results (codes in
 * parentheses at the end), then one short outcome sentence. "Cited"
 * follows the CITATION authority, never the scoring match. Mirrors
 * `lib/argument/internalSignals.ts` — keep the two in lockstep.
 *
 * Result-sentence key by (avs outcome, cvv outcome); "none" = code absent.
 * Only combinations that can fire the warning are listed — a genuine
 * `no_match` on either side, or a CVV-only match. An `unknown` /
 * `not_checked` / `unavailable` AVS result is NOT a mismatch (PR-C3).
 */
const AVS_CVV_RESULT_KEY: Record<string, string> = {
  "no_match|match": "resultAvsFailCvvMatch",
  "unchecked|match": "resultAvsUncheckedCvvMatch",
  "match|no_match": "resultAvsMatchCvvFail",
  "match|unchecked": "resultAvsMatchCvvUnchecked",
  "no_match|no_match": "resultBothFail",
  "no_match|unchecked": "resultAvsFailCvvUnchecked",
  "unchecked|no_match": "resultAvsUncheckedCvvFail",
  "unchecked|unchecked": "resultBothUnchecked",
  "no_match|none": "resultAvsFailOnly",
  "unchecked|none": "resultAvsUncheckedOnly",
  "none|no_match": "resultCvvFailOnly",
  "none|unchecked": "resultCvvUncheckedOnly",
};

/** Exported for test — the client mirror of `lib/argument/internalSignals.ts`.
 *  The two must agree, so both are asserted against the same matrix in
 *  `tests/unit/avsCitationLanguage.test.ts`. */
export function classifyAvsCvv(payload: unknown, t: Translate): InternalSignalViewModel | null {
  if (!isPlainObject(payload)) return null;
  const verification = readPaymentVerification(payload);
  const avs = verification.avs.code;
  const cvv = verification.cvv.code;
  // A FAILURE is the canonical `no_match` result and nothing else (PR-C3) —
  // `unknown`, `not_checked` and `unavailable` are not failures, and an
  // unrecognised code must not become a mismatch warning on top of its own
  // diagnostic. Fires additionally on a CVV-only match, where the merchant
  // must be told the match is kept internal (PR-C2 decision 1).
  const avsFailed = verification.avs.normalized === "no_match";
  const cvvFailed = verification.cvv.outcome === "no_match";
  if (!avsFailed && !cvvFailed && !verification.cvvOnly) return null;

  const NS = "internalSignals.avsCvvMismatch";
  // Buckets come from the verification already normalized above — network
  // aware, read once. A code-only helper would re-read the letter as an
  // unknown-network payload.
  const avsB = verification.avs.outcome ?? "none";
  const cvvB = verification.cvv.outcome ?? "none";
  const resultKey = AVS_CVV_RESULT_KEY[`${avsB}|${cvvB}`];
  if (!resultKey) return null; // unreachable combos (match|match etc.)

  const sentences: string[] = [
    t(`${NS}.${resultKey}`, { avs: avs ?? "", cvv: cvv ?? "" }),
  ];

  // Outcome. "Cited" follows the CITATION authority — a primary-sourced
  // (network, code) cell — NOT the scoring match set: a scoring match from an
  // unverified (network, code) cell is not citable. Pure-unchecked results
  // carry no outcome: nothing was withheld and nothing cited, so the result
  // sentence stands alone.
  //   avsMatched — factual, for wording and the "partially passed" title
  //   avsCited   — issuer-facing authority, the only basis for "was cited"
  const avsMatched = verification.addressVerified;
  const avsCited = verification.citableAddressVerified;
  const cvvMatched = verification.securityCodeVerified;
  if (cvvMatched) {
    // CVV-only by construction (a both-matched fact raises no warning).
    // PR-C2 decision 1: it is on record for the merchant and withheld from
    // the bank — a security-code match is not an address match.
    sentences.push(t(`${NS}.outcomeCvvOnlyNotCited`));
  } else if (avsCited) {
    sentences.push(
      t(`${NS}.${cvvB === "no_match" ? "outcomeOnlyAvsCited" : "outcomeAvsCitedClean"}`),
    );
  } else if (avsMatched) {
    // Matched, not citable — the (network, code) cell has no primary source.
    // Never the "would weaken" wording: nothing here is weak.
    sentences.push(t(`${NS}.outcomeAvsMatchedNotCitable`));
  } else if (avsB === "no_match" && cvvB === "none") {
    sentences.push(t(`${NS}.outcomeSingleNotCited`));
  } else if (cvvB === "no_match" && avsB === "none") {
    sentences.push(t(`${NS}.outcomeSingleNotCited`));
  } else if (avsB === "no_match" || cvvB === "no_match") {
    sentences.push(t(`${NS}.outcomeNothingCited`));
  }

  return {
    id: "internal:avs_cvv_mismatch",
    // Factual title: something DID pass, whether or not it may be cited.
    title: avsMatched || cvvMatched ? t(`${NS}.titlePartial`) : t(`${NS}.title`),
    explanation: sentences.join(" "),
  };
}

/**
 * An AVS code the canonical map has no entry for (PR-C3 / C-13).
 *
 * Recorded, explained, and used for nothing: no grade, no citation, no
 * completeness credit, and NO assertion against the cardholder — an
 * unrecognised code is a gap in our map, not a failed verification. The
 * dispute is not parked; a package that tries to rely on the code is refused
 * by the claim guards on its own.
 *
 * Mirrors `lib/argument/internalSignals.ts` — keep the two in lockstep.
 */
export function classifyUnmappedAvsCode(
  payload: unknown,
  t: Translate,
): InternalSignalViewModel | null {
  if (!isPlainObject(payload)) return null;
  const verification = readPaymentVerification(payload);
  if (!verification.avs.unmapped || verification.avs.code === null) return null;

  const NS = "internalSignals.avsCodeUnmapped";
  return {
    id: "internal:avs_code_unmapped",
    title: t(`${NS}.title`),
    explanation: t(`${NS}.explanation`, { avs: verification.avs.code }),
  };
}

/**
 * Classify the billing-vs-shipping address comparison as an internal-only
 * OPERATIONAL note — in both directions.
 *
 * NOT EVIDENCE, EITHER WAY (PR-C4 / C-14, decision 4). The agreement half was
 * an evidence field until 2026-08-09: `billing_address_match`, graded strong
 * as "AVS-confirmed billing matches the cardholder" while being emitted from a
 * comparison of two merchant-held addresses that read no AVS result and knew
 * no cardholder. The field is retired
 * (`lib/evidence/model/retiredKeys.ts`); this note is what the comparison
 * honestly supports, under its own label, and it is never scored, never cited
 * and never a claim input. Address verification is the AVS row's job.
 *
 * Source of truth: the order section payload (carried on the
 * `order_confirmation` row) holds redacted `billingAddress` and
 * `shippingAddress` objects with `{ city, provinceCode, countryCode,
 * zipPrefix }`. The retired checklist row is deliberately NOT consulted — a
 * historical pack still carries one, and reading it would let the retired
 * field decide what the merchant sees.
 *
 * Conservative: emits nothing unless BOTH addresses are present with usable
 * country codes. Missing addresses → no signal, in either direction (absence
 * is not a signal, per the existing classifier rules).
 */
export function classifyBillingShippingAgreement(
  effectiveChecklist: EvidenceItemWithStrength[],
  t: Translate,
): InternalSignalViewModel | null {
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

  // The agreement half, under its own NEW label. It replaces nothing the
  // merchant used to read as evidence — the retired row's label is gone with
  // the row.
  if (!countryMismatch && !cityMismatch) {
    return {
      id: "internal:billing_shipping_agree",
      title: t("internalSignals.billingShippingAgree.title"),
      explanation: t("internalSignals.billingShippingAgree.explanation"),
    };
  }

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

/**
 * Cardholder-name mismatch — the gateway's registered card name shares
 * no token with the buyer's name (classic stolen-card pattern). Prints
 * BOTH names so the merchant sees exactly what differs. Merchant-UI
 * only; the comparison itself lives in `lib/argument/nameMismatch.ts`
 * (shared with the strength cap and the server-side warnings map).
 */
function classifyCardholderName(
  payload: unknown,
  customerName: string | null,
  t: Translate,
): InternalSignalViewModel | null {
  if (!isPlainObject(payload)) return null;
  const cardholder = cardholderNameFromPayload(payload);
  const customer =
    typeof customerName === "string" && customerName.trim().length > 0
      ? customerName.trim()
      : null;
  if (!detectCardholderNameMismatch(cardholder, customer)) return null;
  return {
    id: "internal:cardholder_name_mismatch",
    title: t("internalSignals.cardholderNameMismatch.title"),
    explanation: t("internalSignals.cardholderNameMismatch.explanation", {
      cardholder: cardholder ?? "",
      customer: customer ?? "",
    }),
  };
}

/**
 * Prior chargebacks on the customer's account.
 *
 * Merchant-only, always. This is evidence AGAINST us — citing "this
 * account has charged back before" to the issuer hands them our
 * weakness, so `evidenceLineItem.isNegativeOrAmbiguous` already keeps
 * the row out of the bank argument. But that decision lives downstream
 * and is never written back into the payload, so the generic
 * `bankEligible === false` sweep below could not see it: the finding
 * showed on Overview and was missing from the Evidence tab entirely
 * (reported on blume-box 162042cd, 2026-08-01).
 *
 * Fires only on a VERIFIED `disputeFreeHistory === false` — `unknown`
 * (the flag absent) must never render as an accusation.
 */
export function classifyPriorChargebacks(
  payload: unknown,
  t: Translate,
): InternalSignalViewModel | null {
  if (!isPlainObject(payload)) return null;
  if (disputeFreeHistoryState(payload) !== "has_disputes") return null;
  const prior = effectivePriorOrders(payload);
  return {
    id: "internal:prior_chargebacks",
    title: t("internalSignals.priorChargebacks.title"),
    explanation:
      prior != null && prior >= 1
        ? t("internalSignals.priorChargebacks.explanationWithCount", { prior })
        : t("internalSignals.priorChargebacks.explanation"),
  };
}

function deriveInternalOnlySignals(
  effectiveChecklist: EvidenceItemWithStrength[],
  t: Translate,
  customerName: string | null,
): InternalSignalViewModel[] {
  const out: InternalSignalViewModel[] = [];
  // Index payloads by field for quick lookup. The checklist iteration
  // order is stable, so signals appear in a deterministic order on the
  // page (AVS/CVV first if present, then IP).
  const byField = new Map<string, unknown>();
  for (const item of effectiveChecklist) {
    if (item.payload) byField.set(item.field, item.payload);
  }

  const unmappedAvs = classifyUnmappedAvsCode(byField.get("avs_cvv_match"), t);
  if (unmappedAvs) out.push(unmappedAvs);

  const avs = classifyAvsCvv(byField.get("avs_cvv_match"), t);
  if (avs) out.push(avs);

  const nameMismatch = classifyCardholderName(
    byField.get("avs_cvv_match"),
    customerName,
    t,
  );
  if (nameMismatch) out.push(nameMismatch);

  const billing = classifyBillingShippingAgreement(effectiveChecklist, t);
  if (billing) out.push(billing);

  const ip = classifyIpLocation(byField.get("ip_location_check"), t);
  if (ip) out.push(ip);

  const priorChargebacks = classifyPriorChargebacks(
    byField.get("customer_account_info"),
    t,
  );
  if (priorChargebacks) out.push(priorChargebacks);

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
        // Appended checklist rows carry `label: ""` by design, and a template
        // literal interpolates that happily — this read " kept internal".
        title: `${item.label || item.field.replace(/_/g, " ")} kept internal`,
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
  // Root translator for token resolution (signal labels, etc.). Tokens
  // encode absolute key paths so the translator must NOT be scoped.
  const tRoot = useTranslations();
  /** Resolve the canonical signal label for a field key. Falls back
   *  to the lib-emitted legacy English when the field is not in the
   *  canonical registry. */
  const fieldLabel = (field: string, legacy: string): string => {
    const labelKey = CANONICAL_EVIDENCE[field]?.labelKey;
    if (!labelKey) return legacy;
    try {
      const resolved = tRoot(labelKey);
      return resolved === labelKey ? legacy : resolved;
    } catch {
      return legacy;
    }
  };

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
        strengthReasonText: derived.strengthReasonText,
        improvementHintText: derived.improvementHintText,
      },
      usedInDefense: [],
      missingOrWeak: [],
      internalOnly: [],
    };
  }

  const excludedFields: ReadonlySet<string> =
    clientState?.excludedFields ?? new Set();

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
  // A DECIDED outcome (won/lost/closed) is the highest-priority state on
  // the Evidence tab's case summary — it must not read "Submitted /
  // Review required" once the card network has ruled.
  const caseOutcome =
    (data.presentation?.outcome as "won" | "lost" | "closed" | "pending" | null | undefined) ??
    (data.dispute.finalOutcome === "won"
      ? "won"
      : data.dispute.finalOutcome === "lost"
        ? "lost"
        : null);
  const caseStatus = deriveStatus({
    isReadOnly: derived.isReadOnly,
    readiness: derived.readiness,
    isFailed: derived.isFailed,
    outcome: caseOutcome,
  });
  const decided = isDecided(caseStatus);
  const caseSummary: CaseSummaryViewModel = {
    strength: derived.caseStrength.overall,
    status: caseStatus,
    // Decided cases have nothing to automate — drop the "Review required"
    // pill (the outcome pill + calm headline carry the state).
    automationMode: decided ? null : automationMode,
    nextStep: decided
      ? { kind: "submitted_no_action" }
      : deriveNextStep({
          isReadOnly: derived.isReadOnly,
          readiness: derived.readiness,
          automationMode,
          dueAt: data.dispute.dueAt,
        }),
    strengthReasonText: derived.strengthReasonText,
    improvementHintText: derived.improvementHintText,
  };

  // ── Evidence used in defense ──
  // Includes ALL supporting signals (strong + moderate + supporting).
  // The per-row `includedAs` chip was removed 2026-08-04 along with the
  // unwired Shopify file-slot layer it was derived from — it was computed and
  // never rendered, and would have read `not_included` for evidence that does
  // reach the bank inside the defence PDF.
  const usedInDefense: EvidenceRowViewModel[] = [];

  function buildRow(
    idPrefix: string,
    field: string,
    label: string,
    strength: ItemStrength,
  ): EvidenceRowViewModel {
    const checklistItem = checklistByField.get(field);
    return {
      id: `${idPrefix}:${field}`,
      field,
      title: label,
      strength,
      whyThisMatters: whyThisMatters(field, label),
      source: inferSource(field),
    };
  }

  for (const c of derived.contributions.strong) {
    usedInDefense.push(
      buildRow("strong", c.evidenceFieldKey, resolveToken(tRoot, c.labelToken), "strong"),
    );
  }
  for (const c of derived.contributions.moderate) {
    usedInDefense.push(
      buildRow("moderate", c.evidenceFieldKey, resolveToken(tRoot, c.labelToken), "moderate"),
    );
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
    // First-time customer on fraud: not evidence — the row renders
    // nowhere merchant-facing (2026-07-23 user decision; mirrors the
    // line-item derivation, which also drops it).
    if (
      isNonEvidenceAccountHistoryRow(
        item.field,
        (item.payload ?? null) as Record<string, unknown> | null,
        data.dispute.reasonFamily ?? resolveReasonFamily(data.dispute.reason),
      )
    ) {
      continue;
    }
    usedInDefense.push(buildRow("supporting", item.field, fieldLabel(item.field, item.label), "supporting"));
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
  const internalOnly = deriveInternalOnlySignals(
    derived.effectiveChecklist,
    tInternal,
    data.dispute.customerName ?? null,
  );

  return {
    caseSummary,
    usedInDefense,
    missingOrWeak,
    internalOnly,
  };
}
