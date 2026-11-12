/**
 * Load the candidates of the refund-state check: every open credit-not-processed inquiry with what the send
 * rule needs (payment method, opt-out, team email, locale, whether the email already went out, last read).
 * SELECTs only. Shared by the cron route and the read-only dry-run script.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { REFUND_ADVICE_REASON } from "@/lib/disputes/refundAdviceDecision";
import { loadRefundStateRows } from "@/lib/disputes/refundStateStore";
import type { RefundCheckCandidate } from "@/lib/disputes/refundStateCheck";
import { normalizeLocale } from "@/lib/i18n/locales";

export const MAX_CANDIDATES = 400;
const CHUNK = 100;

type Json = Record<string, unknown>;

export const refundAdviceEventKey = (disputeId: string, cycle: number) => `${disputeId}:REFUND_ADVICE:c${cycle}`;

/** `skipStates`: do not read `dispute_refund_state` (a read-only dry run before the table exists in that environment). */
export async function loadRefundCheckCandidates(
  sb: SupabaseClient,
  opts: { skipStates?: boolean } = {},
): Promise<RefundCheckCandidate[]> {
  const { data: disputes, error } = await sb
    .from("disputes")
    .select("id, shop_id, order_gid, order_name, phase, status, reason, amount, currency_code, due_at, response_cycle")
    .eq("phase", "inquiry")
    .eq("status", "needs_response")
    .eq("reason", REFUND_ADVICE_REASON)
    .not("order_gid", "is", null)
    .order("due_at", { ascending: true })
    .limit(MAX_CANDIDATES);
  if (error) throw new Error(`refund-check candidates: ${error.message}`);
  if (!disputes?.length) return [];


  const shopIds = [...new Set(disputes.map((d) => d.shop_id as string))];
  const disputeIds = disputes.map((d) => d.id as string);

  const [{ data: shops }, { data: setups }, states] = await Promise.all([
    sb.from("shops").select("id, shop_domain, locale").in("id", shopIds),
    sb.from("shop_setup").select("shop_id, steps").in("shop_id", shopIds),
    opts.skipStates ? Promise.resolve(new Map<string, { checked_at: string }>()) : loadRefundStateRows(sb, disputeIds),
  ]);
  const shopById = new Map((shops ?? []).map((s) => [s.id as string, s]));
  const setupByShop = new Map((setups ?? []).map((s) => [s.shop_id as string, (s.steps ?? {}) as Record<string, { payload?: Json }>]));

  // Payment method per order (shopify_orders), in chunks.
  const methodByKey = new Map<string, string | null>();
  for (const shopId of shopIds) {
    const gids = disputes.filter((d) => d.shop_id === shopId).map((d) => d.order_gid as string);
    for (let i = 0; i < gids.length; i += CHUNK) {
      const { data } = await sb
        .from("shopify_orders")
        .select("shopify_order_id, payment_method")
        .eq("shop_id", shopId)
        .in("shopify_order_id", gids.slice(i, i + CHUNK));
      for (const o of data ?? []) methodByKey.set(`${shopId}:${o.shopify_order_id}`, (o.payment_method as string | null) ?? null);
    }
  }

  // Which disputes already got the email for their current response cycle.
  const sentKeys = new Set<string>();
  for (let i = 0; i < disputeIds.length; i += CHUNK) {
    const { data } = await sb
      .from("audit_events")
      .select("dispute_event_key")
      .eq("event_type", "refund_advice_sent")
      .in("dispute_id", disputeIds.slice(i, i + CHUNK));
    for (const r of data ?? []) if (r.dispute_event_key) sentKeys.add(r.dispute_event_key as string);
  }

    const candidates: RefundCheckCandidate[] = disputes.map((d) => {
    const shop = shopById.get(d.shop_id as string);
    const steps = setupByShop.get(d.shop_id as string);
    const team = steps?.team?.payload as Json | undefined;
    const notifications = team?.notifications as { refundAdvice?: boolean } | undefined;
    const cycle = (d.response_cycle as number | null) ?? 1;
    const storeLocale = steps?.store_profile?.payload?.storeLocale as string | undefined;
    return {
      disputeId: d.id as string,
      shopId: d.shop_id as string,
      shopDomain: (shop?.shop_domain as string | null) ?? null,
      orderGid: d.order_gid as string,
      orderName: (d.order_name as string | null) ?? null,
      phase: d.phase as string | null,
      status: d.status as string | null,
      reason: d.reason as string | null,
      amount: Number(d.amount ?? 0),
      currencyCode: (d.currency_code as string | null) ?? "USD",
      dueAt: (d.due_at as string | null) ?? null,
      responseCycle: cycle,
      paymentMethod: methodByKey.get(`${d.shop_id}:${d.order_gid}`) ?? null,
      optedOut: notifications?.refundAdvice === false,
      teamEmail: (team?.teamEmail as string | undefined) ?? null,
      locale: normalizeLocale(storeLocale ?? (shop?.locale as string | null) ?? null) ?? null,
      alreadySent: sentKeys.has(refundAdviceEventKey(d.id as string, cycle)),
      lastCheckedAt: states.get(d.id as string)?.checked_at ?? null,
    };
  });

  // Oldest read first, never-read first.
  candidates.sort((a, b) => (a.lastCheckedAt ?? "").localeCompare(b.lastCheckedAt ?? ""));
  return candidates;
}
