/**
 * Lifecycle-aware coverage derivation.
 *
 * Extends the flat family coverage model to show per-phase handling.
 * Rules can be phase-aware (`match.phase = ["inquiry"]` / `["chargeback"]`)
 * or phase-blind (no `match.phase`). Phase-blind rules match both phases for
 * back-compat. Phase-specific rules win at the same priority.
 * Per-phase template defaults still come from reason_template_mappings.
 */

import {
  DISPUTE_FAMILIES,
  type AutomationMode,
  type DisputeFamily,
} from "./deriveCoverage";
import { canonicalReasonCode } from "@/lib/rules/disputeReasons";

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

/**
 * WHY the family's mode reads the way it does.
 *
 * "Auto" from inheritance and "Auto" from a pin behave identically today and
 * diverge the moment the store switch moves. Without this a merchant cannot
 * understand why flipping the switch changed one family and not another.
 */
export type AutomationSource = "override" | "store_default";

export interface LifecyclePhaseHandling {
  phase: "inquiry" | "chargeback";
  /**
   * The EFFECTIVE mode for this family — what a dispute would actually get.
   * Never `"none"`: a family with no reason rule inherits the store-wide
   * switch, which is what the engine does at tier-2.
   */
  automationMode: AutomationMode;
  /** Whether `automationMode` came from a per-family rule or the store switch. */
  automationSource: AutomationSource;
  /** Active packs matching this family */
  playbooks: { id: string; name: string; disputeType: string }[];
  /** Default template from reason_template_mappings for this phase */
  mappedTemplateName: string | null;
  /**
   * A gap is **no playbook installed** for the family.
   *
   * Automation mode is deliberately NOT a gap dimension any more: it always
   * resolves — to an override or to the store default — so counting it as
   * "missing" was what made every family read "Review / needs a rule" once the
   * per-family rules collapsed into one switch.
   */
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
    phase?: ("inquiry" | "chargeback")[];
  };
  action: { mode: string; pack_template_id?: string | null };
}

interface PackInput {
  id: string;
  name: string;
  dispute_type: string;
  status: string;
}

/** The store-wide switch, as `GET /api/automation/store` reports it. */
type StoreDefaultMode = "auto" | "review";

// ---------------------------------------------------------------------------
// Pack type → family match
// pack_templates.dispute_type / packs.dispute_type use Shopify reason codes
// directly after migration 20260411160000. DIGITAL is the only legacy value
// with no Shopify equivalent — it maps to GENERAL family.
// ---------------------------------------------------------------------------

function packMatchesFamily(pack: PackInput, family: DisputeFamily): boolean {
  const raw = pack.dispute_type?.toUpperCase();
  if (!raw) return false;
  if (raw === "DIGITAL") {
    return family.reasons.includes("GENERAL");
  }
  // Rows written before 2026-07-28 may carry SUBSCRIPTION_CANCELED (single L).
  const type = canonicalReasonCode(raw) ?? raw;
  return family.reasons.includes(type);
}

function ruleMatchesFamily(
  rule: RuleInput,
  family: DisputeFamily,
  phase?: "inquiry" | "chargeback",
): boolean {
  if (!rule.enabled) return false;
  if (phase && rule.match.phase?.length && !rule.match.phase.includes(phase)) {
    return false;
  }
  // Only rules with an explicit reason filter overlapping the family's
  // reasons define a family's automation mode. Catch-all rules
  // (safeguards, fallbacks, custom global rules) match disputes at
  // dispatch time but must not override the per-family Current Mode
  // shown on the Coverage page — that would diverge from the
  // Automation page, which only reads pack-specific rules.
  if (!rule.match.reason || rule.match.reason.length === 0) return false;
  const ruleReasons = rule.match.reason.map((r) => canonicalReasonCode(r) ?? r);
  return family.reasons.some((r) => ruleReasons.includes(r));
}

/** Phase-specific rules win over phase-blind rules at the same priority. */
function pickRuleForFamilyAndPhase(
  rules: RuleInput[],
  family: DisputeFamily,
  phase: "inquiry" | "chargeback",
): RuleInput | null {
  const matches = rules.filter((r) => ruleMatchesFamily(r, family, phase));
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const aPhase = a.match.phase?.length ? 0 : 1;
    const bPhase = b.match.phase?.length ? 0 : 1;
    return aPhase - bPhase;
  });
  return matches[0];
}

/**
 * Map a stored rule.action.mode (canonical "auto"|"review" or any legacy
 * value) to the coverage-page AutomationMode. Mirrors the two-mode model
 * defined in lib/rules/normalizeMode.ts: anything that is not "auto" /
 * "auto_pack" is review.
 */
function ruleToAutomationMode(rule: RuleInput): AutomationMode {
  if (rule.action.mode === "auto" || rule.action.mode === "auto_pack") {
    return "automated";
  }
  return "review_first";
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
  storeDefaultMode: StoreDefaultMode,
): LifecyclePhaseHandling {
  // No reason rule for this family means it inherits the store-wide switch —
  // the tier-2 catch-all the engine falls through to. Reporting "none" here is
  // what produced seven rows reading "Review" for a store set to Auto-pilot:
  // the only setup rows left after the collapse are the fallback (`match: {}`)
  // and the safeguard (`match: { amount_range }`), and neither carries a
  // `reason`, so neither can define a family's mode.
  const automationMode: AutomationMode = matchingRule
    ? ruleToAutomationMode(matchingRule)
    : storeDefaultMode === "auto"
      ? "automated"
      : "review_first";
  const automationSource: AutomationSource = matchingRule
    ? "override"
    : "store_default";

  const playbooks = matchingPacks.map((p) => ({ id: p.id, name: p.name, disputeType: p.dispute_type }));

  // Find the best mapped template for this phase from reason_template_mappings
  const phaseMapping = mappings.find(
    (m) =>
      m.dispute_phase === phase &&
      m.is_active &&
      family.reasons.includes(m.reason_code) &&
      m.template_id != null,
  );
  const mappedTemplateName = phaseMapping?.template_name ?? null;

  const hasGap = playbooks.length === 0 && mappedTemplateName === null;

  const warnings: string[] = [];
  if (hasGap) {
    warnings.push("coverage.noPlaybook");
  }
  if (automationMode === "review_first" && playbooks.length === 0) {
    warnings.push("coverage.reviewOnly");
  }

  return {
    phase,
    automationMode,
    automationSource,
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
  /**
   * The store-wide switch, which every family without its own rule inherits.
   * Defaulted for back-compat with callers that predate the group model; a
   * caller that has the real value must pass it (`GET /api/automation/store`).
   */
  storeDefaultMode: StoreDefaultMode = "review",
): LifecycleCoverageSummary {
  const families: LifecycleFamilyCoverage[] = DISPUTE_FAMILIES.map((family) => {
    const matchingPacks = activePacks.filter((p) => packMatchesFamily(p, family));
    const inquiryRule = pickRuleForFamilyAndPhase(rules, family, "inquiry");
    const chargebackRule = pickRuleForFamilyAndPhase(
      rules,
      family,
      "chargeback",
    );

    const inquiry = derivePhaseHandling(
      "inquiry",
      family,
      inquiryRule,
      matchingPacks,
      reasonMappings,
      storeDefaultMode,
    );
    const chargeback = derivePhaseHandling(
      "chargeback",
      family,
      chargebackRule,
      matchingPacks,
      reasonMappings,
      storeDefaultMode,
    );

    // Fully covered = BOTH phases have handling. Partial = one phase. Not covered = both gaps.
    const overallCovered = !inquiry.hasGap && !chargeback.hasGap;

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
