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
  type ReturnRequestConfirmation,
  type ReturnScopeInput,
} from "@/lib/disputes/returnRequestConfirmation";
import { loadCustomerReturnRequest } from "@/lib/integrations/gorgias/internalNarrativeConstraints";

/**
 * Does the detected customer request outweigh the merchant's answer? Precedence
 * (read-time only):
 *   - the merchant said the customer DID ask ("request_received"): handled by its
 *     own reason in the verdict, so the detection adds nothing here;
 *   - the merchant said "no request received" AND answered AFTER the latest
 *     detected message: the merchant, who sees their own inbox, wins;
 *   - otherwise (no answer, "not sure", or an answer older than the message, or
 *     an answer time we cannot read): the detection stands. The safe direction
 *     is never to show a false "no return" claim.
 */
export function customerRequestStands(
  request: { requested: boolean; latestSentAt: string | null },
  confirmation: Pick<ReturnRequestConfirmation, "answer" | "answeredAt"> | null | undefined,
): boolean {
  if (!request.requested) return false;
  if (confirmation?.answer !== "no_request_received") return true;
  const answered = Date.parse(confirmation.answeredAt);
  const asked = request.latestSentAt ? Date.parse(request.latestSentAt) : NaN;
  if (!Number.isFinite(answered) || !Number.isFinite(asked)) return true;
  return !(answered > asked);
}

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
    const base = returnScopeFor(settings, confirmation);

    // READ-TIME signal: a customer asked to return it in the support inbox.
    // Selects only; absence or failure = no signal (never throws).
    const request = await loadCustomerReturnRequest(sb, { disputeId: args.disputeId, shopId: args.shopId });
    if (!customerRequestStands(request, confirmation)) return base;
    return { returnsOutsideShopify: false, answer: null, ...base, customerAskedInSupport: true };
  } catch (err) {
    console.warn(
      `[loadReturnScopeForPack] read failed for dispute ${args.disputeId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return undefined;
  }
}
