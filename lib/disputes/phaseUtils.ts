import {
  DISPUTE_REASON_FAMILIES,
  type DisputePhase,
  type AllDisputeReasonCode,
} from "@/lib/rules/disputeReasons";
import type { HandlingMode } from "@/lib/types/dispute";

/** Look up the reason family, defaulting to "General". */
export function deriveFamily(reason: string | null): string {
  if (!reason) return "General";
  return (
    DISPUTE_REASON_FAMILIES[reason as AllDisputeReasonCode] ?? "General"
  );
}

/** Derive handling mode from matched rule. */
export function deriveHandlingMode(
  matchedRule: { mode: string } | null | undefined,
): HandlingMode {
  if (!matchedRule) return "manual";
  switch (matchedRule.mode) {
    case "auto_pack":
      return "automated";
    case "review":
      return "review";
    default:
      return "manual";
  }
}

/** Badge tone for the phase badge. Null defaults to chargeback tone. */
export function phaseBadgeTone(
  phase: DisputePhase | null,
): "info" | "warning" {
  if (phase === "inquiry") return "info";
  return "warning";
}

/** Label for phase badge. Null defaults to "Chargeback" (safer assumption). */
export function phaseLabel(
  phase: DisputePhase | null,
  t: (key: string) => string,
): string {
  if (phase === "inquiry") return t("disputes.inquiryBadge");
  return t("disputes.chargebackBadge");
}

/** Whether phase is known and actionable. */
export function isPhaseKnown(phase: string | null): phase is "inquiry" | "chargeback" {
  return phase === "inquiry" || phase === "chargeback";
}

/**
 * State-dependent primary CTA for case detail.
 * Returns { key, disabled } where key is the i18n key.
 */
export function casePrimaryCta(
  phase: DisputePhase | null,
  packStatus: string | null,
): { key: string; disabled: boolean } {
  // Phase-specific CTA based on pack state
  // Unknown phase: treat like chargeback (safer default), workflow is not blocked
  if (phase === "inquiry") {
    if (!packStatus) return { key: "disputes.prepareResponse", disabled: false };
    if (packStatus === "building" || packStatus === "queued") return { key: "disputes.generating", disabled: true };
    if (packStatus === "saved_to_shopify") return { key: "disputes.viewInShopify", disabled: false };
    return { key: "disputes.reviewAndSend", disabled: false };
  }

  // Chargeback
  if (!packStatus) return { key: "disputes.buildEvidence", disabled: false };
  if (packStatus === "building" || packStatus === "queued") return { key: "disputes.generating", disabled: true };
  if (packStatus === "saved_to_shopify") return { key: "disputes.viewInShopify", disabled: false };
  return { key: "disputes.reviewAndSave", disabled: false };
}

/** Phase-aware dispute page title. */
export function disputeTitle(
  phase: DisputePhase | null,
  id: string,
  t: (key: string, params?: Record<string, string>) => string,
): string {
  if (phase === "inquiry") return t("disputes.inquiryTitle", { id });
  if (phase === "chargeback") return t("disputes.chargebackTitle", { id });
  return t("disputes.caseTitle", { id });
}
