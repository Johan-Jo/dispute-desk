/**
 * GET|PUT /api/automation/store — the store-wide automation setting.
 *
 * The ONE route for the "Auto-pilot vs Review everything" switch and its
 * high-value safeguard. Replaces `POST /api/setup/automation` (per-pack
 * modes) and `POST /api/setup/coverage-rules` (per-family modes + a
 * second, differently-named safeguard), which between them let the same
 * concept be written from three UI surfaces into two backing stores.
 *
 * All persistence is delegated to `lib/rules/storeAutomation.ts` — this
 * route only does auth, validation, and the plan gate.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { checkFeatureAccess } from "@/lib/billing/checkQuota";
import { extractShopId } from "@/lib/middleware/extractShopId";
import {
  readStoreAutomation,
  writeStoreAutomation,
  type StoreAutomationMode,
} from "@/lib/rules/storeAutomation";

export const runtime = "nodejs";

/**
 * Shop-id resolution. `extractShopId` covers ?shop_id= and x-shop-id; the
 * embedded surfaces also carry a cookie, matching what the setup routes
 * this replaces accepted.
 */
function getShopId(req: NextRequest): string | null {
  return (
    extractShopId(req) ??
    req.cookies?.get?.("dd_active_shop")?.value ??
    req.cookies?.get?.("active_shop_id")?.value ??
    null
  );
}

async function getRulesAccess(shopId: string) {
  const sb = getServiceClient();
  const { data: shop } = await sb
    .from("shops")
    .select("plan")
    .eq("id", shopId)
    .single();
  return checkFeatureAccess(shop?.plan ?? "free", "rules");
}

export async function GET(req: NextRequest) {
  const shopId = getShopId(req);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  try {
    const [config, access] = await Promise.all([
      readStoreAutomation(shopId),
      getRulesAccess(shopId),
    ]);
    // `rulesAccess` describes merchant-authored CUSTOM RULES only — the
    // store-wide switch itself is never gated (see PUT). Returned as a flag
    // so the UI can disable the "Add rule" affordance without disabling the
    // switch.
    return NextResponse.json({
      ...config,
      rulesAccess: { allowed: access.allowed, reason: access.reason ?? null },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rec = (body ?? {}) as {
    shop_id?: string;
    mode?: string;
    safeguard?: { enabled?: boolean; amount?: number };
  };

  const shopId = rec.shop_id ?? getShopId(req);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  if (rec.mode !== "auto" && rec.mode !== "review") {
    return NextResponse.json(
      { error: "mode must be 'auto' or 'review'" },
      { status: 400 },
    );
  }
  const mode = rec.mode as StoreAutomationMode;

  const safeguardEnabled = rec.safeguard?.enabled === true;
  const rawAmount = rec.safeguard?.amount;
  if (safeguardEnabled) {
    if (typeof rawAmount !== "number" || !Number.isFinite(rawAmount) || rawAmount <= 0) {
      return NextResponse.json(
        { error: "safeguard.amount must be a positive number when enabled" },
        { status: 400 },
      );
    }
  }

  // NOT plan-gated (2026-07-28). The store-wide switch is core product, not
  // a premium rules feature: it decides whether we submit on the merchant's
  // behalf. Gating it left free-plan shops seeded auto-pilot at install with
  // NO way to require approval — a safety control they could never reach.
  // The gate still applies to merchant-authored custom rules
  // (POST /api/rules), which is what `checkFeatureAccess(plan, "rules")`
  // is actually for.

  try {
    const saved = await writeStoreAutomation(shopId, {
      mode,
      safeguard: {
        enabled: safeguardEnabled,
        amount: safeguardEnabled ? (rawAmount as number) : 0,
      },
    });
    return NextResponse.json({ ok: true, ...saved });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
