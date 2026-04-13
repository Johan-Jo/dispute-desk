import type { Pack } from "@/lib/types/packs";
import { DISPUTE_REASONS_ORDER } from "@/lib/rules/disputeReasons";
import {
  SETUP_RULE_PREFIX,
  type AutomationSetupPayload,
  type ReasonRowState,
  type SafeguardsState,
} from "@/lib/rules/setupAutomation";
import type { Rule, RuleAction } from "@/lib/rules/types";

/** Stored as rules named `__dd_setup__:pack:{uuid}` */
export const packRuleName = (packId: string) =>
  `${SETUP_RULE_PREFIX}pack:${packId}`;

/**
 * Phase-paired inquiry rule for the same chargeback pack. The chargeback pack
 * id is used (not the inquiry sibling pack id) so the merchant-facing pack row
 * remains the single source of truth for pack mode in the wizard.
 */
export const packInquiryRuleName = (packId: string) =>
  `${SETUP_RULE_PREFIX}pack:${packId}:inquiry`;

export type PackHandlingUiMode = "manual" | "auto" | "notify";

/**
 * Map library/template dispute_type to primary Shopify Payments reason code.
 * After migration 20260411160000 pack.dispute_type stores Shopify reason
 * codes directly — this function is now mostly a pass-through. DIGITAL is
 * the one legacy value that has no Shopify equivalent and still maps to
 * GENERAL.
 */
export function disputeTypeToPrimaryReason(disputeType: string): string {
  if (disputeType === "DIGITAL") return "GENERAL";
  return disputeType || "GENERAL";
}

function normalizeAction(action: Rule["action"]): RuleAction {
  const a = action as RuleAction;
  const mode = a.mode ?? "manual";
  if (mode === "auto_pack" || mode === "review" || mode === "manual" || mode === "notify") {
    return {
      mode,
      pack_template_id: a.pack_template_id ?? null,
    };
  }
  return { mode: "manual", pack_template_id: null };
}

/**
 * Read per-pack modes from setup rules. Missing packs default in the UI.
 */
export function parsePackModesFromRules(rules: Rule[]): Record<string, PackHandlingUiMode> {
  const prefix = `${SETUP_RULE_PREFIX}pack:`;
  const out: Record<string, PackHandlingUiMode> = {};
  for (const r of rules) {
    const name = r.name ?? "";
    if (!name.startsWith(prefix)) continue;
    // Skip the phase-paired inquiry sibling rule — its mode is implied by
    // the chargeback rule it pairs with.
    if (name.endsWith(":inquiry")) continue;
    const id = name.slice(prefix.length);
    const mode = normalizeAction(r.action).mode;
    out[id] = mode === "auto_pack" ? "auto" : mode === "notify" ? "notify" : "manual";
  }
  return out;
}

/**
 * Build a reason→mode map from coverage-level rules created by the wizard's
 * Coverage step. Used as fallback for packs without per-pack rules.
 */
export function parseCoverageModesFromRules(rules: Rule[]): Map<string, PackHandlingUiMode> {
  const coveragePrefix = `${SETUP_RULE_PREFIX}coverage:`;
  const reasonToMode = new Map<string, PackHandlingUiMode>();
  for (const r of rules) {
    const name = r.name ?? "";
    if (!name.startsWith(coveragePrefix)) continue;
    if (!r.enabled) continue;
    const mode = normalizeAction(r.action).mode;
    const uiMode: PackHandlingUiMode = mode === "auto_pack" ? "auto" : mode === "notify" ? "notify" : "manual";
    const reasons = (r.match as { reason?: string[] })?.reason ?? [];
    for (const reason of reasons) {
      reasonToMode.set(reason, uiMode);
    }
  }
  return reasonToMode;
}

/**
 * Synthetic reason rows for validators / legacy readers: first matching pack per reason wins.
 */
export function buildCollapsedReasonRowsFromPacks(
  packsOrdered: Pack[],
  packModes: Record<string, PackHandlingUiMode>,
  installedTemplateIds: Set<string>
): ReasonRowState[] {
  return DISPUTE_REASONS_ORDER.map((reason) => {
    const winning = packsOrdered.find(
      (p) => disputeTypeToPrimaryReason(p.dispute_type) === reason
    );
    if (!winning) {
      return { reason, mode: "manual" as const, pack_template_id: null };
    }
    const m = packModes[winning.id] ?? "manual";
    if (m === "notify") {
      return { reason, mode: "notify" as const, pack_template_id: null };
    }
    if (m === "auto") {
      const tid = winning.template_id;
      if (!tid || !installedTemplateIds.has(tid)) {
        return { reason, mode: "review" as const, pack_template_id: null };
      }
      return {
        reason,
        mode: "auto_build" as const,
        pack_template_id: tid,
      };
    }
    return { reason, mode: "review" as const, pack_template_id: null };
  });
}

const DEFAULT_SAFEGUARDS: SafeguardsState = {
  high_value_review_enabled: false,
  high_value_min: 500,
  catch_all_review_enabled: false,
};

export function buildAutomationPayloadFromPackModes(
  packsOrdered: Pack[],
  packModes: Record<string, PackHandlingUiMode>,
  installedTemplateIds: Set<string>
): AutomationSetupPayload {
  return {
    reason_rows: buildCollapsedReasonRowsFromPacks(
      packsOrdered,
      packModes,
      installedTemplateIds
    ),
    safeguards: { ...DEFAULT_SAFEGUARDS },
  };
}

export function validatePackModes(
  packs: Pack[],
  packModes: Record<string, PackHandlingUiMode>,
  installed: Set<string>
): string | null {
  for (const p of packs) {
    const m = packModes[p.id] ?? "manual";
    if (m === "auto") {
      if (!p.template_id) return "pack_auto_requires_template";
      if (!installed.has(p.template_id)) return "validationTemplateInstalled";
    }
  }
  return null;
}
