import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/packs/:packId
 *
 * Returns pack with evidence items, checklist, audit log, and active job status.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ packId: string }> }
) {
  const { packId } = await params;
  const db = getServiceClient();

  const { data: row, error } = await db
    .from("evidence_packs")
    .select("*, shop:shops(shop_domain), dispute:disputes(dispute_gid)")
    .eq("id", packId)
    .single();

  if (error || !row) {
    return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  }

  const shop = Array.isArray((row as { shop?: unknown }).shop)
    ? (row as { shop: { shop_domain?: string }[] }).shop[0]
    : (row as { shop?: { shop_domain?: string } }).shop;
  const disputeRow = Array.isArray((row as { dispute?: unknown }).dispute)
    ? (row as { dispute: { dispute_gid?: string }[] }).dispute[0]
    : (row as { dispute?: { dispute_gid?: string } }).dispute;
  const shop_domain = shop?.shop_domain ?? null;
  const dispute_gid = disputeRow?.dispute_gid ?? null;
  const { shop: _shop, dispute: _dispute, ...pack } = row as typeof row & { shop?: unknown; dispute?: unknown };

  const [itemsRes, auditRes, buildJobRes, pdfJobRes] = await Promise.all([
    db
      .from("evidence_items")
      .select("*")
      .eq("pack_id", packId)
      .order("created_at", { ascending: true }),
    db
      .from("audit_events")
      .select("id, event_type, event_payload, actor_type, created_at")
      .eq("pack_id", packId)
      .order("created_at", { ascending: true }),
    db
      .from("jobs")
      .select("id, status, last_error, created_at, updated_at")
      .eq("entity_id", packId)
      .eq("job_type", "build_pack")
      .in("status", ["queued", "running"])
      .limit(1)
      .maybeSingle(),
    db
      .from("jobs")
      .select("id, status, last_error, created_at, updated_at")
      .eq("entity_id", packId)
      .eq("job_type", "render_pdf")
      .in("status", ["queued", "running"])
      .limit(1)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    ...pack,
    shop_domain,
    dispute_gid,
    evidence_items: itemsRes.data ?? [],
    audit_events: auditRes.data ?? [],
    active_build_job: buildJobRes.data ?? null,
    active_pdf_job: pdfJobRes.data ?? null,
  });
}
