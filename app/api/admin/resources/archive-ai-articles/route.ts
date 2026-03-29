/**
 * POST /api/admin/resources/archive-ai-articles
 *
 * Archives all AI-generated content items and resets their source archive items
 * back to `backlog` so autopilot can regenerate them cleanly.
 *
 * Accepts an optional JSON body:
 *   { onlyStatuses?: string[] }   — default: ["published","scheduled","approved","in-editorial-review","drafting"]
 *   { dryRun?: boolean }          — if true, returns counts without making changes
 *
 * Safe to call multiple times — already-archived items are excluded by the status filter.
 */
import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DEFAULT_STATUSES = ["published", "scheduled", "approved", "in-editorial-review", "drafting"];

export async function POST(req: NextRequest) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  const statuses =
    Array.isArray(body.onlyStatuses) && body.onlyStatuses.length > 0
      ? (body.onlyStatuses as string[])
      : DEFAULT_STATUSES;

  const dryRun = body.dryRun === true;

  const sb = getServiceClient();

  // 1. Find all AI-generated items in the target statuses.
  const { data: items, error: itemsErr } = await sb
    .from("content_items")
    .select("id, workflow_status")
    .not("generated_at", "is", null)
    .in("workflow_status", statuses);

  if (itemsErr) {
    return NextResponse.json({ error: itemsErr.message }, { status: 500 });
  }

  const ids = (items ?? []).map((r) => r.id);

  if (ids.length === 0) {
    return NextResponse.json({ ok: true, dryRun, found: 0, archived: 0, resetArchiveItems: 0 });
  }

  if (dryRun) {
    // Count how many archive items would be reset.
    const { count } = await sb
      .from("content_archive_items")
      .select("id", { count: "exact", head: true })
      .in("created_from_archive_to_content_item_id", ids);

    return NextResponse.json({
      ok: true,
      dryRun: true,
      found: ids.length,
      wouldArchive: ids.length,
      wouldResetArchiveItems: count ?? 0,
      statuses,
    });
  }

  // 2. Archive all matching content items.
  const now = new Date().toISOString();
  const { error: archiveErr } = await sb
    .from("content_items")
    .update({ workflow_status: "archived", updated_at: now })
    .in("id", ids);

  if (archiveErr) {
    return NextResponse.json({ error: `archive_items: ${archiveErr.message}` }, { status: 500 });
  }

  // 3. Reset archive items so autopilot can pick them up again.
  const { data: resetRows, error: resetErr } = await sb
    .from("content_archive_items")
    .update({
      created_from_archive_to_content_item_id: null,
      status: "backlog",
      updated_at: now,
    })
    .in("created_from_archive_to_content_item_id", ids)
    .select("id");

  if (resetErr) {
    console.error("[archive-ai-articles] Failed to reset archive items:", resetErr.message);
  }

  return NextResponse.json({
    ok: true,
    dryRun: false,
    found: ids.length,
    archived: ids.length,
    resetArchiveItems: resetRows?.length ?? 0,
    statuses,
  });
}
