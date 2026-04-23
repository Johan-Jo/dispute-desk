/**
 * Shared constants and types for the setup automation rule system.
 *
 * The canonical write path is pack-based (replacePackAutomationRules).
 * This file retains the prefix constant and type definitions that the
 * pack-based system and its consumers depend on.
 */

export const SETUP_RULE_PREFIX = "__dd_setup__:";

/**
 * UI-facing handling mode in the setup wizard. Mirrors the canonical
 * AutomationMode exactly — the wizard offers only the two merchant-facing
 * choices.
 */
export type HandlingModeUi = "auto" | "review";

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
