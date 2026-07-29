/**
 * storeAutomation — the ONE read/write path for a shop's store-wide
 * automation setting **and its per-group overrides**.
 *
 * ## The model
 *
 * Setup owns TWO canonical rows in `rules`, plus at most one row per
 * automation group (see ./automationGroups.ts):
 *
 *   __dd_setup__:fallback:default    match {}                    priority 100000
 *       Its `action.mode` IS the store-wide switch. As the tier-2 catch-all it
 *       is what every dispute falls through to when no custom rule matches.
 *
 *   __dd_setup__:safeguard:high_value   match { amount_range: { min } }  priority 5
 *       Tier-0 amount safeguard — wins outright over everything, forcing review
 *       on high-value disputes. This name (not the legacy `__dd_safeguard__:`
 *       one) is what `lib/automation/pipeline.ts` matches to send the
 *       high-value review email.
 *
 *   __dd_setup__:group:{id}   match { reason: [...] }        priority 50
 *       An optional per-dispute-type override. Structurally tier-1, so it
 *       beats the catch-all switch and loses to the amount safeguard.
 *       **Absence means "inherit the switch"** — there is no third state.
 *
 * Merchant-authored custom rules (any name NOT starting with `__dd_setup__:`)
 * are never touched by this module and keep working through the unchanged
 * tier0/tier1/tier2 evaluation in `pickAutomationAction`.
 *
 * ## Why a rules row and not a typed column
 *
 * A `shop_settings.automation_mode` column would need a "default mode"
 * parameter threaded through `evaluateRules` → `pickAutomationAction` and
 * every caller, creating a SECOND evaluation authority. The catch-all rule
 * already IS the store-wide default semantically. We are deleting concepts
 * (per-pack rules, per-family coverage rules, a duplicate safeguard name),
 * not adding one.
 *
 * ## The auto_save_enabled mirror — "enabled SOMEWHERE", not "the switch"
 *
 * `shop_settings.auto_save_enabled` has exactly one functional reader:
 * `evaluateAutoSaveGate`, reached in `pipeline.ts` only AFTER a dispute's own
 * rule already resolved to `auto`. It is therefore a **kill-switch**, not a
 * per-dispute decision — the per-dispute decision belongs to
 * `pickAutomationAction` (rule selection) and `evaluateAutoSubmitGuards`
 * (engine guards).
 *
 * Mirroring it 1:1 off the store switch was correct while the switch was the
 * only way to ask for automation. With group overrides it becomes fatal:
 * Store=Review + Fraud=Auto would resolve a fraud dispute to `auto` at tier-1,
 * reach the gate, and be blocked with "Auto-save is disabled for this store."
 * The feature would render perfectly and do nothing.
 *
 * So the flag now means **automation is enabled somewhere for this shop**:
 * `mode === "auto" || any group === "auto"`. Safe precisely because the gate is
 * not the authority — turning the kill-switch on for a Store=Review shop with
 * one auto group cannot auto-save anything else, since every other dispute
 * resolves to `review` and returns before the gate is ever reached. Pinned
 * end-to-end in lib/automation/__tests__/groupOverrideAutomation.test.ts.
 *
 * The two bugs the mirror originally closed still hold: the wizard's rule
 * writer never set the flag at all (auto-pilot silently inert), and it used to
 * be derived all-or-nothing from per-pack modes (one family on review disabled
 * auto-save for every family).
 *
 * DO NOT add a second surface that writes either of these. If you need to
 * change the store-wide mode, call `writeStoreAutomation`. Enforced by
 * tests/unit/singleAutoSaveWriter.test.ts.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { updateShopSettings } from "@/lib/automation/settings";
import { reconcileParkedAutoDisputes } from "@/lib/automation/reconcileParkedAutoDisputes";
import { normalizeMode } from "./normalizeMode";
import type { Rule } from "./types";
import {
  AUTOMATION_GROUPS,
  ALL_GROUP_RULE_NAMES,
  GROUP_RULE_PRIORITY,
  groupRuleName,
  parseGroupRuleName,
  type GroupOverrides,
} from "./automationGroups";
import {
  FALLBACK_RULE_NAME,
  SAFEGUARD_RULE_NAME,
  LEGACY_SAFEGUARD_RULE_NAME,
} from "./storeAutomationNames";

export {
  SETUP_RULE_PREFIX,
  FALLBACK_RULE_NAME,
  SAFEGUARD_RULE_NAME,
  /**
   * The name the embedded Automation page used to write its safeguard under.
   * Read + delete only — never written again.
   */
  LEGACY_SAFEGUARD_RULE_NAME,
  /**
   * Re-exported so server-side callers keep one import site. Client components
   * must import it from `./storeAutomationNames` directly — this module pulls
   * in the Supabase server client.
   */
  isSetupOwnedRuleName,
} from "./storeAutomationNames";

export const DEFAULT_SAFEGUARD_AMOUNT = 500;

const FALLBACK_PRIORITY = 100_000;
const SAFEGUARD_PRIORITY = 5;

export type StoreAutomationMode = "auto" | "review";

export interface StoreAutomationConfig {
  mode: StoreAutomationMode;
  safeguard: { enabled: boolean; amount: number };
  /**
   * Per-group overrides. REQUIRED (not optional) so no call site has to guess
   * between "the caller means no overrides" and "the caller didn't say".
   * A route that wants to preserve what's stored reads it first and passes it
   * back — see the PUT handler.
   */
  groups: GroupOverrides;
}

/**
 * Every row this module owns and may delete — canonical names plus every
 * group name, locked groups included. Deliberately an explicit list and NOT a
 * `.like("__dd_setup__:%")` prefix: a prefix delete would wipe the merchant's
 * group overrides every time they touched the switch or the safeguard.
 *
 * Legacy `__dd_setup__:pack:{uuid}` / `:coverage:{family}` rows are NOT in
 * this list and are therefore no longer self-healed here. That is deliberate:
 * converting them is a behaviour change (a shop can have `coverage:fraud=auto`
 * live today) and must not happen as a side effect of an unrelated safeguard
 * edit. A dedicated migration converts them once, then deletes them.
 */
const SETUP_OWNED_RULE_NAMES: readonly string[] = [
  FALLBACK_RULE_NAME,
  SAFEGUARD_RULE_NAME,
  LEGACY_SAFEGUARD_RULE_NAME,
  ...ALL_GROUP_RULE_NAMES,
];

/**
 * The `auto_save_enabled` value for a config — "automation is enabled
 * somewhere", per the module header. Exported so tests can derive the flag the
 * same way the writer does instead of hardcoding an expectation.
 */
export function deriveAutoSaveEnabled(config: {
  mode: StoreAutomationMode;
  groups: GroupOverrides;
}): boolean {
  return (
    config.mode === "auto" ||
    Object.values(config.groups).some((m) => m === "auto")
  );
}

function parseSafeguardAmount(rule: Pick<Rule, "match"> | null): number | null {
  const min = rule?.match?.amount_range?.min;
  if (typeof min !== "number" || !Number.isFinite(min) || min <= 0) return null;
  return min;
}

/**
 * Single read path. Derives the config from the setup-owned rows; never
 * guesses. A shop with no fallback row reads as `review` — the same default
 * `pickAutomationAction` applies when nothing matches, so an un-onboarded
 * shop and an explicitly-review shop behave identically.
 *
 * Tolerates a shop that still carries the legacy safeguard name (pre-migration
 * or mid-rollout): the canonical row wins, the legacy row is the fallback.
 */
export async function readStoreAutomation(
  shopId: string,
): Promise<StoreAutomationConfig> {
  const sb = getServiceClient();
  // An explicit name list, never a prefix LIKE: `_` is a LIKE wildcard and
  // every one of these names is mostly underscores.
  const { data, error } = await sb
    .from("rules")
    .select("id, name, enabled, match, action, priority")
    .eq("shop_id", shopId)
    .in("name", SETUP_OWNED_RULE_NAMES);

  if (error) throw new Error(`Failed to read store automation: ${error.message}`);

  const rows = (data ?? []) as Rule[];
  const fallback = rows.find((r) => r.name === FALLBACK_RULE_NAME) ?? null;
  const canonicalSafeguard = rows.find((r) => r.name === SAFEGUARD_RULE_NAME) ?? null;
  const legacySafeguard = rows.find((r) => r.name === LEGACY_SAFEGUARD_RULE_NAME) ?? null;
  const safeguardRow = canonicalSafeguard ?? legacySafeguard;

  const mode: StoreAutomationMode =
    fallback && fallback.enabled ? normalizeMode(fallback.action?.mode) : "review";

  const amount = parseSafeguardAmount(safeguardRow);
  const safeguardEnabled = Boolean(safeguardRow?.enabled) && amount !== null;

  const groups: GroupOverrides = {};
  for (const row of rows) {
    const id = parseGroupRuleName(row.name);
    if (!id || !row.enabled) continue;
    const group = AUTOMATION_GROUPS.find((g) => g.id === id);
    // A locked group's row is never surfaced even if one somehow exists: the
    // engine won't honour it, and a read that reports an override the engine
    // ignores is how a UI ends up lying.
    if (!group || group.locked) continue;
    groups[id] = normalizeMode(row.action?.mode);
  }

  return {
    mode,
    safeguard: {
      enabled: safeguardEnabled,
      amount: amount ?? DEFAULT_SAFEGUARD_AMOUNT,
    },
    groups,
  };
}

/**
 * Single write path. Idempotent delete-then-insert of ONLY the setup-owned
 * rows — merchant custom rules are never touched — then mirrors
 * `shop_settings.auto_save_enabled`.
 *
 * The delete deliberately covers the whole `__dd_setup__:` prefix (not just
 * the two canonical names) so a shop still carrying legacy `pack:` /
 * `coverage:` rows from the per-dispute-type era is self-healed on its next
 * write, even if it somehow missed the migration.
 */
export async function writeStoreAutomation(
  shopId: string,
  next: StoreAutomationConfig,
): Promise<StoreAutomationConfig> {
  const sb = getServiceClient();
  const mode = normalizeMode(next.mode);
  const amount = next.safeguard.amount;
  const safeguardEnabled =
    next.safeguard.enabled && Number.isFinite(amount) && amount > 0;

  const previous = await readStoreAutomation(shopId);

  // 1) Clear the rows this module owns — by NAME, never by prefix. The old
  //    `.like("__dd_setup__:%")` would delete the merchant's group overrides
  //    on every switch or safeguard save. One statement now covers the
  //    canonical names, every group name and the legacy safeguard.
  const { error: delSetupErr } = await sb
    .from("rules")
    .delete()
    .eq("shop_id", shopId)
    .in("name", SETUP_OWNED_RULE_NAMES);
  if (delSetupErr) {
    throw new Error(`Failed to clear setup rules: ${delSetupErr.message}`);
  }

  // 2) + 3) Insert the canonical rows.
  const rows: Array<Record<string, unknown>> = [
    {
      shop_id: shopId,
      enabled: true,
      name: FALLBACK_RULE_NAME,
      match: {},
      action: { mode, pack_template_id: null },
      priority: FALLBACK_PRIORITY,
    },
  ];
  if (safeguardEnabled) {
    rows.push({
      shop_id: shopId,
      enabled: true,
      name: SAFEGUARD_RULE_NAME,
      match: { amount_range: { min: amount } },
      // pack_template_id intentionally omitted — a tier-0 safeguard only
      // forces review mode; the template is resolved by reason_template_mappings.
      action: { mode: "review" },
      priority: SAFEGUARD_PRIORITY,
    });
  }

  // 4) One row per explicitly-set group. A group absent from the map inherits
  //    the switch and gets no row at all. A redundant pin (group == switch) IS
  //    written: the merchant asked for it explicitly, and it must survive a
  //    later switch flip.
  const groups: GroupOverrides = {};
  for (const group of AUTOMATION_GROUPS) {
    if (group.locked) continue; // never write a row the engine will ignore
    const groupMode = next.groups[group.id];
    if (groupMode !== "auto" && groupMode !== "review") continue;
    const normalized = normalizeMode(groupMode);
    groups[group.id] = normalized;
    rows.push({
      shop_id: shopId,
      enabled: true,
      name: groupRuleName(group.id),
      match: { reason: group.reasons },
      action: { mode: normalized, pack_template_id: null },
      priority: GROUP_RULE_PRIORITY,
    });
  }

  const { error: insErr } = await sb.from("rules").insert(rows);
  if (insErr) {
    throw new Error(`Failed to write store automation rules: ${insErr.message}`);
  }

  const result: StoreAutomationConfig = {
    mode,
    safeguard: {
      enabled: safeguardEnabled,
      amount: safeguardEnabled ? amount : DEFAULT_SAFEGUARD_AMOUNT,
    },
    groups,
  };

  // 5) Mirror the shop-level auto-save kill-switch: on when automation is
  //    enabled ANYWHERE — the store switch or any single group. Mirroring the
  //    switch alone would make Store=Review + Fraud=Auto inert (see the module
  //    header). `updateShopSettings` calls `ensure_shop_settings` first, so a
  //    brand-new shop gets a row instead of sitting on the column default of
  //    false with auto-pilot silently doing nothing.
  await updateShopSettings(shopId, {
    auto_save_enabled: deriveAutoSaveEnabled(result),
  });

  // 6) Already-built Strong drafts that parked under the previous setting may
  //    now be eligible. Two ways that happens: the switch moved to auto, or
  //    the safeguard stopped covering them (turned off, or raised). Fire the
  //    reconcile pass so they don't wait for a rebuild. Non-blocking and
  //    non-fatal — the save succeeds regardless. It re-applies every auto
  //    gate itself, so only genuinely eligible cases are promoted.
  const safeguardRelaxed =
    previous.safeguard.enabled &&
    (!result.safeguard.enabled || result.safeguard.amount > previous.safeguard.amount);
  // A group flipping to auto is the same kind of relaxation as the switch
  // flipping, and it must fire even while the store stays on review — that is
  // the entire point of an override. Over-firing is safe (the pass re-applies
  // every gate itself); under-firing strands built drafts.
  const groupRelaxed = AUTOMATION_GROUPS.some(
    (g) => result.groups[g.id] === "auto" && previous.groups[g.id] !== "auto",
  );
  if (
    (mode === "auto" && (previous.mode !== "auto" || safeguardRelaxed)) ||
    groupRelaxed
  ) {
    void reconcileParkedAutoDisputes(shopId).catch((err) => {
      console.error("[storeAutomation] reconcileParkedAutoDisputes failed", err);
    });
  }

  return result;
}

/**
 * Install-time default: auto-pilot ON with the high-value safeguard at $500.
 *
 * Idempotent — a shop that already has a fallback row (re-install, repeated
 * OAuth, a merchant who has since chosen "review everything") is left alone.
 * Without this guard a re-auth would silently reset a merchant's choice.
 */
export async function seedDefaultStoreAutomation(shopId: string): Promise<void> {
  const sb = getServiceClient();
  const { data: existing, error } = await sb
    .from("rules")
    .select("id")
    .eq("shop_id", shopId)
    .eq("name", FALLBACK_RULE_NAME)
    .maybeSingle();

  if (error) throw new Error(`Failed to check store automation: ${error.message}`);
  if (existing) return;

  await writeStoreAutomation(shopId, {
    mode: "auto",
    safeguard: { enabled: true, amount: DEFAULT_SAFEGUARD_AMOUNT },
    // Install default carries no overrides — everything inherits the switch.
    groups: {},
  });
}
