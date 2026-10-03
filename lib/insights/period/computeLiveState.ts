/**
 * "Right now": open disputes needing a response, responses with the bank, and
 * the nearest deadline. Live by definition — never part of a month record.
 * The page labels it "Right now"; an email stores it as "As of <send date>".
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { ACTIVE_NORMALIZED_STATUSES } from "@/lib/disputes/presentation/isActive";

/** Filed and waiting on the bank: nothing for the merchant to do. */
const AWAITING_BANK = new Set(["submitted_to_bank", "submitted", "submitted_to_shopify", "waiting_on_issuer"]);

export interface LiveState {
  needsAction: number;
  awaitingBank: number;
  /** The earliest due date among disputes needing action; null when none. */
  nearestDueAt: string | null;
}

export async function computeLiveState(sb: SupabaseClient, shopId: string): Promise<LiveState> {
  const rows: Array<{ normalized_status: string | null; due_at: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("disputes")
      .select("normalized_status, due_at")
      .eq("shop_id", shopId)
      .is("closed_at", null)
      .in("normalized_status", [...ACTIVE_NORMALIZED_STATUSES])
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`computeLiveState: ${error.message}`);
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 1000) break;
  }
  const waiting = rows.filter((r) => AWAITING_BANK.has(r.normalized_status ?? ""));
  const action = rows.filter((r) => !AWAITING_BANK.has(r.normalized_status ?? ""));
  const nowIso = new Date().toISOString();
  const due = action
    .map((r) => r.due_at)
    .filter((d): d is string => !!d && d >= nowIso)
    .sort();
  return { needsAction: action.length, awaitingBank: waiting.length, nearestDueAt: due[0] ?? null };
}
