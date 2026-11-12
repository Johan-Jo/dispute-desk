import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import {
  defaultWindowEndDate,
  windowStartDate,
} from "@/lib/disputes/chargebackRate";
import { fetchAllRows } from "@/lib/admin/fetchAllRows";
import {
  classifyBillingState,
  paidMonthlyUsd,
  type EntitlementEvidence,
} from "@/lib/admin/paidSubscriptions";

export const runtime = "nodejs";

interface ShopRowEnriched {
  // pass-through `shops.*` columns + computed admin fields
  [key: string]: unknown;
  chargebackRate90d: number | null;
  chargebackRate90dNumerator: number;
  chargebackRate90dDenominator: number;
  chargebackRate90dAvailable: boolean;
  /** Total disputes (all-time) for this shop. */
  disputeCount: number;
  /** Total evidence packs (all-time) for this shop. */
  packCount: number;
  /** Monthly revenue in USD actually being paid (see lib/admin/paidSubscriptions). */
  monthlyRevenueUsd: number;
  /** paid | trialing | grace | unconfirmed | free | uninstalled */
  billingState: string;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const search = sp.get("search") ?? "";
  const planFilter = sp.get("plan") ?? "";
  const status = sp.get("status") ?? "";

  const sb = getServiceClient();
  let query = sb.from("shops").select("*").order("created_at", { ascending: false });

  // Match either domain: ops search by the real storefront domain
  // ("blumebox") as readily as by the myshopify alias, and shops installed
  // before the primary_domain backfill only have the alias.
  if (search) {
    const term = search.replace(/[%,()]/g, "");
    if (term) {
      query = query.or(
        `shop_domain.ilike.%${term}%,primary_domain.ilike.%${term}%`,
      );
    }
  }
  if (planFilter) query = query.eq("plan", planFilter);
  if (status === "active") query = query.is("uninstalled_at", null);
  if (status === "uninstalled") query = query.not("uninstalled_at", "is", null);

  const { data, error } = await query.limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const shops = (data ?? []) as Array<{ id: string } & Record<string, unknown>>;
  if (shops.length === 0) return NextResponse.json([]);

  // Aggregate the trailing-90d chargeback rate per shop in ONE
  // shop_daily_metrics query. Avoids fanning out 200 individual reads
  // for the admin list view (Task 3 column). The window mirrors the
  // 90d snapshot used by the admin detail page.
  const toDate = defaultWindowEndDate();
  const fromDate = windowStartDate(toDate, 90);
  const shopIds = shops.map((s) => s.id);

  const { data: snapshotRows, error: snapshotErr } = await sb
    .from("shop_daily_metrics")
    .select("shop_id, order_count, chargeback_count")
    .in("shop_id", shopIds)
    .gte("date", fromDate)
    .lte("date", toDate);

  if (snapshotErr) {
    return NextResponse.json({ error: snapshotErr.message }, { status: 500 });
  }

  const totals = new Map<
    string,
    { numerator: number; denominator: number; rows: number }
  >();
  for (const row of snapshotRows ?? []) {
    const existing = totals.get(row.shop_id as string) ?? {
      numerator: 0,
      denominator: 0,
      rows: 0,
    };
    existing.numerator += (row.chargeback_count as number | null) ?? 0;
    existing.denominator += (row.order_count as number | null) ?? 0;
    existing.rows += 1;
    totals.set(row.shop_id as string, existing);
  }

  // ── Disputes count + Packs count, batched per shop ──────────────
  // Two scalar queries instead of 2N. We pull `shop_id` from each
  // row and tally locally. Acceptable cost since the disputes /
  // evidence_packs tables stay small per shop.
  // Both are paged: an un-ranged select silently truncates at 1000 rows, which
  // made per-shop counts wrong once the tables grew past that.
  const [dispRows, packRows, entitlements] = await Promise.all([
    fetchAllRows<{ shop_id: string }>((from, to) =>
      sb.from("disputes").select("id, shop_id").in("shop_id", shopIds).order("id").range(from, to),
    ),
    fetchAllRows<{ shop_id: string }>((from, to) =>
      sb.from("evidence_packs").select("id, shop_id").in("shop_id", shopIds).order("id").range(from, to),
    ),
    fetchAllRows<EntitlementEvidence>((from, to) =>
      sb
        .from("plan_entitlements")
        .select("shop_id, plan_key, subscription_state, first_paid_cycle_started_at")
        .in("shop_id", shopIds)
        .order("shop_id")
        .range(from, to),
    ),
  ]);
  const entByShop = new Map(entitlements.map((e) => [e.shop_id, e]));

  const disputeCounts = new Map<string, number>();
  for (const r of dispRows ?? []) {
    const sid = r.shop_id as string;
    disputeCounts.set(sid, (disputeCounts.get(sid) ?? 0) + 1);
  }
  const packCounts = new Map<string, number>();
  for (const r of packRows ?? []) {
    const sid = r.shop_id as string;
    packCounts.set(sid, (packCounts.get(sid) ?? 0) + 1);
  }

  const enriched: ShopRowEnriched[] = shops.map((s) => {
    const t = totals.get(s.id);
    const available = !!t && t.rows > 0;
    const numerator = t?.numerator ?? 0;
    const denominator = t?.denominator ?? 0;
    const rate =
      available && denominator > 0
        ? Math.round((numerator / denominator) * 1000) / 10
        : null;
    const ent = entByShop.get(s.id);
    const billingState = classifyBillingState(
      { plan: (s.plan as string | null) ?? null, uninstalled_at: (s.uninstalled_at as string | null) ?? null },
      ent,
    );
    return {
      ...s,
      chargebackRate90d: rate,
      chargebackRate90dNumerator: numerator,
      chargebackRate90dDenominator: denominator,
      chargebackRate90dAvailable: available,
      disputeCount: disputeCounts.get(s.id) ?? 0,
      packCount: packCounts.get(s.id) ?? 0,
      // Revenue actually being paid — 0 for trials and unconfirmed labels.
      monthlyRevenueUsd: paidMonthlyUsd(billingState, ent, (s.plan as string | null) ?? null),
      billingState,
    };
  });

  return NextResponse.json(enriched);
}
