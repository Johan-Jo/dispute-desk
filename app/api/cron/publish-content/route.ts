import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { publishLocalization } from "@/lib/resources/publish";

const CRON_SECRET = process.env.CRON_SECRET;

async function runPublish(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace("Bearer ", "") ??
    req.nextUrl.searchParams.get("secret");
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();
  const now = new Date().toISOString();

  const { data: due, error } = await sb
    .from("content_publish_queue")
    .select("id, content_localization_id, attempts")
    .eq("status", "pending")
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const row of due ?? []) {
    await sb
      .from("content_publish_queue")
      .update({ status: "processing" })
      .eq("id", row.id);

    const pub = await publishLocalization(row.content_localization_id);

    if (pub.ok) {
      await sb
        .from("content_publish_queue")
        .update({ status: "succeeded", last_error: null })
        .eq("id", row.id);
      results.push({ id: row.id, ok: true });
    } else {
      await sb
        .from("content_publish_queue")
        .update({
          status: "failed",
          last_error: pub.error ?? "unknown",
          attempts: (row.attempts ?? 0) + 1,
        })
        .eq("id", row.id);
      results.push({ id: row.id, ok: false, error: pub.error });
    }
  }

  return NextResponse.json({
    processed: results.length,
    results,
  });
}

/** POST or GET (Vercel Cron uses GET with ?secret=) */
export async function POST(req: NextRequest) {
  return runPublish(req);
}

export async function GET(req: NextRequest) {
  return runPublish(req);
}
