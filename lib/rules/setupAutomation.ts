import { getServiceClient } from "@/lib/supabase/server";
import { RULE_PRESETS } from "@/lib/rules/presets";
import { DISPUTE_REASONS_ORDER } from "@/lib/rules/disputeReasons";
import type { Rule, RuleAction } from "@/lib/rules/types";

const LEGACY_PRESET_NAMES = new Set(RULE_PRESETS.map((p) => p.name));

export const SETUP_RULE_PREFIX = "__dd_setup__:";

export type HandlingModeUi = "auto_build" | "review" | "manual";

export interface ReasonRowState {
  reason: string;
  mode: HandlingModeUi;
  pack_template_id: string | null;
}

export interface SafeguardsState {
  high_value_review_enabled: boolean;
  high_value_min: number;
  catch_all_review_enabled: boolean;
}

export interface AutomationSetupPayload {
  reason_rows: ReasonRowState[];
  safeguards: SafeguardsState;
}

const NAME_REASON = (reason: string) =>
  `${SETUP_RULE_PREFIX}reason:${reason}`;
const NAME_HIGH_VALUE = `${SETUP_RULE_PREFIX}safeguard:high_value`;
const NAME_CATCH_ALL = `${SETUP_RULE_PREFIX}safeguard:catch_all`;

function toDbAction(
  mode: HandlingModeUi,
  packTemplateId: string | null
): RuleAction {
  if (mode === "auto_build") {
    return {
      mode: "auto_pack",
      pack_template_id: packTemplateId,
    };
  }
  if (mode === "review") {
    return { mode: "review", pack_template_id: packTemplateId };
  }
  return { mode: "manual", pack_template_id: null };
}

function priorityForReason(reason: string): number {
  const idx = DISPUTE_REASONS_ORDER.indexOf(
    reason as (typeof DISPUTE_REASONS_ORDER)[number]
  );
  return 20 + (idx >= 0 ? idx : 99);
}

/** Build rule rows for replace-insert (setup-managed only). */
export function buildSetupRules(
  shopId: string,
  payload: AutomationSetupPayload
): Array<Omit<Rule, "id" | "created_at" | "updated_at">> {
  const rows: Array<Omit<Rule, "id" | "created_at" | "updated_at">> = [];

  if (payload.safeguards.high_value_review_enabled) {
    rows.push({
      shop_id: shopId,
      enabled: true,
      name: NAME_HIGH_VALUE,
      match: { amount_range: { min: payload.safeguards.high_value_min } },
      action: { mode: "review" },
      priority: 5,
    });
  }

  for (const row of payload.reason_rows) {
    rows.push({
      shop_id: shopId,
      enabled: true,
      name: NAME_REASON(row.reason),
      match: { reason: [row.reason] },
      action: toDbAction(row.mode, row.pack_template_id),
      priority: priorityForReason(row.reason),
    });
  }

  if (payload.safeguards.catch_all_review_enabled) {
    rows.push({
      shop_id: shopId,
      enabled: true,
      name: NAME_CATCH_ALL,
      match: {},
      action: { mode: "review" },
      priority: 100,
    });
  }

  return rows;
}

function uiModeFromAction(action: RuleAction): HandlingModeUi {
  if (action.mode === "auto_pack") return "auto_build";
  if (action.mode === "review") return "review";
  return "manual";
}

/** Merge DB rules + defaults into UI state. */
export function parseAutomationFromRules(
  rules: Rule[]
): AutomationSetupPayload {
  const byName = new Map(
    rules.map((r) => [r.name ?? "", r] as const)
  );

  const reason_rows: ReasonRowState[] = DISPUTE_REASONS_ORDER.map((reason) => {
    const row = byName.get(NAME_REASON(reason));
    if (row) {
      const action = row.action as RuleAction;
      return {
        reason,
        mode: uiModeFromAction(action),
        pack_template_id: action.pack_template_id ?? null,
      };
    }
    return { reason, mode: "manual", pack_template_id: null };
  });

  const highRule = byName.get(NAME_HIGH_VALUE);
  const catchRule = byName.get(NAME_CATCH_ALL);

  const safeguards: SafeguardsState = {
    high_value_review_enabled: !!highRule?.enabled,
    high_value_min: highRule?.match?.amount_range?.min ?? 500,
    catch_all_review_enabled: !!catchRule?.enabled,
  };

  return { reason_rows, safeguards };
}

/** When no setup-prefixed rules exist, derive display state from legacy install-preset rules. */
export function mergeLegacyPresetRulesIntoPayload(
  rules: Rule[],
  base: AutomationSetupPayload
): AutomationSetupPayload {
  const hasSetup = rules.some((r) => r.name?.startsWith(SETUP_RULE_PREFIX));
  if (hasSetup) return base;

  const byLegacyName = new Map(
    rules.map((r) => [r.name as string, r] as const)
  );

  let reason_rows = [...base.reason_rows];

  for (const preset of RULE_PRESETS) {
    const legacy = byLegacyName.get(preset.name);
    if (!legacy) continue;
    const reasons = preset.match.reason ?? [];
    const mode: HandlingModeUi =
      legacy.action.mode === "auto_pack" ? "auto_build" : "review";
    for (const reason of reasons) {
      reason_rows = reason_rows.map((row) =>
        row.reason === reason ? { ...row, mode } : row
      );
    }
  }

  const highPreset = RULE_PRESETS.find(
    (p) => p.id === "preset-high-value-review"
  );
  const catchPreset = RULE_PRESETS.find(
    (p) => p.id === "preset-catch-all-review"
  );

  const highLegacy = highPreset
    ? byLegacyName.get(highPreset.name)
    : undefined;
  const catchLegacy = catchPreset
    ? byLegacyName.get(catchPreset.name)
    : undefined;

  const safeguards: SafeguardsState = {
    high_value_review_enabled:
      base.safeguards.high_value_review_enabled || !!highLegacy?.enabled,
    high_value_min:
      highLegacy?.match?.amount_range?.min ?? base.safeguards.high_value_min,
    catch_all_review_enabled:
      base.safeguards.catch_all_review_enabled || !!catchLegacy?.enabled,
  };

  return { reason_rows, safeguards };
}

export async function replaceSetupAutomationRules(
  shopId: string,
  payload: AutomationSetupPayload
): Promise<void> {
  const sb = getServiceClient();

  await sb
    .from("rules")
    .delete()
    .eq("shop_id", shopId)
    .like("name", `${SETUP_RULE_PREFIX}%`);

  await sb
    .from("rules")
    .delete()
    .eq("shop_id", shopId)
    .in("name", [...LEGACY_PRESET_NAMES]);

  const rows = buildSetupRules(shopId, payload);
  if (rows.length === 0) return;

  const { error } = await sb.from("rules").insert(
    rows.map((r) => ({
      shop_id: r.shop_id,
      enabled: r.enabled,
      name: r.name,
      match: r.match,
      action: r.action,
      priority: r.priority,
    }))
  );

  if (error) throw new Error(error.message);
}
