/**
 * POST /api/admin/resources/archive-items/reorder
 * Persist backlog row order (backlog_rank).
 */
import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { isBacklogRankUnavailableError } from "@/lib/resources/isBacklogRankUnavailableError";

export const dynamic = "force-dynamic";

const MAX_IDS = 300;

export async function POST(req: NextRequest) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orderedIds = (body as { orderedIds?: unknown })?.orderedIds;
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return NextResponse.json({ error: "orderedIds must be a non-empty array" }, { status: 400 });
  }
  if (orderedIds.length > MAX_IDS) {
    return NextResponse.json({ error: `At most ${MAX_IDS} ids` }, { status: 400 });
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const x of orderedIds) {
    if (typeof x !== "string" || !x.trim()) {
      return NextResponse.json({ error: "Each orderedIds entry must be a non-empty string" }, { status: 400 });
    }
    const id = x.trim();
    if (seen.has(id)) {
      return NextResponse.json({ error: "Duplicate id in orderedIds" }, { status: 400 });
    }
    seen.add(id);
    ids.push(id);
  }

  const sb = getServiceClient();
  const updates = ids.map((id, index) =>
    sb
      .from("content_archive_items")
      .update({ backlog_rank: index * 100, updated_at: new Date().toISOString() })
      .eq("id", id),
  );

  const results = await Promise.all(updates);
  const firstErr = results.find((r) => r.error);
  if (firstErr?.error) {
    if (isBacklogRankUnavailableError(firstErr.error)) {
      return NextResponse.json(
        {
          error:
            "Queue ordering needs DB migration 20260330180000_content_archive_backlog_rank.sql (column backlog_rank). Run npm run db:migrate.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: firstErr.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: ids.length });
}
