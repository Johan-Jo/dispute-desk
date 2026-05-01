import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import {
  defaultWindowEndDate,
  windowStartDate,
} from "@/lib/disputes/chargebackRate";

export const runtime = "nodejs";

interface ShopRowWithRate {
  // pass-through `shops.*` columns + computed chargeback fields
  [key: string]: unknown;
  chargebackRate90d: number | null;
  chargebackRate90dNumerator: number;
  chargebackRate90dDenominator: number;
  chargebackRate90dAvailable: boolean;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const search = sp.get("search") ?? "";
  const planFilter = sp.get("plan") ?? "";
  const status = sp.get("status") ?? "";

  const sb = getServiceClient();
  let query = sb.from("shops").select("*").order("created_at", { ascending: false });

  if (search) query = query.ilike("shop_domain", `%${search}%`);
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

  const enriched: ShopRowWithRate[] = shops.map((s) => {
    const t = totals.get(s.id);
    const available = !!t && t.rows > 0;
    const numerator = t?.numerator ?? 0;
    const denominator = t?.denominator ?? 0;
    const rate =
      available && denominator > 0
        ? Math.round((numerator / denominator) * 1000) / 10
        : null;
    return {
      ...s,
      chargebackRate90d: rate,
      chargebackRate90dNumerator: numerator,
      chargebackRate90dDenominator: denominator,
      chargebackRate90dAvailable: available,
    };
  });

  return NextResponse.json(enriched);
}
