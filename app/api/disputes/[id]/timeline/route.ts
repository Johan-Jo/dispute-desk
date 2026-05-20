import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";

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

  // Load dispute + verify it exists. Merchant calls must be scoped to the
  // requesting shop; internal admin/support calls are cross-shop by design.
  let disputeQuery = sb
    .from("disputes")
    .select("*")
    .eq("id", disputeId);
  if (!includeInternal) {
    const shopId = extractShopId(req);
    if (!shopId || shopId === "demo") {
      return NextResponse.json(
        { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
        { status: 401 },
      );
    }
    disputeQuery = disputeQuery.eq("shop_id", shopId);
  }
  const { data: row, error: dErr } = await disputeQuery.single();
  // Cast to untyped record — new columns aren't in generated Supabase types yet
  const dispute = row as Record<string, unknown> | null;

  if (dErr || !dispute) {
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  }

  const _shopId = dispute.shop_id as string;

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

  // Filter spurious due_date_changed rows. Historically syncDisputes
  // compared raw ISO strings, so a Shopify response with a non-UTC
  // offset (e.g. "…-04:00") produced a timeline event against our
  // stored UTC value for the same instant. The sync code now compares
  // by epoch ms, but the dispute_events table is append-only (enforced
  // by DB trigger) so the existing rows can't be deleted — we hide
  // them at the read boundary instead.
  const filteredEvents = (events ?? []).filter((e) => {
    if (e.event_type !== "due_date_changed") return true;
    const meta = (e.metadata_json ?? {}) as { old_due_at?: string; new_due_at?: string };
    if (!meta.old_due_at || !meta.new_due_at) return true;
    const oldMs = new Date(meta.old_due_at).getTime();
    const newMs = new Date(meta.new_due_at).getTime();
    if (!Number.isFinite(oldMs) || !Number.isFinite(newMs)) return true;
    return oldMs !== newMs;
  });

  // Merge audit_events of interest into the admin timeline so ops
  // reviewing a lost dispute can see merchant-driven overrides that
  // affected what reached the bank. Two event types surfaced today:
  //   - evidence_inclusion_overridden (routine include/exclude)
  //   - evidence_inclusion_overridden_with_warning (Phase 2
  //     acknowledged-risk override on an internal-only signal)
  // Both are admin-only — they're never relevant to merchants
  // reviewing their own dispute, and the with-warning variant is the
  // primary forensic signal when an unexpectedly weak narrative
  // gets to the bank.
  //
  // Projects each row into the same TimelineEvent shape the page
  // already renders, so the UI doesn't need to special-case them.
  // Merged events get visibility="internal_only" so they only ever
  // appear when includeInternal === true (gated above by the
  // admin/support role check).
  let mergedEvents = filteredEvents;
  if (includeInternal) {
    const { data: auditRows } = await sb
      .from("audit_events")
      .select("id, event_type, event_payload, actor_type, created_at, pack_id")
      .eq("dispute_id", disputeId)
      .in("event_type", [
        "evidence_inclusion_overridden",
        "evidence_inclusion_overridden_with_warning",
      ])
      .order("created_at", { ascending: false });

    type AuditEventRow = {
      id: string;
      event_type: string;
      event_payload: {
        field?: string;
        label?: string;
        action?: string;
        priorState?: string | null;
        riskAcknowledged?: boolean;
        modalShown?: string;
        confirmedAt?: string;
      } | null;
      actor_type: string | null;
      created_at: string;
      pack_id: string | null;
    };

    const projected = ((auditRows ?? []) as AuditEventRow[]).map((r) => {
      const p = r.event_payload ?? {};
      const field = typeof p.field === "string" ? p.field : "(unknown field)";
      const label = typeof p.label === "string" ? p.label : field;
      const action =
        typeof p.action === "string" ? p.action : "(unknown action)";
      const isAcknowledged = r.event_type === "evidence_inclusion_overridden_with_warning";
      const description = isAcknowledged
        ? `Merchant acknowledged risk and ${action === "force_include" ? "force-included" : action}d "${label}" (${field})`
        : `Merchant ${action === "clear" ? "cleared override on" : action === "force_include" ? "force-included" : action === "force_exclude" ? "excluded" : "toggled"} "${label}" (${field})`;
      return {
        id: `audit:${r.id}`,
        event_type: r.event_type,
        description,
        event_at: p.confirmedAt ?? r.created_at,
        actor_type: r.actor_type ?? "merchant",
        source_type: "audit",
        visibility: "internal_only",
        metadata_json: { ...p, pack_id: r.pack_id },
        dedupe_key: null,
      };
    });

    // Merge + sort desc by event_at (matches the dispute_events query
    // sort). String sort on ISO timestamps is correct order.
    mergedEvents = [...filteredEvents, ...projected].sort((a, b) =>
      (b.event_at ?? "").localeCompare(a.event_at ?? ""),
    );
  }

  const d = dispute;
  return NextResponse.json({
    events: mergedEvents,
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
