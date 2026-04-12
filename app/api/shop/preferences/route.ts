import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export interface NotificationPreferences {
  newDispute: boolean;
  beforeDue: boolean;
  evidenceReady: boolean;
}

const DEFAULTS: NotificationPreferences = {
  newDispute: true,
  beforeDue: true,
  evidenceReady: false,
};

function getShopId(req: NextRequest): string | null {
  const url = req.nextUrl ?? new URL(req.url);
  return (
    url.searchParams.get("shop_id") ??
    req.headers.get("x-shop-id") ??
    null
  );
}

/**
 * GET /api/shop/preferences?shop_id=...
 * Returns notification preferences from setup state (team step payload).
 */
export async function GET(req: NextRequest) {
  const shopId = getShopId(req);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();
  const { data } = await sb
    .from("shop_setup")
    .select("steps")
    .eq("shop_id", shopId)
    .single();

  const steps = (data?.steps ?? {}) as Record<string, { payload?: { notifications?: Partial<NotificationPreferences> } }>;
  const team = steps.team;
  const notifs = team?.payload?.notifications;

  const preferences: NotificationPreferences = {
    newDispute: notifs?.newDispute ?? DEFAULTS.newDispute,
    beforeDue: notifs?.beforeDue ?? DEFAULTS.beforeDue,
    evidenceReady: notifs?.evidenceReady ?? DEFAULTS.evidenceReady,
  };

  const teamEmail = (team?.payload as Record<string, unknown>)?.teamEmail as string | undefined;

  return NextResponse.json({ notifications: preferences, teamEmail: teamEmail ?? "" });
}

/**
 * PATCH /api/shop/preferences
 * Body: { shop_id, notifications: { newDispute?, beforeDue?, evidenceReady? } }
 * Merges into team step payload.
 */
export async function PATCH(req: NextRequest) {
  let body: { shop_id?: string; notifications?: Partial<NotificationPreferences>; teamEmail?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shopId = body.shop_id ?? req.headers.get("x-shop-id");
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const updates = body.notifications ?? {};
  const hasNotifUpdates = Object.keys(updates).length > 0;
  const hasEmailUpdate = body.teamEmail !== undefined;
  if (!hasNotifUpdates && !hasEmailUpdate) {
    return NextResponse.json({ ok: true });
  }

  const sb = getServiceClient();
  const { data: existing } = await sb
    .from("shop_setup")
    .select("steps")
    .eq("shop_id", shopId)
    .single();

  const stepsMap = (existing?.steps ?? {}) as Record<string, { status?: string; payload?: Record<string, unknown>; completed_at?: string }>;
  const team = stepsMap.team ?? { status: "todo", payload: {} };
  const currentNotifs = (team.payload?.notifications ?? DEFAULTS) as NotificationPreferences;
  const merged: NotificationPreferences = {
    ...currentNotifs,
    ...updates,
  };

  const updatedPayload: Record<string, unknown> = { ...team.payload, notifications: merged };
  if (hasEmailUpdate) {
    updatedPayload.teamEmail = body.teamEmail;
  }
  stepsMap.team = {
    ...team,
    payload: updatedPayload,
  };

  await sb
    .from("shop_setup")
    .upsert(
      { shop_id: shopId, steps: stepsMap, updated_at: new Date().toISOString() },
      { onConflict: "shop_id" }
    );

  return NextResponse.json({ ok: true, notifications: merged });
}
