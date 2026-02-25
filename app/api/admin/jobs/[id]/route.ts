import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** PATCH — retry (reset to queued) or cancel a job */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { action } = await req.json();
  const sb = getServiceClient();

  if (action === "retry") {
    const { error } = await sb
      .from("jobs")
      .update({ status: "queued", attempts: 0, error: null, locked_at: null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "failed");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action: "retried" });
  }

  if (action === "cancel") {
    const { error } = await sb
      .from("jobs")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", id)
      .in("status", ["queued", "running"]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action: "cancelled" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
