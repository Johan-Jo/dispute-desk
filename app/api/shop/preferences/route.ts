import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import {
  extractShopId,
  extractShopIdFromBody,
} from "@/lib/middleware/extractShopId";

export interface NotificationPreferences {
  newDispute: boolean;
  beforeDue: boolean;
  evidenceReady: boolean;
  /** Monthly chargeback exposure digest. Opt-out (default true). The
   *  GET handler previously stripped this from the response even
   *  though the embedded settings page read it; fixed 2026-05-20. */
  monthlyDigest: boolean;
  /** Outcome-posted email — fires when Shopify reports the dispute
   *  closed (won / lost / accepted). Opt-out (default true). Added
   *  alongside the outcome email helper at
   *  lib/email/sendOutcomePostedAlert.ts. */
  outcome: boolean;
}

/** Merchant involvement preference (design-alignment plan §12S).
 *  Presentation-only: affects notification defaults and optional-
 *  opportunity prominence — NEVER objective lifecycle, attention
 *  classification, or dashboard-bucket truth. */
export type InvolvementPreference = "hands_off" | "stay_involved";

const DEFAULT_INVOLVEMENT: InvolvementPreference = "hands_off";

const DEFAULTS: NotificationPreferences = {
  newDispute: true,
  beforeDue: true,
  evidenceReady: false,
  monthlyDigest: true,
  outcome: true,
};

/**
 * GET /api/shop/preferences?shop_id=...
 * Returns notification preferences from setup state (team step payload).
 */
export async function GET(req: NextRequest) {
  const shopId = extractShopId(req);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();
  const { data } = await sb
    .from("shop_setup")
    .select("steps")
    .eq("shop_id", shopId)
    .single();

  const steps = (data?.steps ?? {}) as Record<
    string,
    { payload?: { notifications?: Partial<NotificationPreferences>; involvement?: InvolvementPreference } }
  >;
  const team = steps.team;
  const notifs = team?.payload?.notifications;
  const involvement: InvolvementPreference =
    team?.payload?.involvement === "stay_involved" ? "stay_involved" : DEFAULT_INVOLVEMENT;

  // Involvement-aware DEFAULTS (plan §12S — the approved involvement
  // behavior): progress-flavored notifications (evidence-package-ready,
  // monthly digest) default ON only in Stay-involved; an explicit
  // merchant choice always wins over the default. Critical alerts
  // (new dispute, deadline, outcome) stay default-on regardless.
  const stayInvolved = involvement === "stay_involved";
  const preferences: NotificationPreferences = {
    newDispute: notifs?.newDispute ?? DEFAULTS.newDispute,
    beforeDue: notifs?.beforeDue ?? DEFAULTS.beforeDue,
    evidenceReady: notifs?.evidenceReady ?? stayInvolved,
    monthlyDigest: notifs?.monthlyDigest ?? stayInvolved,
    outcome: notifs?.outcome ?? DEFAULTS.outcome,
  };

  const teamEmail = (team?.payload as Record<string, unknown>)?.teamEmail as string | undefined;

  return NextResponse.json({ notifications: preferences, teamEmail: teamEmail ?? "", involvement });
}

/**
 * PATCH /api/shop/preferences
 * Body: { shop_id, notifications: { newDispute?, beforeDue?, evidenceReady? } }
 * Merges into team step payload.
 */
export async function PATCH(req: NextRequest) {
  let body: {
    shop_id?: string;
    notifications?: Partial<NotificationPreferences>;
    teamEmail?: string;
    involvement?: InvolvementPreference;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shopId = extractShopIdFromBody(req, body);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const updates = body.notifications ?? {};
  const hasNotifUpdates = Object.keys(updates).length > 0;
  const hasEmailUpdate = body.teamEmail !== undefined;
  const hasInvolvementUpdate =
    body.involvement === "hands_off" || body.involvement === "stay_involved";
  if (!hasNotifUpdates && !hasEmailUpdate && !hasInvolvementUpdate) {
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
  // Involvement drives the progress-notification defaults (plan §12S):
  // switching involvement materializes evidenceReady + monthlyDigest to
  // match, so the settings UI, the email senders (which read the raw
  // stored payload with a send-unless-false default), and the digest
  // cron all agree. Explicit toggles sent in the SAME request win; the
  // merchant can re-toggle afterwards at any time.
  if (hasInvolvementUpdate) {
    const stayInvolved = body.involvement === "stay_involved";
    if (updates.evidenceReady === undefined) merged.evidenceReady = stayInvolved;
    if (updates.monthlyDigest === undefined) merged.monthlyDigest = stayInvolved;
  }

  const updatedPayload: Record<string, unknown> = { ...team.payload, notifications: merged };
  if (hasEmailUpdate) {
    updatedPayload.teamEmail = body.teamEmail;
  }
  if (hasInvolvementUpdate) {
    updatedPayload.involvement = body.involvement;
  }
  stepsMap.team = {
    ...team,
    payload: updatedPayload,
  };

  const { error } = await sb
    .from("shop_setup")
    .upsert(
      { shop_id: shopId, steps: stepsMap, updated_at: new Date().toISOString() },
      { onConflict: "shop_id" }
    );

  if (error) {
    console.error("[preferences] upsert failed:", error);
    return NextResponse.json({ error: "Failed to save preferences" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, notifications: merged });
}
