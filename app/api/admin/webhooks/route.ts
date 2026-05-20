import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/admin/webhooks
 *
 * Lists recent webhook_events deliveries with pagination + filtering and
 * exposes a 24h aggregate-stats sub-route via ?aggregate=1.
 *
 * Layer A delivery telemetry — keyed on (shop_id, X-Shopify-Webhook-Id).
 * Per docs/runbooks/webhook-delivery.md.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sb = getServiceClient();

  if (sp.get("aggregate") === "1") {
    return aggregateStats(sb);
  }

  const topic = sp.get("topic") ?? "";
  const outcome = sp.get("outcome") ?? "";
  const shopId = sp.get("shop_id") ?? "";
  const search = sp.get("q") ?? "";
  const limit = Math.min(parseInt(sp.get("limit") ?? "100", 10) || 100, 500);
  const offset = Math.max(parseInt(sp.get("offset") ?? "0", 10) || 0, 0);

  let query = sb
    .from("webhook_events")
    .select(
      "id, shop_id, event_id, topic, shopify_object_id, received_at, processed_at, outcome, error_message, processing_ms",
      { count: "exact" },
    )
    .order("received_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (topic) query = query.eq("topic", topic);
  if (outcome) query = query.eq("outcome", outcome);
  if (shopId) query = query.eq("shop_id", shopId);
  if (search) query = query.ilike("shopify_object_id", `%${search}%`);

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    rows: data ?? [],
    total: count ?? 0,
    limit,
    offset,
  });
}

async function aggregateStats(
  sb: ReturnType<typeof getServiceClient>,
): Promise<NextResponse> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await sb
    .from("webhook_events")
    .select("topic, outcome, processing_ms, received_at, shopify_object_id, shop_id")
    .gte("received_at", since)
    .order("received_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Array<{
    topic: string;
    outcome: string | null;
    processing_ms: number | null;
    received_at: string;
    shopify_object_id: string | null;
    shop_id: string | null;
  }>;

  const total = rows.length;
  const byOutcome = bucket(rows, (r) => r.outcome ?? "pending");
  const byTopic = bucket(rows, (r) => r.topic);
  const latencies = rows
    .map((r) => r.processing_ms)
    .filter((n): n is number => typeof n === "number");
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);

  // Cron-only reconciliations: disputes the cron path "applied" in the last
  // 24h that have no preceding successful webhook delivery for the same
  // shopify_object_id within 5 minutes. Non-zero with Shopify Partner
  // dashboard showing deliveries = silent webhook failure on our endpoint.
  const cronOnlyReconciliations = await computeCronOnlyReconciliations(sb, since);

  return NextResponse.json({
    total,
    byOutcome,
    byTopic,
    p50,
    p95,
    cronOnlyReconciliations,
  });
}

function bucket<T>(
  rows: T[],
  key: (r: T) => string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[idx] ?? null;
}

async function computeCronOnlyReconciliations(
  sb: ReturnType<typeof getServiceClient>,
  since: string,
): Promise<number> {
  // Disputes the CRON observed and applied state to in the last 24h.
  const { data: cronApplied } = await sb
    .from("audit_events")
    .select("dispute_id, created_at, event_payload")
    .eq("event_type", "effect:evaluate_and_run_pipeline")
    .gte("created_at", since);

  const cronAppliedRows = (cronApplied ?? []) as Array<{
    dispute_id: string | null;
    created_at: string;
    event_payload: { source?: string } | null;
  }>;

  let count = 0;
  for (const row of cronAppliedRows) {
    if (row.event_payload?.source !== "cron") continue;
    if (!row.dispute_id) continue;
    // Was there a successful webhook delivery for this dispute within 5 minutes
    // BEFORE this cron-applied row? If not, the cron caught a silent webhook failure.
    const windowStart = new Date(
      new Date(row.created_at).getTime() - 5 * 60 * 1000,
    ).toISOString();

    const { count: webhookCount } = await sb
      .from("webhook_events")
      .select("id", { count: "exact", head: true })
      .gte("received_at", windowStart)
      .lt("received_at", row.created_at)
      .eq("outcome", "applied");
    if (!webhookCount || webhookCount === 0) count++;
  }

  return count;
}
