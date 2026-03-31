/**
 * PATCH /api/admin/resources/content-items/[id]
 *
 * Updates editorial SEO fields on a content item. Allowlisted fields only:
 *   - is_hub_article: boolean — marks this as the cluster hub/pillar article
 *   - curated_related_ids: string[] — ordered content_item IDs for the Related
 *       Resources section. Backend validates each ID is published before render;
 *       unresolved IDs are silently dropped. Never used for inline body links.
 *   - publish_priority: number — sort weight in hub listings (9999 = appears first)
 *
 * Admin session required.
 */
import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ALLOWED_FIELDS = ["is_hub_article", "curated_related_ids", "publish_priority"] as const;
type AllowedField = (typeof ALLOWED_FIELDS)[number];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Build update payload from allowlist only
  const updates: Partial<Record<AllowedField, unknown>> = {};

  if ("is_hub_article" in body) {
    if (typeof body.is_hub_article !== "boolean") {
      return NextResponse.json({ error: "is_hub_article must be a boolean" }, { status: 400 });
    }
    updates.is_hub_article = body.is_hub_article;
  }

  if ("curated_related_ids" in body) {
    const ids = body.curated_related_ids;
    if (
      !Array.isArray(ids) ||
      ids.some((x) => typeof x !== "string")
    ) {
      return NextResponse.json({ error: "curated_related_ids must be a string[]" }, { status: 400 });
    }
    updates.curated_related_ids = ids;
  }

  if ("publish_priority" in body) {
    const p = body.publish_priority;
    if (typeof p !== "number" || !Number.isFinite(p)) {
      return NextResponse.json({ error: "publish_priority must be a number" }, { status: 400 });
    }
    updates.publish_priority = Math.floor(p);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: `No recognised fields. Allowed: ${ALLOWED_FIELDS.join(", ")}` },
      { status: 400 }
    );
  }

  const sb = getServiceClient();
  const { error } = await sb
    .from("content_items")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
