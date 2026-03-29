import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Reset a failed queue row to pending so the next publish tick can retry. */
export async function POST(_req: NextRequest, ctx: Ctx) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const sb = getServiceClient();
  const now = new Date().toISOString();

  const { data: row, error: fetchErr } = await sb
    .from("content_publish_queue")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.status !== "failed") {
    return NextResponse.json({ error: "Only failed rows can be retried" }, { status: 400 });
  }

  const { error: updErr } = await sb
    .from("content_publish_queue")
    .update({
      status: "pending",
      scheduled_for: now,
      last_error: null,
    })
    .eq("id", id);

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
