import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { calculateCaseStrength } from "@/lib/argument/caseStrength";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";

/**
 * GET /api/disputes
 *
 * Query params:
 *   shop_id (required) — filter by shop
 *   status — comma-separated Shopify statuses: needs_response,under_review,won,lost
 *   phase — inquiry | chargeback
 *   needs_review — true | false
 *   due_before — ISO date
 *   normalized_status — comma-separated: new,in_progress,needs_review,ready_to_submit,action_needed,submitted,submitted_to_shopify,waiting_on_issuer,submitted_to_bank,won,lost,accepted_not_contested,closed_other
 *   final_outcome — comma-separated: won,lost,partially_won,accepted,refunded,canceled,expired,closed_other,unknown
 *   submission_state — comma-separated: not_saved,saved_to_shopify,submitted_confirmed,submission_uncertain,manual_submission_reported
 *   closed — true | false (filters on closed_at IS NOT NULL / IS NULL)
 *   date_field — initiated_at (default) | submitted_at | closed_at
 *   date_from — ISO date, filter >= date_field
 *   date_to — ISO date, filter <= date_field
 *   amount_min — numeric, filter >= amount
 *   amount_max — numeric, filter <= amount
 *   sort — due_at (default) | initiated_at | closed_at | submitted_at | amount
 *   sort_dir — asc (default) | desc
 *   page — 1-indexed (default 1)
 *   per_page — 1-100 (default 25)
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const shopId = sp.get("shop_id") ?? req.headers.get("x-shop-id");

  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();

  // Sorting
  const ALLOWED_SORT = ["due_at", "initiated_at", "closed_at", "submitted_at", "amount", "created_at"];
  const sortCol = ALLOWED_SORT.includes(sp.get("sort") ?? "") ? sp.get("sort")! : "due_at";
  const sortAsc = sp.get("sort_dir") !== "desc";

  let query = sb
    .from("disputes")
    .select("*", { count: "exact" })
    .eq("shop_id", shopId)
    .order(sortCol, { ascending: sortAsc, nullsFirst: false })
    .order("created_at", { ascending: false });

  // Legacy filters
  const phaseFilter = sp.get("phase");
  if (phaseFilter) {
    query = query.eq("phase", phaseFilter);
  }

  const statusFilter = sp.get("status");
  if (statusFilter) {
    const statuses = statusFilter.split(",").map((s) => s.trim());
    query = query.in("status", statuses);
  }

  const needsReview = sp.get("needs_review");
  if (needsReview === "true") {
    query = query.eq("needs_review", true);
  } else if (needsReview === "false") {
    query = query.eq("needs_review", false);
  }

  const dueBefore = sp.get("due_before");
  if (dueBefore) {
    query = query.lte("due_at", dueBefore);
  }

  // Normalized status filter
  const normalizedStatus = sp.get("normalized_status");
  if (normalizedStatus) {
    query = query.in("normalized_status", normalizedStatus.split(",").map((s) => s.trim()));
  }

  // Final outcome filter
  const finalOutcome = sp.get("final_outcome");
  if (finalOutcome) {
    query = query.in("final_outcome", finalOutcome.split(",").map((s) => s.trim()));
  }

  // Submission state filter
  const submissionState = sp.get("submission_state");
  if (submissionState) {
    query = query.in("submission_state", submissionState.split(",").map((s) => s.trim()));
  }

  // Closed filter
  const closed = sp.get("closed");
  if (closed === "true") {
    query = query.not("closed_at", "is", null);
  } else if (closed === "false") {
    query = query.is("closed_at", null);
  }

  // Date range filter
  const ALLOWED_DATE_FIELDS = ["initiated_at", "submitted_at", "closed_at"];
  const dateField = ALLOWED_DATE_FIELDS.includes(sp.get("date_field") ?? "") ? sp.get("date_field")! : "initiated_at";
  const dateFrom = sp.get("date_from");
  const dateTo = sp.get("date_to");
  if (dateFrom) {
    query = query.gte(dateField, dateFrom);
  }
  if (dateTo) {
    query = query.lte(dateField, dateTo);
  }

  // Amount range filter
  const amountMin = sp.get("amount_min");
  const amountMax = sp.get("amount_max");
  if (amountMin) {
    query = query.gte("amount", parseFloat(amountMin));
  }
  if (amountMax) {
    query = query.lte("amount", parseFloat(amountMax));
  }

  // Pagination
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const perPage = Math.min(100, Math.max(1, parseInt(sp.get("per_page") ?? "25", 10)));
  const from = (page - 1) * perPage;
  query = query.range(from, from + perPage - 1);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Merge `caseStrength` from each dispute's latest non-failed pack so the
  // list page can render the strength pill + "{N} strong signals" subtitle
  // without a per-row N+1. Done in JS rather than via a Supabase
  // relationship because we need a LEFT JOIN to a *single, latest* row per
  // dispute and the JS client doesn't expose LATERAL. Bounded by per_page
  // (≤ 100). Disputes without a completed pack come back as `null` and the
  // UI renders an em-dash.
  const disputeIds = (data ?? []).map((d) => d.id);
  const reasonByDisputeId = new Map<string, string | null>();
  for (const d of data ?? []) reasonByDisputeId.set(d.id, d.reason ?? null);
  const strengthByDispute = new Map<
    string,
    {
      overall: string;
      strongCount: number;
      moderateCount: number;
      supportingCount: number;
    }
  >();
  if (disputeIds.length > 0) {
    const { data: packs } = await sb
      .from("evidence_packs")
      .select("dispute_id, pack_json, checklist_v2, status, created_at")
      .in("dispute_id", disputeIds)
      .not("status", "in", "(failed,queued,building)")
      .order("created_at", { ascending: false });

    for (const p of packs ?? []) {
      // First row per dispute wins (sorted desc by created_at).
      if (!p.dispute_id || strengthByDispute.has(p.dispute_id)) continue;

      const cs = (p.pack_json as { case_strength?: unknown } | null)
        ?.case_strength as
        | {
            overall?: string;
            strongCount?: number;
            moderateCount?: number;
            supportingCount?: number;
          }
        | undefined;

      if (cs?.overall) {
        strengthByDispute.set(p.dispute_id, {
          overall: cs.overall,
          strongCount: cs.strongCount ?? 0,
          moderateCount: cs.moderateCount ?? 0,
          supportingCount: cs.supportingCount ?? 0,
        });
        continue;
      }

      // Fallback: pack predates the 2026-04-26 case_strength persist
      // (commit 24235cc). Recompute on the fly from checklist_v2 +
      // reason. No payload source → conditional fields collapse to
      // their best-case default per the canonical registry; this is
      // the same approximation we use anywhere else case strength is
      // computed without pack payloads. A separate backfill script
      // updates pack_json so subsequent reads skip this branch.
      const checklist = (p.checklist_v2 ?? []) as ChecklistItemV2[];
      if (checklist.length > 0) {
        try {
          const reason = reasonByDisputeId.get(p.dispute_id) ?? null;
          const result = calculateCaseStrength(null, checklist, reason);
          strengthByDispute.set(p.dispute_id, {
            overall: result.overall,
            strongCount: result.strongCount,
            moderateCount: result.moderateCount,
            supportingCount: result.supportingCount,
          });
        } catch {
          // If the engine throws on a malformed legacy checklist, leave
          // the dispute as caseStrength: null. UI shows em-dash.
        }
      }
    }
  }

  const disputesWithStrength = (data ?? []).map((d) => ({
    ...d,
    caseStrength: strengthByDispute.get(d.id) ?? null,
  }));

  return NextResponse.json({
    disputes: disputesWithStrength,
    pagination: {
      page,
      per_page: perPage,
      total: count ?? 0,
      total_pages: count ? Math.ceil(count / perPage) : 0,
    },
  });
}
