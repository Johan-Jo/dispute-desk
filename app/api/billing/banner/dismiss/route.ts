/**
 * POST /api/billing/banner/dismiss?shop_id=...
 *
 * Body: { variant: "grace" | "low_credits", cycleEnd: string }
 *
 * Records that the merchant dismissed a billing banner for the current
 * cycle. The next time the cycle rolls over (i.e. cycleEnd changes),
 * the banner re-appears — this is intentional per PRD §4.2: a new
 * billing cycle is a fresh signal even if the merchant said "got it"
 * last month.
 *
 * The sticky `subscription_expired` variant cannot be dismissed —
 * attempts return 400.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { getServiceClient } from "@/lib/supabase/server";
import { DISMISSAL_COLUMN } from "@/lib/billing/bannerState";

export const runtime = "nodejs";

type DismissibleVariant = keyof typeof DISMISSAL_COLUMN;

function isDismissibleVariant(v: unknown): v is DismissibleVariant {
  return v === "grace" || v === "low_credits";
}

export async function POST(req: NextRequest) {
  const shopId = extractShopId(req);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  let body: { variant?: unknown; cycleEnd?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const variant = body.variant;
  const cycleEnd = typeof body.cycleEnd === "string" ? body.cycleEnd : null;

  if (!isDismissibleVariant(variant)) {
    return NextResponse.json(
      { error: "variant must be 'grace' or 'low_credits'" },
      { status: 400 },
    );
  }
  if (!cycleEnd) {
    return NextResponse.json(
      { error: "cycleEnd required" },
      { status: 400 },
    );
  }

  const column = DISMISSAL_COLUMN[variant];

  const sb = getServiceClient();
  const { error } = await sb
    .from("plan_entitlements")
    .update({ [column]: cycleEnd, updated_at: new Date().toISOString() })
    .eq("shop_id", shopId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await sb.from("audit_events").insert({
    shop_id: shopId,
    actor_type: "merchant",
    event_type: "billing_banner_dismissed",
    event_payload: { variant, cycle_end: cycleEnd },
  });

  return NextResponse.json({ ok: true });
}
