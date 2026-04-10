/**
 * Lifecycle-aware coverage derivation.
 *
 * Extends the flat family coverage model to show per-phase handling.
 * Rules are phase-blind — both phases show the same automation mode.
 * The difference comes from reason_template_mappings (per-phase template defaults).
 */

import {
  DISPUTE_FAMILIES,
  type AutomationMode,
  type DisputeFamily,
} from "./deriveCoverage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReasonMappingInput {
  reason_code: string;
  dispute_phase: "inquiry" | "chargeback";
  template_id: string | null;
  template_name: string | null;
  is_active: boolean;
}

export interface LifecyclePhaseHandling {
  phase: "inquiry" | "chargeback";
  /** From rules (phase-blind — same for both phases currently) */
  automationMode: AutomationMode;
  /** Active packs matching this family */
  playbooks: { id: string; name: string }[];
  /** Default template from reason_template_mappings for this phase */
  mappedTemplateName: string | null;
  /** True if automation mode is "none" AND no playbooks AND no mapped template */
  hasGap: boolean;
  /** Merchant-facing warnings (i18n keys) */
  warnings: string[];
}

export interface LifecycleFamilyCoverage {
  familyId: string;
  labelKey: string;
  reasons: string[];
  inquiry: LifecyclePhaseHandling;
  chargeback: LifecyclePhaseHandling;
  overallCovered: boolean;
}

export interface LifecycleCoverageSummary {
  families: LifecycleFamilyCoverage[];
  inquiryConfiguredCount: number;
  chargebackConfiguredCount: number;
  fullyConfiguredCount: number;
  gapsCount: number;
  totalFamilies: number;
}

// ---------------------------------------------------------------------------
// Inputs (same shapes as deriveCoverage.ts)
// ---------------------------------------------------------------------------

interface RuleInput {
  id: string;
  enabled: boolean;
  match: {
    reason?: string[];
    status?: string[];
    amount_range?: { min?: number; max?: number };
  };
  action: { mode: string; pack_template_id?: string | null };
}

interface PackInput {
  id: string;
  name: string;
  dispute_type: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Pack type → reason mapping (reuse from deriveCoverage)
// ---------------------------------------------------------------------------

const PACK_TYPE_TO_REASONS: Record<string, string[]> = {
  FRAUD: ["FRAUDULENT"],
  FRAUDULENT: ["FRAUDULENT"],
  PNR: ["PRODUCT_NOT_RECEIVED"],
  PRODUCT_NOT_RECEIVED: ["PRODUCT_NOT_RECEIVED"],
  NOT_AS_DESCRIBED: ["PRODUCT_UNACCEPTABLE", "NOT_AS_DESCRIBED"],
  PRODUCT_UNACCEPTABLE: ["PRODUCT_UNACCEPTABLE", "NOT_AS_DESCRIBED"],
  SUBSCRIPTION: ["SUBSCRIPTION_CANCELED"],
  SUBSCRIPTION_CANCELED: ["SUBSCRIPTION_CANCELED"],
  REFUND: ["CREDIT_NOT_PROCESSED"],
  CREDIT_NOT_PROCESSED: ["CREDIT_NOT_PROCESSED"],
  DUPLICATE: ["DUPLICATE"],
  DIGITAL: ["GENERAL"],
  GENERAL: ["GENERAL"],
};

function packMatchesFamily(pack: PackInput, family: DisputeFamily): boolean {
  const packReasons =
    PACK_TYPE_TO_REASONS[pack.dispute_type?.toUpperCase()] ?? [];
  return family.reasons.some((r) => packReasons.includes(r));
}

function ruleMatchesFamily(rule: RuleInput, family: DisputeFamily): boolean {
  if (!rule.enabled) return false;
  if (!rule.match.reason || rule.match.reason.length === 0) return true;
  return family.reasons.some((r) => rule.match.reason!.includes(r));
}

function ruleToAutomationMode(rule: RuleInput): AutomationMode {
  switch (rule.action.mode) {
    case "auto_pack":
      return "automated";
    case "review":
      return "review_first";
    case "manual":
      return "manual";
    default:
      return "none";
  }
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

function derivePhaseHandling(
  phase: "inquiry" | "chargeback",
  family: DisputeFamily,
  matchingRule: RuleInput | null,
  matchingPacks: PackInput[],
  mappings: ReasonMappingInput[],
): LifecyclePhaseHandling {
  const automationMode = matchingRule
    ? ruleToAutomationMode(matchingRule)
    : "none";

  const playbooks = matchingPacks.map((p) => ({ id: p.id, name: p.name }));

  // Find the best mapped template for this phase from reason_template_mappings
  const phaseMapping = mappings.find(
    (m) =>
      m.dispute_phase === phase &&
      m.is_active &&
      family.reasons.includes(m.reason_code) &&
      m.template_id != null,
  );
  const mappedTemplateName = phaseMapping?.template_name ?? null;

  const hasGap =
    automationMode === "none" &&
    playbooks.length === 0 &&
    mappedTemplateName === null;

  const warnings: string[] = [];
  if (playbooks.length === 0 && mappedTemplateName === null) {
    warnings.push("coverage.noPlaybook");
  }
  if (automationMode === "none") {
    warnings.push("coverage.noAutomation");
  }
  if (automationMode === "review_first" && playbooks.length === 0) {
    warnings.push("coverage.reviewOnly");
  }

  return {
    phase,
    automationMode,
    playbooks,
    mappedTemplateName,
    hasGap,
    warnings,
  };
}

export function deriveLifecycleCoverage(
  rules: RuleInput[],
  activePacks: PackInput[],
  reasonMappings: ReasonMappingInput[],
): LifecycleCoverageSummary {
  const families: LifecycleFamilyCoverage[] = DISPUTE_FAMILIES.map((family) => {
    const matchingPacks = activePacks.filter((p) => packMatchesFamily(p, family));
    const matchingRule =
      rules.find((r) => ruleMatchesFamily(r, family)) ?? null;

    const inquiry = derivePhaseHandling(
      "inquiry",
      family,
      matchingRule,
      matchingPacks,
      reasonMappings,
    );
    const chargeback = derivePhaseHandling(
      "chargeback",
      family,
      matchingRule,
      matchingPacks,
      reasonMappings,
    );

    const overallCovered = !inquiry.hasGap || !chargeback.hasGap;

    return {
      familyId: family.id,
      labelKey: family.labelKey,
      reasons: family.reasons,
      inquiry,
      chargeback,
      overallCovered,
    };
  });

  return {
    families,
    inquiryConfiguredCount: families.filter((f) => !f.inquiry.hasGap).length,
    chargebackConfiguredCount: families.filter((f) => !f.chargeback.hasGap)
      .length,
    fullyConfiguredCount: families.filter(
      (f) => !f.inquiry.hasGap && !f.chargeback.hasGap,
    ).length,
    gapsCount: families.filter(
      (f) => f.inquiry.hasGap || f.chargeback.hasGap,
    ).length,
    totalFamilies: families.length,
  };
}

export { DISPUTE_FAMILIES };
