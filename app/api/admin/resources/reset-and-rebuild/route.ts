/**
 * POST /api/admin/resources/reset-and-rebuild
 *
 * Archives AI content items, deletes publish-queue rows for their localizations,
 * and resets linked archive items to backlog (priority 9999) for autopilot regeneration.
 *
 * Body: { ids: string[] } OR { all: true }; optional { dryRun: true }
 */
import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const LIVE_STATUSES = ["published", "scheduled", "approved", "in-editorial-review", "drafting"];

export async function POST(req: NextRequest) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const dryRun = body.dryRun === true;
  const all = body.all === true;
  const rawIds = Array.isArray(body.ids) ? body.ids : [];
  const idsFromBody = rawIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0);

  if (!all && idsFromBody.length === 0) {
    return NextResponse.json(
      { error: "Provide { ids: string[] } with at least one id, or { all: true }" },
      { status: 400 }
    );
  }

  if (all && idsFromBody.length > 0) {
    return NextResponse.json(
      { error: "Use either { all: true } or { ids: [...] }, not both" },
      { status: 400 }
    );
  }

  const sb = getServiceClient();

  let targetIds: string[] = [];
  let skippedRequestedIds: string[] = [];

  if (idsFromBody.length > 0) {
    const { data: rows, error } = await sb
      .from("content_items")
      .select("id")
      .in("id", idsFromBody)
      .not("generated_at", "is", null)
      .neq("workflow_status", "archived");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    targetIds = (rows ?? []).map((r) => r.id);
    skippedRequestedIds = idsFromBody.filter((id) => !targetIds.includes(id));

    if (targetIds.length === 0) {
      return NextResponse.json(
        {
          error:
            "No matching AI-generated, non-archived items. Only items with generated_at set can be reset for archive regeneration.",
          requested: idsFromBody.length,
          skippedRequestedIds,
        },
        { status: 400 }
      );
    }
  } else {
    const { data: items, error: itemsErr } = await sb
      .from("content_items")
      .select("id")
      .not("generated_at", "is", null)
      .in("workflow_status", LIVE_STATUSES);

    if (itemsErr) {
      return NextResponse.json({ error: itemsErr.message }, { status: 500 });
    }
    targetIds = (items ?? []).map((r) => r.id);
  }

  if (targetIds.length === 0) {
    return NextResponse.json({
      ok: true,
      dryRun,
      mode: all ? "all" : "ids",
      found: 0,
      archived: 0,
      queueRowsDeleted: 0,
      resetArchiveItems: 0,
      skippedRequestedIds: idsFromBody.length ? skippedRequestedIds : undefined,
    });
  }

  const { data: locRows, error: locErr } = await sb
    .from("content_localizations")
    .select("id")
    .in("content_item_id", targetIds);

  if (locErr) {
    return NextResponse.json({ error: locErr.message }, { status: 500 });
  }

  const localizationIds = (locRows ?? []).map((r) => r.id);

  let queueCount = 0;
  if (localizationIds.length > 0) {
    const { count } = await sb
      .from("content_publish_queue")
      .select("id", { count: "exact", head: true })
      .in("content_localization_id", localizationIds);
    queueCount = count ?? 0;
  }

  const { count: archiveResetCount } = await sb
    .from("content_archive_items")
    .select("id", { count: "exact", head: true })
    .in("created_from_archive_to_content_item_id", targetIds);

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      mode: all ? "all" : "ids",
      found: targetIds.length,
      wouldArchive: targetIds.length,
      wouldDeleteQueueRows: queueCount,
      wouldResetArchiveItems: archiveResetCount ?? 0,
      contentItemIds: targetIds,
      skippedRequestedIds: skippedRequestedIds.length > 0 ? skippedRequestedIds : undefined,
    });
  }

  if (localizationIds.length > 0) {
    const { error: qDelErr } = await sb
      .from("content_publish_queue")
      .delete()
      .in("content_localization_id", localizationIds);

    if (qDelErr) {
      return NextResponse.json({ error: `publish_queue_delete: ${qDelErr.message}` }, { status: 500 });
    }
  }

  const now = new Date().toISOString();
  const { error: archiveErr } = await sb
    .from("content_items")
    .update({ workflow_status: "archived", updated_at: now })
    .in("id", targetIds);

  if (archiveErr) {
    return NextResponse.json({ error: `archive_items: ${archiveErr.message}` }, { status: 500 });
  }

  const { data: resetRows, error: resetErr } = await sb
    .from("content_archive_items")
    .update({
      created_from_archive_to_content_item_id: null,
      status: "backlog",
      priority_score: 9999,
      updated_at: now,
    })
    .in("created_from_archive_to_content_item_id", targetIds)
    .select("id");

  if (resetErr) {
    return NextResponse.json(
      {
        error: `reset_archive_items: ${resetErr.message}`,
        partial: true,
        archived: targetIds.length,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    dryRun: false,
    mode: all ? "all" : "ids",
    found: targetIds.length,
    archived: targetIds.length,
    queueRowsDeleted: queueCount,
    resetArchiveItems: resetRows?.length ?? 0,
    contentItemIds: targetIds,
    skippedRequestedIds: skippedRequestedIds.length > 0 ? skippedRequestedIds : undefined,
  });
}
