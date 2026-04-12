/**
 * Coverage derivation utility.
 *
 * Takes existing rules and active packs and derives a merchant-facing
 * coverage view per dispute family. No new backend — this is a pure
 * read-only projection of existing data.
 */

export interface DisputeFamily {
  id: string;
  /** Shopify reason codes that map to this family */
  reasons: string[];
  /** i18n key for the family label (e.g. "coverage.familyFraud") */
  labelKey: string;
}

export const DISPUTE_FAMILIES: DisputeFamily[] = [
  { id: "fraud", reasons: ["FRAUDULENT", "UNRECOGNIZED"], labelKey: "coverage.familyFraud" },
  { id: "pnr", reasons: ["PRODUCT_NOT_RECEIVED"], labelKey: "coverage.familyPnr" },
  { id: "not_as_described", reasons: ["PRODUCT_UNACCEPTABLE", "NOT_AS_DESCRIBED"], labelKey: "coverage.familyNotAsDescribed" },
  { id: "subscription", reasons: ["SUBSCRIPTION_CANCELED"], labelKey: "coverage.familySubscription" },
  { id: "refund", reasons: ["CREDIT_NOT_PROCESSED"], labelKey: "coverage.familyRefund" },
  { id: "duplicate", reasons: ["DUPLICATE"], labelKey: "coverage.familyDuplicate" },
  { id: "general", reasons: ["GENERAL"], labelKey: "coverage.familyGeneral" },
];

export type AutomationMode = "automated" | "review_first" | "manual" | "none";

export interface FamilyCoverage {
  familyId: string;
  labelKey: string;
  reasons: string[];
  hasCoverage: boolean;
  automationMode: AutomationMode;
  activePackCount: number;
  matchingRuleId: string | null;
}

export interface CoverageSummary {
  families: FamilyCoverage[];
  coveredCount: number;
  automatedCount: number;
  reviewFirstCount: number;
  totalFamilies: number;
}

interface RuleInput {
  id: string;
  enabled: boolean;
  match: { reason?: string[]; status?: string[]; amount_range?: { min?: number; max?: number } };
  action: { mode: string; pack_template_id?: string | null };
}

interface PackInput {
  id: string;
  dispute_type: string;
  status: string;
}

/**
 * pack_templates.dispute_type and packs.dispute_type use Shopify
 * reason codes directly after migration
 * 20260411160000_normalize_dispute_type_to_reason_codes.sql. DIGITAL
 * is the one legacy value that has no Shopify equivalent — it maps
 * to GENERAL family handling.
 */
function packMatchesFamily(pack: PackInput, family: DisputeFamily): boolean {
  const type = pack.dispute_type?.toUpperCase();
  if (!type) return false;
  if (type === "DIGITAL") {
    return family.reasons.includes("GENERAL");
  }
  return family.reasons.includes(type);
}

function ruleMatchesFamily(rule: RuleInput, family: DisputeFamily): boolean {
  if (!rule.enabled) return false;
  // Catch-all rule (no reason filter) matches every family
  if (!rule.match.reason || rule.match.reason.length === 0) return true;
  return family.reasons.some((r) => rule.match.reason!.includes(r));
}

function ruleToAutomationMode(rule: RuleInput): AutomationMode {
  switch (rule.action.mode) {
    case "auto_pack": return "automated";
    case "review": return "review_first";
    case "manual": return "manual";
    default: return "none";
  }
}

export function deriveCoverage(
  rules: RuleInput[],
  activePacks: PackInput[],
): CoverageSummary {
  const families: FamilyCoverage[] = DISPUTE_FAMILIES.map((family) => {
    const matchingPacks = activePacks.filter((p) => packMatchesFamily(p, family));
    const matchingRule = rules.find((r) => ruleMatchesFamily(r, family)) ?? null;

    return {
      familyId: family.id,
      labelKey: family.labelKey,
      reasons: family.reasons,
      hasCoverage: matchingPacks.length > 0 || matchingRule !== null,
      automationMode: matchingRule ? ruleToAutomationMode(matchingRule) : "none",
      activePackCount: matchingPacks.length,
      matchingRuleId: matchingRule?.id ?? null,
    };
  });

  return {
    families,
    coveredCount: families.filter((f) => f.hasCoverage).length,
    automatedCount: families.filter((f) => f.automationMode === "automated").length,
    reviewFirstCount: families.filter((f) => f.automationMode === "review_first").length,
    totalFamilies: families.length,
  };
}
