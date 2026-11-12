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
import { fetchAllRows } from "@/lib/admin/fetchAllRows";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIN_BUCKET_N = 30;
const WINDOW_DAYS = 90;

interface BucketRow {
  bucket: string;
  orders: number;
  disputes: number;
}

interface PageData {
  /** Set when the aggregation failed — the page says so instead of rendering zeros. */
  loadError: string | null;
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

  // Bucketing happens in SQL over EVERY order in the window
  // (dd_admin_fraud_intel_buckets). It used to pull rows into the app, where
  // PostgREST's 1000-row cap meant the page analysed ~3% of the orders, and it
  // counted disputes from shopify_orders.has_chargeback, which is never set —
  // so every bucket read 0%. A dispute here = a disputes row exists for the order.
  const { data: bucketRows, error: bucketErr } = await sb.rpc(
    "dd_admin_fraud_intel_buckets",
    { p_since: sinceIso },
  );
  const rows = (bucketRows ?? []) as Array<{
    dimension: string;
    bucket: string;
    orders: number | string;
    disputes: number | string;
  }>;
  const byDimension = (dimension: string): BucketRow[] =>
    rows
      .filter((r) => r.dimension === dimension)
      .map((r) => ({ bucket: r.bucket, orders: Number(r.orders), disputes: Number(r.disputes) }))
      .sort((a, b) => b.orders - a.orders);
  const total = byDimension("total")[0];
  const ordersInWindow = total?.orders ?? 0;
  const disputesInWindow = total?.disputes ?? 0;
  const avsBuckets = byDimension("avs");
  const attemptBuckets = byDimension("attempts");
  const distanceBuckets = byDimension("distance");
  const proxyCrossBuckets = byDimension("proxy_cross");

  // Classification drift — top unmatched fact patterns for orders
  // Shopify rated LOW that became chargebacks. Joined to disputes
  // through has_chargeback.
  // The table now stores one row per distinct phrasing with an occurrence
  // count, so the top-N comes straight from the DB. This previously pulled
  // 2000 raw rows and tallied them here — against 6.5M rows that made the
  // "top drift patterns" an arbitrary sliver rather than the real top-N.
  const driftSamples: PageData["driftSamples"] = [];
  const { data: parseMisses } = await sb
    .from("fraud_intel_parse_misses")
    .select("fact_text, fact_sentiment, occurrences")
    .gte("last_seen_at", sinceIso)
    .order("occurrences", { ascending: false })
    .limit(20);
  for (const m of parseMisses ?? []) {
    driftSamples.push({
      fact: m.fact_text,
      sentiment: m.fact_sentiment,
      count: m.occurrences,
    });
  }

  // Total sightings in the window — the sum of the counts, not a row count.
  // A row count would now report distinct phrasings and silently change what
  // this number means.
  const missTotals = await fetchAllRows<{ id: string; occurrences: number | null }>(
    (from, to) =>
      sb
        .from("fraud_intel_parse_misses")
        .select("id, occurrences")
        .gte("last_seen_at", sinceIso)
        .order("id")
        .range(from, to),
  ).catch(() => [] as Array<{ id: string; occurrences: number | null }>);
  const parseMissCount = missTotals.reduce(
    (sum, r) => sum + (r.occurrences ?? 0),
    0,
  );

  return {
    loadError: bucketErr ? bucketErr.message : null,
    windowDays: WINDOW_DAYS,
    ordersInWindow,
    disputesInWindow,
    parseMissCount,
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
          days, across every order in the window. A dispute is an order that has a dispute record. Buckets with fewer than {MIN_BUCKET_N} orders are flagged
          as insufficient sample. Each cut is a hypothesis — validate before
          surfacing in merchant-facing UI.
        </p>
      </div>

      {data.loadError && (
        <div role="alert" className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">
          The signal aggregation failed ({data.loadError}). The figures below are
          not valid — do not read the empty tables as &quot;no orders&quot;.
        </div>
      )}

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
