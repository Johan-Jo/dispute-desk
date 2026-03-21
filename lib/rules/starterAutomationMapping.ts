import { RULE_PRESETS, type RulePreset } from "@/lib/rules/presets";
import type {
  AutomationSetupPayload,
  HandlingModeUi,
} from "@/lib/rules/setupAutomation";
import type { TemplateListItem } from "@/lib/types/templates";

/** UI routing aligned with embedded Rules presets (Auto-Pack vs Send to review). */
export type StarterRoutingMode = "auto_pack" | "review";

const PRESET_FRAUD = "preset-fraud-auto";
const PRESET_PNR = "preset-pnr-auto";
const PRESET_HIGH = "preset-high-value-review";
const PRESET_CATCH = "preset-catch-all-review";

function reasonRow(
  payload: AutomationSetupPayload,
  reason: string
): { mode: HandlingModeUi; pack_template_id: string | null } | undefined {
  return payload.reason_rows.find((r) => r.reason === reason);
}

/** Map automation row to starter routing (manual → review for display). */
function handlingToStarter(
  mode: HandlingModeUi
): StarterRoutingMode {
  if (mode === "auto_build") return "auto_pack";
  return "review";
}

/**
 * Pick a template id for auto_build: prefer catalog by dispute type, else first installed.
 */
export function pickTemplateIdForDisputeType(
  installedTemplateIds: string[],
  catalog: TemplateListItem[],
  disputeType: "FRAUD" | "PNR"
): string | null {
  const installed = new Set(installedTemplateIds);
  const match = catalog
    .filter((x) => installed.has(x.id) && x.dispute_type === disputeType)
    .sort((a, b) => Number(b.is_recommended) - Number(a.is_recommended))[0];
  if (match) return match.id;
  return installedTemplateIds[0] ?? null;
}

export function starterModesFromPayload(
  payload: AutomationSetupPayload
): Record<string, StarterRoutingMode> {
  const out: Record<string, StarterRoutingMode> = {};
  for (const p of RULE_PRESETS) {
    out[p.id] = p.action.mode === "auto_pack" ? "auto_pack" : "review";
  }

  const fraud = reasonRow(payload, "FRAUDULENT");
  if (fraud) out[PRESET_FRAUD] = handlingToStarter(fraud.mode);

  const pnr = reasonRow(payload, "PRODUCT_NOT_RECEIVED");
  if (pnr) out[PRESET_PNR] = handlingToStarter(pnr.mode);

  out[PRESET_HIGH] = payload.safeguards.high_value_review_enabled
    ? "review"
    : "auto_pack";
  out[PRESET_CATCH] = payload.safeguards.catch_all_review_enabled
    ? "review"
    : "auto_pack";

  return out;
}

export interface ApplyStarterModeContext {
  installedTemplateIds: string[];
  catalog: TemplateListItem[];
}

/**
 * Apply a single starter row change. Preserves all `reason_rows` entries not touched by this preset.
 */
export function applyStarterModeChange(
  prev: AutomationSetupPayload,
  preset: RulePreset,
  mode: StarterRoutingMode,
  ctx: ApplyStarterModeContext
): AutomationSetupPayload {
  const { installedTemplateIds, catalog } = ctx;

  if (preset.id === PRESET_FRAUD) {
    const reason = "FRAUDULENT";
    return {
      ...prev,
      reason_rows: prev.reason_rows.map((row) => {
        if (row.reason !== reason) return row;
        if (mode === "review") {
          return { ...row, mode: "review" as const, pack_template_id: null };
        }
        const tid = pickTemplateIdForDisputeType(
          installedTemplateIds,
          catalog,
          "FRAUD"
        );
        if (!tid) {
          return { ...row, mode: "review" as const, pack_template_id: null };
        }
        return {
          ...row,
          mode: "auto_build" as const,
          pack_template_id: tid,
        };
      }),
    };
  }

  if (preset.id === PRESET_PNR) {
    const reason = "PRODUCT_NOT_RECEIVED";
    return {
      ...prev,
      reason_rows: prev.reason_rows.map((row) => {
        if (row.reason !== reason) return row;
        if (mode === "review") {
          return { ...row, mode: "review" as const, pack_template_id: null };
        }
        const tid = pickTemplateIdForDisputeType(
          installedTemplateIds,
          catalog,
          "PNR"
        );
        if (!tid) {
          return { ...row, mode: "review" as const, pack_template_id: null };
        }
        return {
          ...row,
          mode: "auto_build" as const,
          pack_template_id: tid,
        };
      }),
    };
  }

  if (preset.id === PRESET_HIGH) {
    return {
      ...prev,
      safeguards: {
        ...prev.safeguards,
        high_value_review_enabled: mode === "review",
      },
    };
  }

  if (preset.id === PRESET_CATCH) {
    return {
      ...prev,
      safeguards: {
        ...prev.safeguards,
        catch_all_review_enabled: mode === "review",
      },
    };
  }

  return prev;
}

/** When no templates are installed, auto_build on fraud/PNR cannot validate — force review. */
export function coerceFraudPnrAutoWhenNoTemplates(
  payload: AutomationSetupPayload,
  installedTemplateIds: string[]
): AutomationSetupPayload {
  if (installedTemplateIds.length > 0) return payload;
  return {
    ...payload,
    reason_rows: payload.reason_rows.map((row) => {
      if (
        (row.reason === "FRAUDULENT" ||
          row.reason === "PRODUCT_NOT_RECEIVED") &&
        row.mode === "auto_build"
      ) {
        return { ...row, mode: "review" as const, pack_template_id: null };
      }
      return row;
    }),
  };
}
