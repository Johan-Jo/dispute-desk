/**
 * POST /api/admin/resources/regenerate-with-inline-links
 *
 * Finds published/scheduled AI-generated articles whose body HTML contains
 * internal DisputeDesk anchor tags, archives those content items, and clears
 * the `created_from_archive_to_content_item_id` pointer on their source archive
 * items so autopilot can regenerate them with the updated prompt (no inline links).
 *
 * Safe to run multiple times — items already archived are skipped.
 */
import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Matches any href pointing to the DisputeDesk domain or a relative path that
 *  looks like an internal resource slug link (same logic as the page renderer). */
const INTERNAL_LINK_RE =
  /href\s*=\s*['"](?:https?:\/\/(?:[^'"]*\.)?disputedesk\.app|\/[a-z0-9][a-z0-9-]*)[^'"]*['"]/i;

export async function POST() {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();

  // 1. Load all AI-generated content items that are still live.
  const { data: items, error: itemsErr } = await sb
    .from("content_items")
    .select("id, workflow_status, generated_at")
    .not("generated_at", "is", null)
    .in("workflow_status", ["published", "scheduled", "approved", "in-editorial-review", "drafting"]);

  if (itemsErr) {
    return NextResponse.json({ error: itemsErr.message }, { status: 500 });
  }

  const candidates: string[] = [];

  // 2. Check each item's English localization for inline links.
  for (const item of items ?? []) {
    const { data: loc } = await sb
      .from("content_localizations")
      .select("body_json")
      .eq("content_item_id", item.id)
      .eq("locale", "en-US")
      .maybeSingle();

    if (!loc?.body_json) continue;
    const mainHtml =
      typeof (loc.body_json as Record<string, unknown>).mainHtml === "string"
        ? ((loc.body_json as Record<string, unknown>).mainHtml as string)
        : "";

    if (INTERNAL_LINK_RE.test(mainHtml)) {
      candidates.push(item.id);
    }
  }

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, archived: 0, resetArchiveItems: 0, candidates: 0 });
  }

  // 3. Archive the content items.
  const now = new Date().toISOString();
  const { error: archiveErr } = await sb
    .from("content_items")
    .update({ workflow_status: "archived", updated_at: now })
    .in("id", candidates);

  if (archiveErr) {
    return NextResponse.json({ error: `archive: ${archiveErr.message}` }, { status: 500 });
  }

  // 4. Clear the back-pointer on archive items so autopilot can regenerate them.
  //    Bump priority_score high so they're picked before other backlog items.
  const { data: resetRows, error: resetErr } = await sb
    .from("content_archive_items")
    .update({
      created_from_archive_to_content_item_id: null,
      status: "backlog",
      priority_score: 9999,
      updated_at: now,
    })
    .in("created_from_archive_to_content_item_id", candidates)
    .select("id");

  if (resetErr) {
    // Non-fatal: items are archived, worst case autopilot picks a different topic.
    console.error("[regenerate] Failed to reset archive items:", resetErr.message);
  }

  return NextResponse.json({
    ok: true,
    candidates: candidates.length,
    archived: candidates.length,
    resetArchiveItems: resetRows?.length ?? 0,
    archivedItemIds: candidates,
  });
}
