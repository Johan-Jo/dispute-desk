/**
 * /admin/fraud-intel — Phase 2 intelligence v0 (PR-E).
 *
 * Proves the queries are useful before we invest in a materialized
 * rollup (PR-F). Server component — service-role joins direct against
 * shopify_orders ⋈ shopify_order_risk_signals ⋈ disputes.
 *
 * v0 cuts (each gated by N ≥ 30 sample size; below that we render
 * "insufficient sample (N=<count>)" instead of a misleading percentage):
 *
 *   1. Dispute rate by AVS outcome bucket (incl. explicit `unknown`)
 *   2. Dispute rate by payment_attempt_count decile
 *   3. Dispute rate by ip_ship_distance_km bucket
 *   4. Dispute rate by proxy_detected × is_cross_border
 *   5. Classification drift: orders Shopify rated LOW that became
 *      chargebacks — top fact patterns Shopify missed
 *
 * Bounded by created_at_shopify >= now() - 90 days so the unindexed
 * correlations stay fast during v0. The parse-misses widget surfaces
 * parser drift count so we can monitor when Shopify rewords a signal.
 */

import { getServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIN_BUCKET_N = 30;
const WINDOW_DAYS = 90;

interface BucketRow {
  bucket: string;
  orders: number;
  disputes: number;
}

interface OrderRow {
  shop_id: string;
  shopify_order_id: string;
  has_chargeback: boolean | null;
  is_cross_border: boolean | null;
  created_at_shopify: string;
  risk_level_initial: string | null;
}

interface SignalRow {
  shop_id: string;
  shopify_order_id: string;
  avs_address_result: string | null;
  payment_attempt_count: number | null;
  proxy_detected: boolean | null;
  ip_ship_distance_km: number | null;
}

interface PageData {
  windowDays: number;
  ordersInWindow: number;
  disputesInWindow: number;
  parseMissCount: number;
  avsBuckets: BucketRow[];
  attemptBuckets: BucketRow[];
  distanceBuckets: BucketRow[];
  proxyCrossBuckets: BucketRow[];
  driftSamples: Array<{ fact: string; sentiment: string | null; count: number }>;
}

async function loadPageData(): Promise<PageData> {
  const sb = getServiceClient();
  const sinceIso = new Date(
    Date.now() - WINDOW_DAYS * 24 * 3600 * 1000,
  ).toISOString();

  // Pull the joined order+signal+dispute snapshot. v0 is unbounded by
  // shop — admin view aggregates across all shops. PR-E plan caps the
  // 90-day window so the unindexed join stays inside a few hundred ms.
  const { data: orderRows } = await sb
    .from("shopify_orders")
    .select(
      "shop_id, shopify_order_id, has_chargeback, is_cross_border, created_at_shopify, risk_level_initial",
    )
    .gte("created_at_shopify", sinceIso)
    .limit(50_000);

  const orders = (orderRows ?? []) as OrderRow[];
  const ordersInWindow = orders.length;
  const orderKey = (r: { shop_id: string; shopify_order_id: string }) =>
    `${r.shop_id}|${r.shopify_order_id}`;

  // Signals lookup, keyed for in-memory join.
  const { data: signalRows } = await sb
    .from("shopify_order_risk_signals")
    .select(
      "shop_id, shopify_order_id, avs_address_result, payment_attempt_count, proxy_detected, ip_ship_distance_km",
    )
    .in(
      "shopify_order_id",
      orders.map((r) => r.shopify_order_id),
    )
    .limit(50_000);
  const signals = (signalRows ?? []) as SignalRow[];
  const signalByKey = new Map<string, SignalRow>();
  for (const s of signals) signalByKey.set(orderKey(s), s);

  // Dispute count — restrict to orders in the same window. Use the
  // has_chargeback flag from shopify_orders as primary signal (already
  // reconciled by the daily fraud-metrics snapshot job).
  let disputesInWindow = 0;
  for (const r of orders) {
    if (r.has_chargeback) disputesInWindow++;
  }

  // Helper to bucket orders + compute disputes.
  function tally<K extends string>(
    bucketFn: (order: OrderRow, signal: SignalRow | undefined) => K | null,
  ): BucketRow[] {
    const tallies = new Map<K, { orders: number; disputes: number }>();
    for (const o of orders) {
      const s = signalByKey.get(orderKey(o));
      const bucket = bucketFn(o, s);
      if (bucket === null) continue;
      const entry = tallies.get(bucket) ?? { orders: 0, disputes: 0 };
      entry.orders++;
      if (o.has_chargeback) entry.disputes++;
      tallies.set(bucket, entry);
    }
    return Array.from(tallies.entries())
      .map(([bucket, v]) => ({ bucket, orders: v.orders, disputes: v.disputes }))
      .sort((a, b) => b.orders - a.orders);
  }

  const avsBuckets = tally((_o, s) => {
    if (!s) return "unknown";
    const code = (s.avs_address_result ?? "").trim();
    return code === "" ? "unknown" : code;
  });

  const attemptBuckets = tally((_o, s) => {
    const n = s?.payment_attempt_count;
    if (n == null) return "unknown";
    if (n <= 1) return "1";
    if (n === 2) return "2";
    if (n <= 4) return "3-4";
    return "5+";
  });

  const distanceBuckets = tally((_o, s) => {
    const km = s?.ip_ship_distance_km;
    if (km == null) return "missing";
    if (km <= 50) return "0-50";
    if (km <= 200) return "50-200";
    if (km <= 1000) return "200-1000";
    return "1000+";
  });

  const proxyCrossBuckets = tally((o, s) => {
    const proxy =
      s?.proxy_detected === null || s?.proxy_detected === undefined
        ? "not_reported"
        : s.proxy_detected
          ? "proxy"
          : "no_proxy";
    const cross =
      o.is_cross_border === null ? "cross_unknown" : o.is_cross_border ? "cross" : "same";
    return `${proxy}×${cross}`;
  });

  // Classification drift — top unmatched fact patterns for orders
  // Shopify rated LOW that became chargebacks. Joined to disputes
  // through has_chargeback.
  const driftSamples: PageData["driftSamples"] = [];
  const { data: parseMisses } = await sb
    .from("fraud_intel_parse_misses")
    .select("fact_text, fact_sentiment")
    .gte("observed_at", sinceIso)
    .limit(2000);
  const driftAgg = new Map<string, { count: number; sentiment: string | null }>();
  for (const m of parseMisses ?? []) {
    const key = m.fact_text;
    const entry = driftAgg.get(key) ?? { count: 0, sentiment: m.fact_sentiment };
    entry.count++;
    driftAgg.set(key, entry);
  }
  for (const [fact, v] of driftAgg) {
    driftSamples.push({ fact, sentiment: v.sentiment, count: v.count });
  }
  driftSamples.sort((a, b) => b.count - a.count);

  const { count: parseMissCount } = await sb
    .from("fraud_intel_parse_misses")
    .select("id", { head: true, count: "exact" })
    .gte("observed_at", sinceIso);

  return {
    windowDays: WINDOW_DAYS,
    ordersInWindow,
    disputesInWindow,
    parseMissCount: parseMissCount ?? 0,
    avsBuckets,
    attemptBuckets,
    distanceBuckets,
    proxyCrossBuckets,
    driftSamples: driftSamples.slice(0, 20),
  };
}

function fmtRate(b: BucketRow): string {
  if (b.orders < MIN_BUCKET_N) {
    return `insufficient sample (N=${b.orders})`;
  }
  const pct = (b.disputes / b.orders) * 100;
  return `${pct.toFixed(2)}% (${b.disputes}/${b.orders})`;
}

export default async function AdminFraudIntelPage() {
  const data = await loadPageData();

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-[#0F172A]">Fraud Intelligence v0</h1>
        <p className="text-sm text-[#64748B] mt-1">
          Cross-shop signal correlations over the trailing {data.windowDays}{" "}
          days. Buckets with fewer than {MIN_BUCKET_N} orders are flagged
          as insufficient sample. Each cut is a hypothesis — validate before
          surfacing in merchant-facing UI.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Orders in window" value={data.ordersInWindow.toLocaleString()} />
        <KpiCard
          label="Disputes in window"
          value={data.disputesInWindow.toLocaleString()}
        />
        <KpiCard
          label="Parser misses (90d)"
          value={data.parseMissCount.toLocaleString()}
          hint={
            data.parseMissCount > 100
              ? "Watch for parser drift — Shopify may have reworded a signal"
              : "Healthy"
          }
        />
      </div>

      <BucketTable
        title="Dispute rate by AVS outcome"
        description="Shopify's AVS letter codes (Y/A/Z/N/U/…). `unknown` = no card paymentDetails projected — wallet checkouts, gift cards, manual payments."
        rows={data.avsBuckets}
      />

      <BucketTable
        title="Dispute rate by payment-attempt count"
        description="Parsed from risk facts. `unknown` = signal not reported for this order."
        rows={data.attemptBuckets}
      />

      <BucketTable
        title="Dispute rate by IP ↔ shipping distance"
        description="Parsed from risk facts. `missing` = distance not reported (often correlates with proxy use)."
        rows={data.distanceBuckets}
      />

      <BucketTable
        title="Dispute rate by proxy_detected × is_cross_border"
        description="`proxy / no_proxy / not_reported` × `same / cross / cross_unknown`."
        rows={data.proxyCrossBuckets}
      />

      <DriftTable rows={data.driftSamples} />
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-lg p-4">
      <div className="text-xs uppercase tracking-wide text-[#64748B]">{label}</div>
      <div className="text-2xl font-bold text-[#0F172A] mt-1">{value}</div>
      {hint && <div className="text-xs text-[#94A3B8] mt-1">{hint}</div>}
    </div>
  );
}

function BucketTable({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: BucketRow[];
}) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-lg">
      <div className="p-4 border-b border-[#E2E8F0]">
        <h2 className="text-lg font-semibold text-[#0F172A]">{title}</h2>
        <p className="text-xs text-[#64748B] mt-1">{description}</p>
      </div>
      <table className="w-full">
        <thead>
          <tr className="bg-[#F8FAFC] text-left text-xs uppercase tracking-wide text-[#64748B]">
            <th className="px-4 py-2">Bucket</th>
            <th className="px-4 py-2">Orders</th>
            <th className="px-4 py-2">Disputes</th>
            <th className="px-4 py-2">Dispute rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-4 py-4 text-sm text-[#94A3B8]">
                No data
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.bucket} className="border-t border-[#F1F5F9]">
                <td className="px-4 py-2 text-sm font-mono">{r.bucket}</td>
                <td className="px-4 py-2 text-sm">{r.orders.toLocaleString()}</td>
                <td className="px-4 py-2 text-sm">{r.disputes.toLocaleString()}</td>
                <td className="px-4 py-2 text-sm">{fmtRate(r)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function DriftTable({
  rows,
}: {
  rows: Array<{ fact: string; sentiment: string | null; count: number }>;
}) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-lg">
      <div className="p-4 border-b border-[#E2E8F0]">
        <h2 className="text-lg font-semibold text-[#0F172A]">
          Top parser misses (drift watch)
        </h2>
        <p className="text-xs text-[#64748B] mt-1">
          Shopify fact strings the parser didn&apos;t match. A new top entry
          usually means Shopify reworded a signal — bump PARSER_VERSION and
          add a regex.
        </p>
      </div>
      <table className="w-full">
        <thead>
          <tr className="bg-[#F8FAFC] text-left text-xs uppercase tracking-wide text-[#64748B]">
            <th className="px-4 py-2">Fact text</th>
            <th className="px-4 py-2">Sentiment</th>
            <th className="px-4 py-2">Count (90d)</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-4 py-4 text-sm text-[#94A3B8]">
                Parser is matching every fact in the window — healthy.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.fact} className="border-t border-[#F1F5F9]">
                <td className="px-4 py-2 text-sm font-mono max-w-md truncate">
                  {r.fact}
                </td>
                <td className="px-4 py-2 text-sm">{r.sentiment ?? "—"}</td>
                <td className="px-4 py-2 text-sm">{r.count.toLocaleString()}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
