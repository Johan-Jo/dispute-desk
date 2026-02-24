import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/packs/:packId
 *
 * Returns pack with evidence items, checklist, and current PDF job status summary.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ packId: string }> }
) {
  const { packId } = await params;
  const db = getServiceClient();

  const { data: pack, error } = await db
    .from("evidence_packs")
    .select("*")
    .eq("id", packId)
    .single();

  if (error || !pack) {
    return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  }

  const { data: items } = await db
    .from("evidence_items")
    .select("*")
    .eq("pack_id", packId)
    .order("created_at", { ascending: true });

  const { data: auditEvents } = await db
    .from("audit_events")
    .select("id, event_type, event_payload, actor_type, created_at")
    .eq("pack_id", packId)
    .order("created_at", { ascending: true });

  // Check for active PDF render job
  const { data: activeJob } = await db
    .from("jobs")
    .select("id, status, last_error")
    .eq("entity_id", packId)
    .eq("job_type", "render_pdf")
    .in("status", ["queued", "running"])
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    ...pack,
    evidence_items: items ?? [],
    audit_events: auditEvents ?? [],
    active_pdf_job: activeJob ?? null,
  });
}
