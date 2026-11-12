import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { loadShopLabels } from "@/lib/admin/shopLabels";
import { toCsv } from "@/lib/admin/csv";

export const runtime = "nodejs";

const LIMIT = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/admin/audit
 *
 * Shop-scoped `audit_events` plus platform-wide `admin_audit_events` (template
 * and reason-mapping changes, which have no shop), newest first.
 *
 * Filters: `shop` (a shop id OR any part of its storefront / myshopify domain),
 * `event_type`, `from`, `to`, `format=csv`. The legacy `shop_id` param still
 * works. A malformed id/date is a 400 — it used to reach Postgres and come
 * back as a 500, which the page then crashed on while the operator was still
 * typing a UUID.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const shopInput = (sp.get("shop") ?? sp.get("shop_id") ?? "").trim();
  const eventType = (sp.get("event_type") ?? "").trim();
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const format = sp.get("format") ?? "json";

  for (const [name, v] of [["from", from], ["to", to]] as const) {
    if (v && Number.isNaN(Date.parse(v))) {
      return NextResponse.json({ error: `Invalid ${name} date` }, { status: 400 });
    }
  }

  const sb = getServiceClient();

  // Resolve the shop filter to ids.
  let shopIds: string[] | null = null;
  if (shopInput) {
    if (UUID_RE.test(shopInput)) {
      shopIds = [shopInput];
    } else {
      const term = shopInput.replace(/[%,()]/g, "");
      const { data: matches, error: mErr } = await sb
        .from("shops")
        .select("id")
        .or(`shop_domain.ilike.%${term}%,primary_domain.ilike.%${term}%`)
        .limit(50);
      if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
      shopIds = (matches ?? []).map((m) => m.id as string);
      if (shopIds.length === 0) return respond([], format, new Map());
    }
  }

  let query = sb
    .from("audit_events")
    .select("id, shop_id, event_type, actor_type, actor_id, created_at, event_payload")
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (shopIds) query = query.in("shop_id", shopIds);
  if (eventType) query = query.eq("event_type", eventType);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  const shopEventsP = query;

  // Platform-wide events have no shop, so they only make sense without a shop filter.
  let globalQuery = sb
    .from("admin_audit_events")
    .select("id, event_type, actor_user_id, actor_email, created_at, event_payload")
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (eventType) globalQuery = globalQuery.eq("event_type", eventType);
  if (from) globalQuery = globalQuery.gte("created_at", from);
  if (to) globalQuery = globalQuery.lte("created_at", to);

  const [shopRes, globalRes] = await Promise.all([shopEventsP, shopIds ? Promise.resolve(null) : globalQuery]);
  if (shopRes.error) return NextResponse.json({ error: shopRes.error.message }, { status: 500 });
  if (globalRes?.error) return NextResponse.json({ error: globalRes.error.message }, { status: 500 });

  const rows: AuditRow[] = [
    ...(shopRes.data ?? []).map((r) => ({
      id: r.id as string,
      shop_id: (r.shop_id as string | null) ?? null,
      event_type: r.event_type as string,
      actor_type: (r.actor_type as string | null) ?? null,
      actor_id: (r.actor_id as string | null) ?? null,
      created_at: r.created_at as string,
      event_payload: (r.event_payload as Record<string, unknown> | null) ?? {},
      scope: "shop" as const,
    })),
    ...(globalRes?.data ?? []).map((r) => ({
      id: `global:${r.id as string}`,
      shop_id: null,
      event_type: r.event_type as string,
      actor_type: "admin",
      actor_id: r.actor_email as string,
      created_at: r.created_at as string,
      event_payload: (r.event_payload as Record<string, unknown> | null) ?? {},
      scope: "global" as const,
    })),
  ]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, LIMIT);

  const labels = await loadShopLabels(sb, rows.map((r) => r.shop_id));
  return respond(rows, format, labels);
}

interface AuditRow {
  id: string;
  shop_id: string | null;
  event_type: string;
  actor_type: string | null;
  actor_id: string | null;
  created_at: string;
  event_payload: Record<string, unknown>;
  scope: "shop" | "global";
}

function respond(
  rows: AuditRow[],
  format: string,
  labels: Map<string, { shop_domain: string; primary_domain: string | null }>,
) {
  const enriched = rows.map((r) => ({ ...r, shop: r.shop_id ? labels.get(r.shop_id) ?? null : null }));

  if (format === "csv") {
    const csv = toCsv(
      ["id", "created_at", "event_type", "actor_type", "actor", "shop_id", "shop", "scope", "event_payload"],
      enriched.map((r) => [
        r.id,
        r.created_at,
        r.event_type,
        r.actor_type,
        r.actor_id,
        r.shop_id,
        r.shop ? (r.shop.primary_domain || r.shop.shop_domain) : "",
        r.scope,
        JSON.stringify(r.event_payload),
      ]),
    );
    return new NextResponse(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=audit.csv" },
    });
  }

  return NextResponse.json({ events: enriched, limit: LIMIT, truncated: rows.length >= LIMIT });
}
