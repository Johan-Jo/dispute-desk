/**
 * View-model derivation for the redesigned coverage page.
 * Pure functions — no React, no Polaris. Imported by both the
 * desktop table and the mobile list.
 */

import type {
  LifecycleFamilyCoverage,
  LifecyclePhaseHandling,
} from "@/lib/coverage/deriveLifecycleCoverage";

export type ChargebackStatus = "configured" | "missing-playbook" | "needs-rule";
export type InquiryStatus = "enabled" | "disabled";
/**
 * Two merchant-facing modes only — see lib/rules/normalizeMode.ts.
 * Legacy `manual` / `notify` values normalize to `review`.
 */
export type CurrentMode = "auto-submit" | "review";

export interface CoverageRow {
  familyId: string;
  labelKey: string;
  chargeback: ChargebackStatus;
  inquiry: InquiryStatus;
  mode: CurrentMode;
}

export function chargebackStatus(h: LifecyclePhaseHandling): ChargebackStatus {
  if (!h.hasGap) return "configured";
  if (h.automationMode !== "none") return "missing-playbook";
  return "needs-rule";
}

export function inquiryStatus(h: LifecyclePhaseHandling): InquiryStatus {
  return h.hasGap ? "disabled" : "enabled";
}

export function currentMode(h: LifecyclePhaseHandling): CurrentMode {
  return h.automationMode === "automated" ? "auto-submit" : "review";
}

export function toRow(family: LifecycleFamilyCoverage): CoverageRow {
  return {
    familyId: family.familyId,
    labelKey: family.labelKey,
    chargeback: chargebackStatus(family.chargeback),
    inquiry: inquiryStatus(family.inquiry),
    mode: currentMode(family.chargeback),
  };
}

/** Per-family icon background tint used inside the 32×32 icon square. */
export const FAMILY_ICON_COLOR: Record<string, string> = {
  fraud: "#DC2626",
  pnr: "#3B82F6",
  not_as_described: "#F59E0B",
  subscription: "#22C55E",
  refund: "#8B5CF6",
  duplicate: "#06B6D4",
  general: "#6D7175",
};

/** Translatable family label key (strips the "coverage." prefix from labelKey). */
export function familyLabelKey(labelKey: string): string {
  return labelKey.replace(/^coverage\./, "");
}
