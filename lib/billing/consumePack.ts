import { getServiceClient } from "@/lib/supabase/server";

export interface ConsumePackResult {
  ok: boolean;
  consumed: number;
  remaining: number;
}

export class PackLimitReachedError extends Error {
  code = "PACK_LIMIT_REACHED" as const;
  remaining: number;
  shopId: string;

  constructor(shopId: string, remaining: number) {
    super("Pack limit reached. Upgrade your plan or purchase a top-up.");
    this.shopId = shopId;
    this.remaining = remaining;
  }
}

/**
 * Consume one pack credit. Called only on finalize/export/submit — NOT on drafts.
 * Idempotent per (shopId, disputeId, eventType).
 */
export async function consumePack(params: {
  shopId: string;
  disputeId: string;
  packId?: string;
  eventType: "finalize" | "export" | "submit";
}): Promise<ConsumePackResult> {
  const { shopId, disputeId, packId, eventType } = params;
  const sb = getServiceClient();

  const { data: existing } = await sb
    .from("pack_usage_events")
    .select("id")
    .eq("shop_id", shopId)
    .eq("dispute_id", disputeId)
    .eq("event_type", eventType)
    .maybeSingle();

  if (existing) {
    const balance = await getBalance(shopId);
    return { ok: true, consumed: 0, remaining: balance };
  }

  const balance = await getBalance(shopId);
  if (balance < 1) {
    throw new PackLimitReachedError(shopId, balance);
  }

  await sb.from("pack_usage_events").insert({
    shop_id: shopId,
    dispute_id: disputeId,
    pack_id: packId ?? null,
    event_type: eventType,
    packs: 1,
  });

  return { ok: true, consumed: 1, remaining: balance - 1 };
}

/**
 * Get remaining pack balance for a shop.
 */
export async function getBalance(shopId: string): Promise<number> {
  const sb = getServiceClient();

  const { data } = await sb
    .from("pack_balance")
    .select("remaining_packs")
    .eq("shop_id", shopId)
    .maybeSingle();

  return data?.remaining_packs ?? 0;
}

/**
 * Grant pack credits to a shop.
 */
export async function grantCredits(params: {
  shopId: string;
  source: "free_lifetime" | "trial" | "monthly_included" | "topup" | "admin_adjustment";
  packs: number;
  expiresAt?: string | null;
  reference?: string | null;
}): Promise<void> {
  const sb = getServiceClient();
  await sb.from("pack_credits_ledger").insert({
    shop_id: params.shopId,
    source: params.source,
    packs: params.packs,
    expires_at: params.expiresAt ?? null,
    reference: params.reference ?? null,
  });
}
