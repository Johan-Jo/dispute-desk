import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { computeStoreRevenue } from "@/lib/admin/storeRevenue";
import { getAdminSessionUser } from "@/lib/admin/auth";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = getServiceClient();

  const [shop, disputeCount, packCount, storeRevenue] = await Promise.all([
    sb.from("shops").select("*").eq("id", id).single(),
    sb.from("disputes").select("id", { count: "exact", head: true }).eq("shop_id", id),
    sb.from("evidence_packs").select("id", { count: "exact", head: true }).eq("shop_id", id),
    computeStoreRevenue(id),
  ]);

  if (!shop.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    shop: shop.data,
    disputes: disputeCount.count ?? 0,
    packs: packCount.count ?? 0,
    // Merchant's own store revenue (GMV) over trailing 30 days — the
    // "Monthly Revenue" card shows this, not our subscription revenue.
    storeRevenue: {
      total: storeRevenue.total,
      currency: storeRevenue.currency,
      orderCount: storeRevenue.orderCount,
    },
  });
}

/** PATCH — admin overrides (plan, pack_limit_override, admin_notes) */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const sb = getServiceClient();

  const updates: Record<string, unknown> = {};
  if (body.plan) updates.plan = body.plan;
  if (body.pack_limit_override !== undefined) updates.pack_limit_override = body.pack_limit_override;
  if (body.admin_notes !== undefined) updates.admin_notes = body.admin_notes;
  if (body.auto_pack_enabled !== undefined) updates.auto_pack_enabled = body.auto_pack_enabled;
  updates.updated_at = new Date().toISOString();

  const { error } = await sb.from("shops").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditEvent({
    shopId: id,
    actorType: "system",
    eventType: "admin_override",
    eventPayload: { updates: body, admin: true },
  });

  return NextResponse.json({ ok: true });
}

/**
 * DELETE — permanently purge a shop and every row belonging to it.
 *
 * For clearing dev stores, our own test installs and app-review throwaways
 * out of the admin list. This is a REAL delete, not an uninstall flag: the
 * merchant has to install the app again, and nothing is recoverable.
 *
 * The work happens inside the `admin_purge_shop` SQL function rather than
 * here, for two reasons:
 *
 *   1. **Atomicity.** A loop of PostgREST deletes is not a transaction — a
 *      failure halfway leaves a half-erased shop. That is precisely how the
 *      GDPR `shop/redact` handler fails today.
 *   2. **The append-only tables.** `audit_events` and `dispute_events` carry
 *      BEFORE DELETE triggers that refuse every delete. The function opts in
 *      via a transaction-scoped flag those triggers recognise; ordinary
 *      traffic still cannot delete or update either table.
 *
 * Requires `?confirm=<shop_domain>` matching the row exactly. The shop being
 * deleted is chosen from a list of similar-looking myshopify domains, and an
 * id in a URL is not something a human can eyeball — so the caller has to
 * name the shop it means.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Defence in depth: middleware already gates /api/admin/*, but this is the
  // most destructive route in the app, so it re-checks rather than trusting
  // an upstream matcher that a future refactor might narrow.
  const admin = await getAdminSessionUser();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();
  const { data: shop } = await sb
    .from("shops")
    .select("id, shop_domain")
    .eq("id", id)
    .maybeSingle();

  if (!shop) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const confirm = req.nextUrl.searchParams.get("confirm");
  if (confirm !== shop.shop_domain) {
    return NextResponse.json(
      {
        error: "Confirmation does not match",
        detail: `Pass ?confirm=${shop.shop_domain} to purge this shop.`,
      },
      { status: 400 },
    );
  }

  // Logged BEFORE the purge: the shop's own audit rows are about to be
  // deleted along with everything else, so an audit row written after the
  // fact would have nothing to attach to. This one is written against the
  // shop and dies with it — the durable record is the server log below.
  await logAuditEvent({
    shopId: id,
    actorType: "system",
    eventType: "admin_shop_purge_requested",
    eventPayload: { shop_domain: shop.shop_domain, admin_email: admin.email },
  });

  const { data, error } = await sb.rpc("admin_purge_shop", { p_shop_id: id });

  if (error) {
    console.error("[admin] shop purge failed", {
      shopId: id,
      shopDomain: shop.shop_domain,
      message: error.message,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // The surviving record of the deletion, since every table that could have
  // held one has just been emptied.
  console.log(
    `[admin] shop purged: ${shop.shop_domain} by ${admin.email}`,
    JSON.stringify(data),
  );

  return NextResponse.json({ ok: true, purged: data });
}
