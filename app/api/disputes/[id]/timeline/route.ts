import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/disputes/:id/timeline
 *
 * Returns the dispute event timeline and status summary.
 *
 * Visibility:
 * - Merchant requests (default): only `merchant_and_internal` events.
 * - Admin/support: requires a verified Supabase auth session with
 *   `role = 'admin'` or `role = 'support'` in app_metadata. Only then
 *   are `internal_only` events included.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: disputeId } = await params;
  const sb = getServiceClient();

  // Load dispute + verify it exists
  const { data: row, error: dErr } = await sb
    .from("disputes")
    .select("*")
    .eq("id", disputeId)
    .single();
  // Cast to untyped record — new columns aren't in generated Supabase types yet
  const dispute = row as Record<string, unknown> | null;

  if (dErr || !dispute) {
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  }

  const _shopId = dispute.shop_id as string;

  // Determine visibility filter — internal events require verified admin/support role
  let includeInternal = false;
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const { data: { user } } = await sb.auth.getUser(token);
    const role = (user?.app_metadata as Record<string, unknown> | undefined)?.role;
    if (role === "admin" || role === "support") {
      includeInternal = true;
    }
  }

  // Fetch events
  let query = sb
    .from("dispute_events")
    .select("*")
    .eq("dispute_id", disputeId)
    .order("event_at", { ascending: false });

  if (!includeInternal) {
    query = query.eq("visibility", "merchant_and_internal");
  }

  const { data: events, error: evErr } = await query;

  if (evErr) {
    return NextResponse.json({ error: evErr.message }, { status: 500 });
  }

  const d = dispute;
  return NextResponse.json({
    events: events ?? [],
    summary: {
      normalizedStatus: d.normalized_status ?? null,
      statusReason: d.status_reason ?? null,
      submissionState: d.submission_state ?? "not_saved",
      nextAction: d.next_action_type
        ? { type: d.next_action_type, text: d.next_action_text }
        : null,
      submittedAt: d.submitted_at ?? null,
      closedAt: d.closed_at ?? null,
      finalOutcome: d.final_outcome ?? null,
      outcomeAmountRecovered: d.outcome_amount_recovered ?? null,
      outcomeAmountLost: d.outcome_amount_lost ?? null,
      evidenceSavedAt: d.evidence_saved_to_shopify_at ?? null,
      amount: d.amount ?? null,
      currencyCode: d.currency_code ?? null,
      reason: d.reason ?? null,
      phase: d.phase ?? null,
      dueAt: d.due_at ?? null,
      needsReview: d.needs_review ?? false,
      needsAttention: d.needs_attention ?? false,
      syncHealth: d.sync_health ?? "ok",
    },
  });
}
