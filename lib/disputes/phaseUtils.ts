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

/** Badge tone for the phase badge. */
export function phaseBadgeTone(
  phase: DisputePhase | null,
): "info" | "warning" | undefined {
  if (phase === "inquiry") return "info";
  if (phase === "chargeback") return "warning";
  return undefined;
}

/** i18n key for phase label. */
export function phaseLabel(
  phase: DisputePhase | null,
  t: (key: string) => string,
): string {
  if (phase === "inquiry") return t("disputes.inquiryBadge");
  if (phase === "chargeback") return t("disputes.chargebackBadge");
  return t("disputes.phaseUnknown");
}

/** i18n key for the primary CTA based on phase. */
export function primaryCtaKey(phase: DisputePhase | null): string {
  if (phase === "inquiry") return "disputes.respondToInquiry";
  return "disputes.buildEvidence";
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
