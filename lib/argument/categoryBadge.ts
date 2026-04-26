/**
 * Canonical category → UI badge mapping.
 *
 * The ONE allowed translator from `EvidenceCategory` to a merchant-facing
 * label + tone. Plan v3 §P2.6 / P2.7 — the dispute-detail UI must render
 * exactly four labels: `Strong | Moderate | Supporting | Invalid`.
 *
 * Hard rules:
 *   - `invalid` is its OWN label ("Invalid") — never collapsed into
 *     "Supporting". A row that resolved to `invalid` means the collected
 *     payload didn't meet the registry's bar; merchants must see that
 *     distinct from a context-only supporting row.
 *   - The `bg` / `color` hex pair is provided for the inline-styled pills
 *     used by the Overview "Evidence collected" block. Polaris-Badge
 *     consumers can ignore the hex pair and bind to `tone` directly.
 */

import type { EvidenceItemStatus } from "@/lib/types/evidenceItem";
import {
  CANONICAL_EVIDENCE,
  categorizeEvidenceField,
  type EvidenceCategory,
} from "./canonicalEvidence";

export type { EvidenceCategory };

/** Polaris-Badge tones used by this surface. `undefined` is the neutral
 *  grey badge — used for `supporting` because Polaris does not expose a
 *  named "subdued" tone for Badge. */
export type CategoryBadgeTone = "success" | "warning" | "critical" | undefined;

export interface CategoryBadge {
  label: "Strong" | "Moderate" | "Supporting" | "Invalid";
  tone: CategoryBadgeTone;
  bg: string;
  color: string;
}

export function categoryBadge(category: EvidenceCategory): CategoryBadge {
  switch (category) {
    case "strong":
      return { label: "Strong", tone: "success", bg: "#D1FAE5", color: "#065F46" };
    case "moderate":
      return { label: "Moderate", tone: "warning", bg: "#FEF3C7", color: "#92400E" };
    case "supporting":
      return { label: "Supporting", tone: undefined, bg: "#E5E7EB", color: "#374151" };
    case "invalid":
      return { label: "Invalid", tone: "critical", bg: "#FEE2E2", color: "#991B1B" };
  }
}

/* ── classifyEvidenceRow — safe wrapper for UI rows ── */

export type RowStatusKey = "collected" | "waived" | "missing" | "not_applicable";

export interface RowClassification {
  /** Null when the dominant signal is the row's status (missing /
   *  not_applicable). The UI then renders only a status badge — no
   *  strength badge. */
  category: EvidenceCategory | null;
  status: RowStatusKey;
}

/** Discriminator: does the payload carry the keys the categorizer
 *  needs to be trusted? When false, the wrapper soft-lands `invalid`
 *  to `supporting` because absence-of-data is not the same as
 *  evidence-of-failure. */
function payloadIsInformative(
  fieldKey: string,
  payload: Record<string, unknown> | null | undefined,
): boolean {
  if (!payload) return false;
  const p = payload;
  switch (fieldKey) {
    // ── Decisive-only fields: only invalid on explicit negative
    //     evidence; the wrapper softens to supporting otherwise. ──
    case "avs_cvv_match":
      return Boolean(p.avsResultCode) || Boolean(p.cvvResultCode);
    case "tds_authentication":
      return typeof p.tdsVerified === "boolean";
    case "billing_address_match":
      return typeof p.match === "boolean";
    case "delivery_proof":
    case "shipping_tracking":
      return typeof p.proofType === "string" && p.proofType !== "";
    case "ip_location_check":
      return (
        typeof p.bankEligible === "boolean" ||
        typeof p.locationMatch === "string" ||
        Boolean(p.ipinfo)
      );
    case "device_session_consistency":
      return typeof p.consistent === "boolean";
    // ── Conditional supporting fields (rubric upgrades). The
    //     categorizer returns supporting OR strong here, never invalid,
    //     so any payload — even just `{}` — is "informative enough" to
    //     defer. The wrapper's softening is unnecessary. ──
    case "customer_communication":
    case "customer_account_info":
    case "activity_log":
    case "supporting_documents":
    case "refund_policy":
    case "shipping_policy":
    case "cancellation_policy":
      return true;
    default:
      return true;
  }
}

/**
 * Decide what category a checklist row should display.
 *
 * Rules in order:
 *  1. `status === "missing"` → no category, render "Missing".
 *  2. `status === "unavailable"` → no category, render "Not applicable".
 *  3. Always-supporting fields (per registry `supportingOnly`) →
 *     `"supporting"`, regardless of payload truthiness.
 *  4. Conditional fields with non-informative payload → `"supporting"`.
 *  5. Otherwise → defer to `categorizeEvidenceField()`.
 *
 * Result: `"invalid"` only ever surfaces from explicit negative
 * evidence (label-only shipment, both-fail AVS, AVS-flagged billing
 * mismatch, 3DS-failure, bank-ineligible IP per registry, etc.). It
 * never surfaces from missing payload, unknown fields, or supporting
 * rows.
 */
export function classifyEvidenceRow(args: {
  fieldKey: string;
  status: EvidenceItemStatus;
  payload: Record<string, unknown> | null | undefined;
}): RowClassification {
  const { fieldKey, status, payload } = args;

  if (status === "missing") return { category: null, status: "missing" };
  if (status === "unavailable") return { category: null, status: "not_applicable" };
  const statusKey: RowStatusKey = status === "waived" ? "waived" : "collected";

  const spec = CANONICAL_EVIDENCE[fieldKey];

  if (!spec) return { category: "supporting", status: statusKey };
  if (spec.supportingOnly) return { category: "supporting", status: statusKey };
  if (!payloadIsInformative(fieldKey, payload)) {
    return { category: "supporting", status: statusKey };
  }

  return {
    category: categorizeEvidenceField(fieldKey, payload ?? null),
    status: statusKey,
  };
}
