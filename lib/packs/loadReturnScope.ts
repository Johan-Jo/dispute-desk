/**
 * The returns context for a READ of a stored pack: the shop's setting plus the
 * merchant's answer for the PACK's response cycle (never the dispute's current
 * one: a pack built in cycle 1 is judged by cycle-1 answers, and an answer
 * recorded for another cycle is ignored).
 *
 * Mirrors the build-time read in `buildPack.ts`: the answer is read only when
 * the setting is on, and any failure reads as "setting off" (the Shopify record
 * keeps its weight) — never a thrown error on a merchant page.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getShopSettings } from "@/lib/automation/settings";
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
    const settings = await getShopSettings(args.shopId);
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
