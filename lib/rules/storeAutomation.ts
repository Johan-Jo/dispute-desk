/**
 * storeAutomation — the ONE read/write path for a shop's store-wide
 * automation setting.
 *
 * ## The model
 *
 * Setup owns exactly TWO rows in `rules`:
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
 * ## The auto_save_enabled mirror
 *
 * `shop_settings.auto_save_enabled` is a strict 1:1 mirror of the switch,
 * written here on every save. It used to be derived all-or-nothing from
 * per-pack modes, so one family on "review" silently disabled auto-save for
 * every family; and the setup wizard's rule writer never set it at all, so a
 * merchant who chose all-auto during onboarding still hit a false gate and
 * nothing ever auto-saved. Both bugs are structurally impossible now: there
 * is one writer and it always mirrors.
 *
 * DO NOT add a second surface that writes either of these. If you need to
 * change the store-wide mode, call `writeStoreAutomation`.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { updateShopSettings } from "@/lib/automation/settings";
import { reconcileParkedAutoDisputes } from "@/lib/automation/reconcileParkedAutoDisputes";
import { normalizeMode } from "./normalizeMode";
import type { Rule } from "./types";

export const SETUP_RULE_PREFIX = "__dd_setup__:";
export const FALLBACK_RULE_NAME = `${SETUP_RULE_PREFIX}fallback:default`;
export const SAFEGUARD_RULE_NAME = `${SETUP_RULE_PREFIX}safeguard:high_value`;

/**
 * The name the embedded Automation page used to write its safeguard under.
 * Read + delete only — never written again. A shop that still has one gets
 * it cleaned up on the next write (self-healing), and the migration
 * `20260727120000_collapse_setup_rules_to_store_switch.sql` unifies the rest.
 */
export const LEGACY_SAFEGUARD_RULE_NAME = "__dd_safeguard__:high_value";

export const DEFAULT_SAFEGUARD_AMOUNT = 500;

/* Priorities live in the write_store_automation RPC (migration
   20260728120100) — the single writer. Kept here only as documentation:
   fallback = 100000 (tier-2 catch-all), safeguard = 5 (tier-0 amount rule). */

export type StoreAutomationMode = "auto" | "review";

export interface StoreAutomationConfig {
  mode: StoreAutomationMode;
  safeguard: { enabled: boolean; amount: number };
}

/** True for any rule this module owns (and therefore may delete). */
export function isSetupOwnedRuleName(name: string | null | undefined): boolean {
  if (!name) return false;
  return name.startsWith(SETUP_RULE_PREFIX) || name === LEGACY_SAFEGUARD_RULE_NAME;
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
  const { data, error } = await sb
    .from("rules")
    .select("id, name, enabled, match, action, priority")
    .eq("shop_id", shopId)
    .in("name", [FALLBACK_RULE_NAME, SAFEGUARD_RULE_NAME, LEGACY_SAFEGUARD_RULE_NAME]);

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

  return {
    mode,
    safeguard: {
      enabled: safeguardEnabled,
      amount: amount ?? DEFAULT_SAFEGUARD_AMOUNT,
    },
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

  // 1-4) Atomic swap of the two setup-owned rows. Previously this was three
  // separate round-trips (delete, delete, insert) with no transaction: a
  // crash between them left the shop with NO rules — every dispute silently
  // falling to review while `auto_save_enabled` kept its old value — and two
  // concurrent writes could interleave into duplicate fallback rows. The RPC
  // takes a row lock and does the whole swap in one transaction.
  const { error: rpcErr } = await sb.rpc("write_store_automation", {
    p_shop_id: shopId,
    p_mode: mode,
    p_safeguard_enabled: safeguardEnabled,
    p_safeguard_amount: safeguardEnabled ? amount : null,
  });
  if (rpcErr) {
    throw new Error(`Failed to write store automation: ${rpcErr.message}`);
  }

  // 5) Mirror the shop-level auto-save gate. `updateShopSettings` calls
  //    `ensure_shop_settings` first, so a shop with no settings row yet gets
  //    one — without that, a brand-new shop's `auto_save_enabled` would stay
  //    at the column default of false and auto-pilot would silently do nothing.
  await updateShopSettings(shopId, { auto_save_enabled: mode === "auto" });

  const result: StoreAutomationConfig = {
    mode,
    safeguard: {
      enabled: safeguardEnabled,
      amount: safeguardEnabled ? amount : DEFAULT_SAFEGUARD_AMOUNT,
    },
  };

  // 6) Already-built Strong drafts that parked under the previous setting may
  //    now be eligible. Two ways that happens: the switch moved to auto, or
  //    the safeguard stopped covering them (turned off, or raised). Fire the
  //    reconcile pass so they don't wait for a rebuild. Non-blocking and
  //    non-fatal — the save succeeds regardless. It re-applies every auto
  //    gate itself, so only genuinely eligible cases are promoted.
  const safeguardRelaxed =
    previous.safeguard.enabled &&
    (!result.safeguard.enabled || result.safeguard.amount > previous.safeguard.amount);
  if (mode === "auto" && (previous.mode !== "auto" || safeguardRelaxed)) {
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
  });
}
