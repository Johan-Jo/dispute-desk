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
import { findGroup, type GroupOverrides } from "@/lib/rules/automationGroups";

export const runtime = "nodejs";

/**
 * Setup-originated writes skip the plan gate. A free-plan merchant must be
 * able to choose their handling mode during onboarding — they are already
 * seeded auto-pilot at install, so gating the wizard would only produce a
 * dead-end first-run screen without protecting anything. Post-onboarding
 * edits on /app/rules and merchant-authored custom rules stay gated.
 */
const SETUP_EXEMPT_HEADER = "x-dd-setup";

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
    // Plan access is returned as a FLAG, not a 403 — the UI needs to render
    // the current setting (read-only + upgrade prompt) rather than fail.
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
    groups?: Record<string, unknown>;
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

  // `groups` semantics — OMISSION PRESERVES.
  //
  //   omitted    → keep whatever is stored (partial update)
  //   { ... }    → replace the override set wholesale
  //   {}         → explicitly clear all overrides
  //
  // Without this every caller that doesn't render groups (the setup wizard,
  // the Settings save-mode radio) would have to round-trip state it knows
  // nothing about, and forgetting to would silently delete a merchant's
  // overrides. A store-mode update must not mean "replace the entire
  // automation configuration".
  let groups: GroupOverrides | undefined;
  if (rec.groups !== undefined) {
    if (typeof rec.groups !== "object" || rec.groups === null || Array.isArray(rec.groups)) {
      return NextResponse.json({ error: "groups must be an object" }, { status: 400 });
    }
    const validated: GroupOverrides = {};
    for (const [key, value] of Object.entries(rec.groups)) {
      const group = findGroup(key);
      // A typo'd group id is loud, not silently dropped — a silent drop reads
      // to the merchant as "saved" while nothing changed.
      if (!group) {
        return NextResponse.json({ error: `unknown group '${key}'` }, { status: 400 });
      }
      if (group.locked) {
        // Server-side enforcement of the engine lock. Without it a
        // hand-crafted PUT writes a row that permanently lies to the UI.
        return NextResponse.json(
          { error: `group '${key}' cannot be automated` },
          { status: 400 },
        );
      }
      if (value !== "auto" && value !== "review") {
        return NextResponse.json(
          { error: `group '${key}' must be 'auto' or 'review'` },
          { status: 400 },
        );
      }
      validated[group.id] = value;
    }
    groups = validated;
  }

  const isSetupWrite = req.headers.get(SETUP_EXEMPT_HEADER) === "1";
  if (!isSetupWrite) {
    const access = await getRulesAccess(shopId);
    if (!access.allowed) {
      return NextResponse.json(
        { error: access.reason, upgrade_required: true },
        { status: 403 },
      );
    }
  }

  try {
    // Omission preserves: read what's stored and pass it straight back, so a
    // mode-only write leaves the overrides exactly as they were.
    const effectiveGroups =
      groups ?? (await readStoreAutomation(shopId)).groups;

    const saved = await writeStoreAutomation(shopId, {
      mode,
      safeguard: {
        enabled: safeguardEnabled,
        amount: safeguardEnabled ? (rawAmount as number) : 0,
      },
      groups: effectiveGroups,
    });
    return NextResponse.json({ ok: true, ...saved });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
