import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { emitDisputeEvent } from "@/lib/disputeEvents/emitEvent";
import { updateNormalizedStatus } from "@/lib/disputeEvents/updateNormalizedStatus";
import { ADMIN_OVERRIDE, ADMIN_OVERRIDE_CLEARED } from "@/lib/disputeEvents/eventTypes";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const OVERRIDABLE_FIELDS = new Set([
  "final_outcome", "submission_state", "submitted_at", "closed_at", "needs_attention",
]);

/**
 * POST /api/admin/disputes/:id/override
 *
 * Admin can correct snapshot fields on a dispute.
 * Body: { field, value, reason } or { field, action: "clear", reason }
 *
 * After override, calls updateNormalizedStatus to maintain snapshot consistency.
 * Records the override in overridden_fields and emits an event.
 *
 * Auth: Supabase JWT with role = 'admin'.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: disputeId } = await params;
  const sb = getServiceClient();

  // Verify admin role
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: { user } } = await sb.auth.getUser(authHeader.slice(7));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = (user.app_metadata as Record<string, unknown> | undefined)?.role;
  if (role !== "admin") {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  // Load dispute
  const { data: dispute } = await sb
    .from("disputes")
    .select("*")
    .eq("id", disputeId)
    .single();

  if (!dispute) {
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  }

  const body = await req.json();
  const { field, value, reason, action } = body;

  if (!field || !OVERRIDABLE_FIELDS.has(field)) {
    return NextResponse.json(
      { error: `Invalid field. Allowed: ${[...OVERRIDABLE_FIELDS].join(", ")}` },
      { status: 400 },
    );
  }

  if (!reason || typeof reason !== "string") {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }

  const row = dispute as Record<string, unknown>;
  const oldValue = row[field];
  const overriddenFields = (row.overridden_fields as Record<string, boolean>) ?? {};
  const now = new Date().toISOString();

  if (action === "clear") {
    // Clear override — remove from overridden_fields
    const updated = { ...overriddenFields };
    delete updated[field];
    const hasAny = Object.keys(updated).length > 0;

    await sb
      .from("disputes")
      .update({
        overridden_fields: updated,
        has_admin_override: hasAny,
      })
      .eq("id", disputeId);

    void emitDisputeEvent({
      disputeId,
      shopId: dispute.shop_id,
      eventType: ADMIN_OVERRIDE_CLEARED,
      description: `Override cleared for ${field}: ${reason}`,
      eventAt: now,
      actorType: "disputedesk_admin",
      actorRef: user.email ?? undefined,
      sourceType: "admin_override",
      visibility: "internal_only",
      metadataJson: { field, reason },
      dedupeKey: `${disputeId}:${ADMIN_OVERRIDE_CLEARED}:${field}:${now}`,
    });

    void updateNormalizedStatus(disputeId);

    return NextResponse.json({ cleared: field });
  }

  // Apply override
  const update: Record<string, unknown> = { [field]: value };

  // For final_outcome overrides, also set dependent fields
  if (field === "final_outcome") {
    const amount = Number(row.amount) || 0;
    const outcomeMap: Record<string, { recovered: number; lost: number }> = {
      won: { recovered: amount, lost: 0 },
      lost: { recovered: 0, lost: amount },
      refunded: { recovered: 0, lost: amount },
      accepted: { recovered: 0, lost: amount },
    };
    const financials = outcomeMap[String(value)] ?? { recovered: 0, lost: 0 };
    update.outcome_amount_recovered = financials.recovered;
    update.outcome_amount_lost = financials.lost;
    update.outcome_source = "admin_override";
    update.outcome_confidence = "manual";

    // Set closed_at if terminal and not already set
    const terminalOutcomes = ["won", "lost", "refunded", "accepted", "canceled", "expired"];
    if (terminalOutcomes.includes(String(value)) && !row.closed_at) {
      update.closed_at = now;
    }
  }

  // Record in overridden_fields
  const updatedOverrides = { ...overriddenFields, [field]: true };
  update.overridden_fields = updatedOverrides;
  update.has_admin_override = true;

  await sb.from("disputes").update(update).eq("id", disputeId);

  void emitDisputeEvent({
    disputeId,
    shopId: dispute.shop_id,
    eventType: ADMIN_OVERRIDE,
    description: `${field} overridden: ${String(oldValue)} → ${String(value)}. Reason: ${reason}`,
    eventAt: now,
    actorType: "disputedesk_admin",
    actorRef: user.email ?? undefined,
    sourceType: "admin_override",
    visibility: "internal_only",
    metadataJson: { field, old_value: oldValue, new_value: value, reason },
    dedupeKey: `${disputeId}:${ADMIN_OVERRIDE}:${field}:${now}`,
  });

  // Recalculate dependent snapshot fields
  void updateNormalizedStatus(disputeId);

  return NextResponse.json({ overridden: field, oldValue, newValue: value });
}
