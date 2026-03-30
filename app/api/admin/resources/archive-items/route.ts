/**
 * POST /api/admin/resources/archive-items — create backlog / idea row.
 * DELETE — remove all non-converted archive rows (clears the editorial backlog).
 */
import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { HUB_CONTENT_LOCALES } from "@/lib/resources/constants";
import { isBacklogRankUnavailableError } from "@/lib/resources/isBacklogRankUnavailableError";
import { isResourceHubPillar } from "@/lib/resources/pillars";
import { CONTENT_TYPES, type ContentType } from "@/lib/resources/workflow";

export const dynamic = "force-dynamic";

const ARCHIVE_STATUSES = new Set(["idea", "backlog", "brief_ready"]);

function isContentType(value: string): value is ContentType {
  return (CONTENT_TYPES as readonly string[]).includes(value);
}

export async function POST(req: NextRequest) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const proposed_title =
    typeof body.proposed_title === "string" ? body.proposed_title.trim() : "";
  if (!proposed_title) {
    return NextResponse.json({ error: "proposed_title is required" }, { status: 400 });
  }

  const primary_pillar =
    typeof body.primary_pillar === "string" ? body.primary_pillar.trim() : "chargebacks";
  if (!isResourceHubPillar(primary_pillar)) {
    return NextResponse.json({ error: "Invalid primary_pillar" }, { status: 400 });
  }

  const content_type =
    typeof body.content_type === "string" ? body.content_type.trim() : "cluster_article";
  if (!isContentType(content_type)) {
    return NextResponse.json({ error: "Invalid content_type" }, { status: 400 });
  }

  const status = typeof body.status === "string" ? body.status.trim() : "idea";
  if (!ARCHIVE_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const target_keyword =
    typeof body.target_keyword === "string" && body.target_keyword.trim()
      ? body.target_keyword.trim()
      : null;
  const search_intent =
    typeof body.search_intent === "string" && body.search_intent.trim()
      ? body.search_intent.trim()
      : "informational";
  const summary =
    typeof body.summary === "string" && body.summary.trim() ? body.summary.trim() : null;
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  let priority_score = 55;
  const pr = body.priority_score;
  if (typeof pr === "number" && Number.isFinite(pr)) {
    priority_score = Math.max(0, Math.min(100, Math.round(pr)));
  }

  const sb = getServiceClient();

  const {
    data: maxRow,
    error: maxRankErr,
  } = await sb
    .from("content_archive_items")
    .select("backlog_rank")
    .order("backlog_rank", { ascending: false })
    .limit(1)
    .maybeSingle();

  let backlog_rank: number | undefined;
  if (maxRankErr && isBacklogRankUnavailableError(maxRankErr)) {
    backlog_rank = undefined;
  } else if (maxRankErr) {
    return NextResponse.json({ error: maxRankErr.message }, { status: 500 });
  } else {
    const baseRank =
      typeof maxRow?.backlog_rank === "number" && Number.isFinite(maxRow.backlog_rank)
        ? maxRow.backlog_rank
        : 0;
    backlog_rank = baseRank + 100;
  }

  const baseInsert = {
    proposed_title,
    proposed_slug: null as string | null,
    target_locale_set: [...HUB_CONTENT_LOCALES],
    content_type,
    primary_pillar,
    priority_score,
    target_keyword,
    search_intent,
    summary,
    notes,
    status,
  };

  const insertPayload =
    backlog_rank !== undefined ? { ...baseInsert, backlog_rank } : baseInsert;

  let { data, error } = await sb
    .from("content_archive_items")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error && isBacklogRankUnavailableError(error)) {
    const retry = await sb.from("content_archive_items").insert(baseInsert).select("*").single();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ item: data }, { status: 201 });
}

/**
 * Deletes idea / backlog / brief_ready (anything except converted). Converted rows are kept for traceability.
 */
export async function DELETE() {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("content_archive_items")
    .delete()
    .neq("status", "converted")
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: data?.length ?? 0 });
}
