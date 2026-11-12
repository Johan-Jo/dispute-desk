import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** PATCH — retry (reset to queued) or cancel a job */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const action = body && typeof body === "object" ? (body as { action?: unknown }).action : undefined;
  const sb = getServiceClient();

  if (action === "retry") {
    const { data, error } = await sb
      .from("jobs")
      .update({ status: "queued", attempts: 0, error: null, locked_at: null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "failed")
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // The status guard makes a stale click a no-op; say so instead of "ok".
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Job is no longer failed — nothing to retry" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, action: "retried" });
  }

  if (action === "cancel") {
    const { data, error } = await sb
      .from("jobs")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", id)
      .in("status", ["queued", "running"])
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Job already finished — nothing to cancel" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, action: "cancelled" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
