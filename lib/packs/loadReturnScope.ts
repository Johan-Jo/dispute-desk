/**
 * The returns context for a READ of a stored pack: the shop's setting plus the
 * merchant's answer for the PACK's response cycle (never the dispute's current
 * one: a pack built in cycle 1 is judged by cycle-1 answers, and an answer
 * recorded for another cycle is ignored).
 *
 * Mirrors the build-time read in `buildPack.ts`: the answer is read only when
 * the setting is on, and any failure reads as "setting off" (the Shopify record
 * keeps its weight) — never a thrown error on a merchant page.
 *
 * READ-ONLY: this runs on presentation paths (workspace, pack API, the decided
 * loader on the webhook path). It must never go through `getShopSettings`, whose
 * `ensure_shop_settings` RPC inserts a defaults row for a shop that has none.
 * A shop with no settings row is "setting off", the established default
 * (`shop_settings.returns_outside_shopify` defaults to false). Build time is
 * unchanged and keeps `getShopSettings`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadReturnRequestConfirmation,
  returnScopeFor,
  type ReturnScopeInput,
} from "@/lib/disputes/returnRequestConfirmation";

export async function loadReturnScopeForPack(
  sb: SupabaseClient,
  args: { shopId: string; disputeId: string; packCycle: number | null | undefined },
): Promise<ReturnScopeInput | undefined> {
  try {
    const { data, error } = await sb
      .from("shop_settings")
      .select("returns_outside_shopify")
      .eq("shop_id", args.shopId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const settings = { returns_outside_shopify: data?.returns_outside_shopify === true };
    const confirmation = settings.returns_outside_shopify
      ? await loadReturnRequestConfirmation(sb, args.disputeId, args.packCycle ?? 1)
      : null;
    return returnScopeFor(settings, confirmation);
  } catch (err) {
    console.warn(
      `[loadReturnScopeForPack] read failed for dispute ${args.disputeId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return undefined;
  }
}
