import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
/* The scorer, the gate builder and the name-mismatch detector are GONE from
 * this route (CP-A). It rendered a strength it computed itself, from a gate
 * set that was missing three of five gates because the list query never loads
 * the Shopify order — so its answer had to differ from the detail page's
 * whenever coverage, fatal-loss or risk-weakness fired. It now projects what
 * the build path persisted and computes nothing. */
import { extractShopId } from "@/lib/middleware/extractShopId";
import { ASSESSMENT_POLICY_VERSION } from "@/lib/evidence/model/assessmentSnapshot";
import {
  gatherPresentations,
  type DisputeRowFacts,
} from "@/lib/disputes/presentation/serverFacts";
import type { I18nToken } from "@/lib/i18n/token";
import { isActiveNormalizedStatus } from "@/lib/disputes/presentation/isActive";
import { isDormantInquiry } from "@/lib/disputes/dormantInquiry";

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
  const shopId = extractShopId(req);

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
    .eq("shop_id", shopId);

  // Due-date ("urgency") sort ranks OPEN disputes before resolved ones.
  // Resolved disputes keep their historical due_at (e.g. a 2018 chargeback),
  // so a plain `due_at asc` floated long-closed rows above cases due this
  // week (blume-box, 2026-07-22). closed_at IS NULL ⇒ open, and
  // nullsFirst puts those first; resolved rows follow (most recently
  // closed first), each group still due-date-ordered by the later keys.
  //
  // Within the open group, `urgency_rank` (generated column, migration
  // 20260722030000) then demotes submitted / under-review disputes: they
  // are open but out of the merchant's hands, and their historical due_at
  // otherwise pins them to the top of the urgency view (blume-box,
  // 2026-07-22). Order: actionable open → submitted open → resolved.
  if (sortCol === "due_at" && sortAsc) {
    query = query
      .order("closed_at", { ascending: false, nullsFirst: true })
      .order("urgency_rank", { ascending: true });
  }
  query = query
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

  // ── Shop-wide presentation scan (plan §5.1 aggregates + §11 attention
  //    filter) ─────────────────────────────────────────────────────────
  // ONE resolver pass over the shop's disputes produces: the KPI
  // aggregates, the merchant-task id set (banner/aggregate), AND the
  // `?attention=` filter — so the dashboard banner's promise, the list
  // filter's result set, and the KPI count can never disagree (the
  // dual-source class the plan kills). The scan includes the
  // approval-gate and merchant-reconnect tasks the old
  // attention_reason-only filter missed.
  const { data: shopRows } = await sb
    .from("disputes")
    .select(
      "id, shop_id, reason, status, amount, currency_code, phase, normalized_status, submission_state, final_outcome, closed_at, due_at, initiated_at, needs_attention, attention_reason, attention_payload",
    )
    .eq("shop_id", shopId);
  const nonTerminalRows = (shopRows ?? []).filter(
    (r) => r.closed_at == null && r.final_outcome == null,
  );
  const shopPresentations = await gatherPresentations(
    sb,
    shopId,
    nonTerminalRows as unknown as DisputeRowFacts[],
    { includeConcreteContribution: false },
  );
  const taskIds: string[] = [];
  const commIds: string[] = [];
  for (const r of nonTerminalRows) {
    const p = shopPresentations.get(r.id as string);
    if (!p) continue;
    if (p.needsMerchantAction) taskIds.push(r.id as string);
    if (p.attention === "requested") commIds.push(r.id as string);
  }

  // Merchant-attention filter (plan §11): independent of the lifecycle
  // and strength dimensions.
  //   attention=tasks — the EXACT merchant-task set the dashboard
  //                     banner counts (blocking incl. approval gate +
  //                     requested + merchant-resolvable technical).
  //   attention=comm  — communication review states (requested).
  //   `recommended` is not yet queryable server-side (no persisted
  //   concrete-contribution flag) — documented limitation.
  const attentionParam = sp.get("attention");
  if (attentionParam === "tasks" || attentionParam === "comm") {
    const ids = attentionParam === "comm" ? commIds : taskIds;
    query = query.in(
      "id",
      ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"],
    );
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

  // Evidence-strength filter (plan §11.2) — the INDEPENDENT strength
  // dimension: filters on the rules-engine grade of each dispute's
  // LATEST non-failed pack (same "latest wins" rule as the Stage A
  // strength merge below), never on lifecycle. Values: strong |
  // moderate | weak (weak includes the engine's pre-assessment
  // "insufficient", matching resolveStrength's display collapse on the
  // list). Implemented as an id pre-filter so pagination counts stay
  // correct.
  const strengthParam = sp.get("strength");
  if (
    strengthParam === "strong" ||
    strengthParam === "moderate" ||
    strengthParam === "weak"
  ) {
    const { data: strengthPacks } = await sb
      .from("evidence_packs")
      /* The CANONICAL snapshot, same as the display path below.
       *
       * This filter used to read the legacy `case_strength` summary while the
       * pill rendered something else, so `?strength=strong` could return a
       * dispute the list then showed as unassessed — a filter and a display
       * disagreeing about the same row. One source for both. */
      .select(
        "dispute_id, created_at, overall:pack_json->case_assessment->strength->>overall",
      )
      .eq("shop_id", shopId)
      .not("status", "in", "(failed,queued,building)")
      .order("created_at", { ascending: false });
    const latestOverall = new Map<string, string | null>();
    for (const p of strengthPacks ?? []) {
      if (!p.dispute_id || latestOverall.has(p.dispute_id)) continue;
      latestOverall.set(p.dispute_id, (p as { overall?: string | null }).overall ?? null);
    }
    const matchingIds: string[] = [];
    for (const [id, overall] of latestOverall) {
      const matches =
        strengthParam === "weak"
          ? overall === "weak" || overall === "insufficient"
          : overall === strengthParam;
      if (matches) matchingIds.push(id);
    }
    // Empty match set → impossible-id filter so the rest of the flow
    // (pagination shape, aggregates) stays uniform.
    query = query.in(
      "id",
      matchingIds.length > 0
        ? matchingIds
        : ["00000000-0000-0000-0000-000000000000"],
    );
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

  // Authoritative "needs attention" count for the KPI tile — shop-wide, NOT
  // scoped to the current page/filter. Uses the same `needs_attention` flag the
  // dashboard + /admin use, so the disputes-page "Needs action" number matches
  // the dashboard instead of being a client-side count over the loaded page.
  const { count: needsAttentionCount } = await sb
    .from("disputes")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .eq("needs_attention", true);

  // ── Shop-wide KPI aggregates (plan §5.1) ───────────────────────────
  // Active / Amount-at-risk / Under-review must be shop-wide facts, not
  // page-scoped sums that shrink under filters. Reuses the same
  // `shopRows` scan as the attention filter above; same allow-list +
  // dormant-inquiry rules as lib/disputes/metrics.ts. Currency rule
  // (§13): the at-risk sum covers ONE primary currency (most frequent
  // among active rows); other currencies are disclosed as dispute
  // COUNTS, never mixed into the sum.
  let activeCount = 0;
  let underReviewCount = 0;
  const activeRows: Array<{ amount: number; currency: string }> = [];
  for (const r of shopRows ?? []) {
    const row = r as Record<string, unknown>;
    const terminal = row.closed_at != null || row.final_outcome != null;
    if (
      !terminal &&
      (row.submission_state === "submitted_confirmed" ||
        row.normalized_status === "submitted_to_bank")
    ) {
      underReviewCount += 1;
    }
    if (terminal) continue;
    if (!isActiveNormalizedStatus(row.normalized_status as string | null)) continue;
    if (
      isDormantInquiry({
        phase: row.phase as string | null,
        due_at: row.due_at as string | null,
        initiated_at: row.initiated_at as string | null,
      })
    ) {
      continue;
    }
    activeCount += 1;
    activeRows.push({
      amount: Number(row.amount) || 0,
      currency: String(row.currency_code ?? "USD"),
    });
  }
  const currencyCounts: Record<string, number> = {};
  for (const r of activeRows) {
    currencyCounts[r.currency] = (currencyCounts[r.currency] ?? 0) + 1;
  }
  const primaryCurrency =
    Object.entries(currencyCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";
  const amountAtRisk = activeRows
    .filter((r) => r.currency === primaryCurrency)
    .reduce((s, r) => s + r.amount, 0);
  const otherCurrencyCounts: Record<string, number> = {};
  for (const [code, n] of Object.entries(currencyCounts)) {
    if (code !== primaryCurrency) otherCurrencyCounts[code] = n;
  }

  // Merge `caseStrength` from each dispute's latest non-failed pack so the
  // list page can render the strength pill + "{N} strong signals" subtitle
  // without a per-row N+1.
  //
  // ONE narrow select of `pack_json -> case_assessment`, and no recompute.
  // The second stage that used to re-score stale packs is gone: it scored with
  // three of five gates stated `order_not_loaded`, so its answer had to differ
  // from the detail page whenever any of the three fired.
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
      /** Rules-engine explanation token — the list's strength subtitle
       *  (replaces the banned "{n} strong + {m} moderate" arithmetic;
       *  plan §5 item 3). */
      strengthReasonI18n?: I18nToken | null;
    }
  >();
  /** Disputes whose latest pack carries no usable canonical snapshot. */
  const unassessedDisputes = new Set<string>();
  if (disputeIds.length > 0) {
    // Stage A: narrow select.
    const { data: csPacks } = await sb
      .from("evidence_packs")
      .select(
        "id, dispute_id, status, created_at, rebuild_pending, pack_json->case_assessment",
      )
      .in("dispute_id", disputeIds)
      .not("status", "in", "(failed,queued,building)")
      .order("created_at", { ascending: false });

    /* First row per dispute wins (sorted desc) — the LATEST pack. Taking the
     * latest is itself the rebuild-staleness check: when a pack is rebuilt a
     * new row is written, and its snapshot is the current one. */
    for (const p of csPacks ?? []) {
      if (!p.dispute_id || strengthByDispute.has(p.dispute_id)) continue;
      if (unassessedDisputes.has(p.dispute_id)) continue;

      /* ── ONLY THE CANONICAL SNAPSHOT IS A VERDICT ──────────────────────
       *
       * The legacy four-field summary is NOT read here any more, even as a
       * fallback. It is a
       * four-field summary with no freshness of its own: nothing on it says
       * which evidence it describes or which policy produced it, so a reader
       * cannot tell a current one from one written months ago against
       * evidence that has since changed. Falling back to it meant the list
       * rendered a band it could not verify, next to a detail page that had
       * already refused to.
       *
       * A pack with no `case_assessment` is UNASSESSED on this surface. That
       * is the honest answer and the same one the detail page gives; the packs
       * it applies to are the ones PR 3's rebuild exists to refresh. */
      const snapshot = (p as { case_assessment?: unknown }).case_assessment as
        | {
            strength?: {
              overall?: string;
              strongCount?: number;
              moderateCount?: number;
              supportingCount?: number;
              strengthReasonI18n?: { key: string; params?: Record<string, string | number> } | null;
            };
            freshness?: { policyVersion?: number };
          }
        | null
        | undefined;

      const cs = snapshot?.strength;
      if (!cs?.overall) {
        unassessedDisputes.add(p.dispute_id);
        continue;
      }

      /* ── STALENESS, AS FAR AS THIS SURFACE CAN SEE IT ──────────────────
       *
       * The list deliberately does not load `pack_json.sections`, so it cannot
       * reconstruct the input hash — that was Stage B's heavy query and the
       * reason it existed. It checks the two dimensions it CAN check
       * truthfully:
       *
       *   policy version  — a policy bump invalidates every snapshot, and the
       *                     version travels on the snapshot itself.
       *   rebuild_pending — the pack is known to need rebuilding, which is a
       *                     persisted statement that its numbers describe
       *                     evidence that has already moved.
       *
       * Anything it cannot check is left to the detail page, which loads the
       * inputs and reconstructs the hash properly. What matters is the
       * direction of the error: both checks can only WITHHOLD a band, never
       * manufacture one. */
      const policyVersion = snapshot?.freshness?.policyVersion;
      const stale =
        policyVersion !== ASSESSMENT_POLICY_VERSION ||
        (p as { rebuild_pending?: unknown }).rebuild_pending === true;
      if (stale) {
        unassessedDisputes.add(p.dispute_id);
        continue;
      }

      strengthByDispute.set(p.dispute_id, {
        overall: cs.overall,
        strongCount: cs.strongCount ?? 0,
        moderateCount: cs.moderateCount ?? 0,
        supportingCount: cs.supportingCount ?? 0,
        strengthReasonI18n: cs.strengthReasonI18n ?? null,
      });
    }

    /* ── STAGE B IS DELETED (CP-A) ────────────────────────────────────
     *
     * It re-scored a pack LIVE, with `coverage`, `fatalLoss` and
     * `riskWeakness` all stated `order_not_loaded` — a partial gate set by
     * construction, because this query never loads the Shopify order. Three
     * of five gates missing means the list's answer had to differ from the
     * detail page's whenever any of the three fired, and the 2026-08-05
     * audit found exactly that divergence on a fraud case with a
     * cardholder-name mismatch.
     *
     * There is no recompute and no fallback. The list renders what the build
     * path persisted, or nothing. `unassessedDisputes` is the record of which
     * disputes fell into "nothing" and why the pill is an em-dash rather than
     * a number. */
    void unassessedDisputes;
  }

  // ── Shared presentation model (plan §3) ────────────────────────────
  // One resolver interpretation per row: operational lifecycle, merchant
  // attention, strength, external milestones. Batched queries inside
  // (latest pack, checklist, rules, integration flag) — no per-row N+1.
  const strengthOverallByDispute = new Map<string, string>();
  for (const [id, cs] of strengthByDispute) {
    strengthOverallByDispute.set(id, cs.overall);
  }
  const presentations = await gatherPresentations(
    sb,
    shopId,
    (data ?? []) as unknown as DisputeRowFacts[],
    { includeConcreteContribution: true, strengthOverallByDispute },
  );

  const disputesWithStrength = (data ?? []).map((d) => ({
    ...d,
    caseStrength: strengthByDispute.get(d.id) ?? null,
    presentation: presentations.get(d.id) ?? null,
  }));

  // Merchant-action count = the size of the SAME presentation-based
  // task set the `?attention=tasks` filter returns and the dashboard
  // banner counts (includes approval-gate and merchant-reconnect
  // tasks) — one definition, zero drift.
  const merchantActionCount = taskIds.length;

  return NextResponse.json({
    disputes: disputesWithStrength,
    aggregates: {
      // Legacy shop-wide count (includes internal failures) — kept until
      // the UI cuts over to merchant_action_required.
      needs_attention: needsAttentionCount ?? 0,
      // Genuine merchant tasks only (plan §5): blocking + requested
      // attention reasons, excluding terminal and transmission-confirmed
      // rows (stale-attention guard, §4).
      merchant_action_required: merchantActionCount,
      // Shop-wide KPI facts (plan §5.1) — never page-scoped.
      active_count: activeCount,
      under_review_count: underReviewCount,
      amount_at_risk: amountAtRisk,
      amount_at_risk_currency: primaryCurrency,
      // Dispute COUNTS per non-primary currency (§13) — rendered as
      // "Plus N disputes in {code}", never as currency amounts.
      other_currency_counts: otherCurrencyCounts,
    },
    pagination: {
      page,
      per_page: perPage,
      total: count ?? 0,
      total_pages: count ? Math.ceil(count / perPage) : 0,
    },
  });
}
