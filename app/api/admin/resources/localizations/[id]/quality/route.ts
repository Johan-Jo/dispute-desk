/**
 * PATCH /api/admin/resources/localizations/[id]/quality
 *
 * Editorial cleanup tool for the resource hub overhaul (PR 4).
 *
 * Allowlisted fields on `content_localizations`:
 *   - redirect_to_localization_id: string | null
 *       When set, the public route handler 301s to the target row's URL.
 *       The target must exist; setting the row to redirect to itself is
 *       blocked at the DB level. Setting null clears the redirect.
 *   - is_excluded_from_sitemap: boolean
 *       Manual sitemap exclusion. The article remains live; only the
 *       public sitemap omits it.
 *   - quality_status: string | null
 *       One of: published | thin | rewrite_pending | redirected | excluded
 *       (DB CHECK constraint enforces; null clears).
 *
 * Admin session required.
 */
import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ALLOWED_QUALITY_STATUSES = [
  "published",
  "thin",
  "rewrite_pending",
  "redirected",
  "excluded",
] as const;
type QualityStatus = (typeof ALLOWED_QUALITY_STATUSES)[number];

const ALLOWED_MIGRATION_ACTIONS = [
  "keep",
  "expand",
  "merge",
  "redirect",
  "noindex",
  "rewrite_b",
  "rewrite_c",
  "promote_a",
] as const;
type MigrationAction = (typeof ALLOWED_MIGRATION_ACTIONS)[number];

type AllowedField =
  | "redirect_to_localization_id"
  | "is_excluded_from_sitemap"
  | "quality_status"
  | "migration_action";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing localization id" }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Partial<Record<AllowedField, unknown>> = {};

  if ("redirect_to_localization_id" in body) {
    const v = body.redirect_to_localization_id;
    if (v !== null && typeof v !== "string") {
      return NextResponse.json(
        { error: "redirect_to_localization_id must be a string UUID or null" },
        { status: 400 }
      );
    }
    if (typeof v === "string" && v === id) {
      return NextResponse.json(
        { error: "A localization cannot redirect to itself" },
        { status: 400 }
      );
    }
    updates.redirect_to_localization_id = v;
  }

  if ("is_excluded_from_sitemap" in body) {
    if (typeof body.is_excluded_from_sitemap !== "boolean") {
      return NextResponse.json(
        { error: "is_excluded_from_sitemap must be a boolean" },
        { status: 400 }
      );
    }
    updates.is_excluded_from_sitemap = body.is_excluded_from_sitemap;
  }

  if ("quality_status" in body) {
    const v = body.quality_status;
    if (v !== null && (typeof v !== "string" || !ALLOWED_QUALITY_STATUSES.includes(v as QualityStatus))) {
      return NextResponse.json(
        {
          error: `quality_status must be one of: ${ALLOWED_QUALITY_STATUSES.join(", ")} or null`,
        },
        { status: 400 }
      );
    }
    updates.quality_status = v;
  }

  if ("migration_action" in body) {
    const v = body.migration_action;
    if (v !== null && (typeof v !== "string" || !ALLOWED_MIGRATION_ACTIONS.includes(v as MigrationAction))) {
      return NextResponse.json(
        {
          error: `migration_action must be one of: ${ALLOWED_MIGRATION_ACTIONS.join(", ")} or null`,
        },
        { status: 400 }
      );
    }
    updates.migration_action = v;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      {
        error:
          "No recognised fields. Allowed: redirect_to_localization_id, is_excluded_from_sitemap, quality_status, migration_action",
      },
      { status: 400 }
    );
  }

  const sb = getServiceClient();

  // If a redirect target is supplied, validate it exists and is not itself a redirect.
  if (typeof updates.redirect_to_localization_id === "string") {
    const { data: target, error: targetErr } = await sb
      .from("content_localizations")
      .select("id, redirect_to_localization_id, is_published")
      .eq("id", updates.redirect_to_localization_id)
      .maybeSingle();

    if (targetErr) {
      return NextResponse.json({ error: targetErr.message }, { status: 500 });
    }
    if (!target) {
      return NextResponse.json(
        { error: "Redirect target localization not found" },
        { status: 400 }
      );
    }
    if (target.redirect_to_localization_id) {
      return NextResponse.json(
        { error: "Redirect target itself has a redirect set — chains are not allowed" },
        { status: 400 }
      );
    }
    if (!target.is_published) {
      return NextResponse.json(
        { error: "Redirect target localization is not published" },
        { status: 400 }
      );
    }
  }

  const { error } = await sb
    .from("content_localizations")
    .update({ ...updates, last_updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updates });
}
