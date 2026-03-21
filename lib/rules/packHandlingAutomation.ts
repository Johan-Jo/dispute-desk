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

export type PackHandlingUiMode = "manual" | "auto";

/** Map library/template dispute_type to primary Shopify Payments reason code. */
export function disputeTypeToPrimaryReason(disputeType: string): string {
  const m: Record<string, string> = {
    FRAUD: "FRAUDULENT",
    PNR: "PRODUCT_NOT_RECEIVED",
    NOT_AS_DESCRIBED: "PRODUCT_UNACCEPTABLE",
    SUBSCRIPTION: "SUBSCRIPTION_CANCELED",
    REFUND: "CREDIT_NOT_PROCESSED",
    DUPLICATE: "DUPLICATE",
    DIGITAL: "GENERAL",
    GENERAL: "GENERAL",
  };
  return m[disputeType] ?? "GENERAL";
}

function normalizeAction(action: Rule["action"]): RuleAction {
  const a = action as RuleAction;
  const mode = a.mode ?? "manual";
  if (mode === "auto_pack" || mode === "review" || mode === "manual") {
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
    const id = name.slice(prefix.length);
    const mode = normalizeAction(r.action).mode;
    out[id] = mode === "auto_pack" ? "auto" : "manual";
  }
  return out;
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
