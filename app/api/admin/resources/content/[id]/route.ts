import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { getContentForEditor, updateWorkflowStatus } from "@/lib/resources/admin-queries";
import { getServiceClient } from "@/lib/supabase/server";
import { isResourceHubPillar } from "@/lib/resources/pillars";
import { HUB_CONTENT_LOCALES } from "@/lib/resources/constants";
import type { HubContentLocale } from "@/lib/resources/constants";
import { isWorkflowStatus } from "@/lib/resources/workflow";
import type { WorkflowStatus } from "@/lib/resources/workflow";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  try {
    const data = await getContentForEditor(id);
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const sb = getServiceClient();

  try {
    if (body.item) {
      const item = body.item as Record<string, unknown>;
      if (
        item.primary_pillar !== undefined &&
        (typeof item.primary_pillar !== "string" ||
          !isResourceHubPillar(item.primary_pillar))
      ) {
        return NextResponse.json({ error: "Invalid primary_pillar" }, { status: 400 });
      }
      if (item.source_locale !== undefined && item.source_locale !== null) {
        if (
          typeof item.source_locale !== "string" ||
          !HUB_CONTENT_LOCALES.includes(item.source_locale as HubContentLocale)
        ) {
          return NextResponse.json({ error: "Invalid source_locale" }, { status: 400 });
        }
      }
      const allowedFields = [
        "content_type", "primary_pillar", "topic", "target_keyword",
        "search_intent", "priority", "author_id", "reviewer_id", "source_locale",
        "featured_image_url", "featured_image_alt",
      ];
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const key of allowedFields) {
        if (!(key in item)) continue;
        const v = item[key];
        if (key === "featured_image_url" || key === "featured_image_alt") {
          if (v !== null && v !== undefined && typeof v !== "string") {
            return NextResponse.json({ error: `Invalid ${key}` }, { status: 400 });
          }
          updates[key] = v === "" || v === undefined ? null : v;
        } else {
          updates[key] = v;
        }
      }
      const { error } = await sb.from("content_items").update(updates).eq("id", id);
      if (error) throw error;
    }

    if (body.workflowTransition) {
      const { from, to } = body.workflowTransition as { from: string; to: string };
      if (!isWorkflowStatus(from) || !isWorkflowStatus(to)) {
        return NextResponse.json({ error: "Invalid workflow status" }, { status: 400 });
      }
      try {
        await updateWorkflowStatus(id, from as WorkflowStatus, to as WorkflowStatus);
      } catch (wfErr) {
        const msg = wfErr instanceof Error ? wfErr.message : "Workflow transition failed";
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }

    // Upsert localization for a specific locale
    if (body.localization) {
      const loc = body.localization as {
        locale: string;
        title?: string;
        excerpt?: string;
        slug?: string;
        body_json?: Record<string, unknown>;
        meta_title?: string;
        meta_description?: string;
        translation_status?: string;
      };

      const upsertData: Record<string, unknown> = {
        content_item_id: id,
        locale: loc.locale,
        updated_at: new Date().toISOString(),
      };

      if (loc.title !== undefined) upsertData.title = loc.title;
      if (loc.excerpt !== undefined) upsertData.excerpt = loc.excerpt;
      if (loc.slug !== undefined) upsertData.slug = loc.slug;
      if (loc.body_json !== undefined) upsertData.body_json = loc.body_json;
      if (loc.meta_title !== undefined) upsertData.meta_title = loc.meta_title;
      if (loc.meta_description !== undefined) upsertData.meta_description = loc.meta_description;
      if (loc.translation_status !== undefined) upsertData.translation_status = loc.translation_status;

      const { error } = await sb
        .from("content_localizations")
        .upsert(upsertData, { onConflict: "content_item_id,locale" });
      if (error) throw error;
    }

    if (body.schedule) {
      const { localizationId, scheduledFor } = body.schedule as {
        localizationId: string;
        scheduledFor: string;
      };

      if (!localizationId || !scheduledFor) {
        return NextResponse.json({ error: "localizationId and scheduledFor are required" }, { status: 400 });
      }

      const { data: ownerCheck } = await sb
        .from("content_localizations")
        .select("id")
        .eq("id", localizationId)
        .eq("content_item_id", id)
        .maybeSingle();
      if (!ownerCheck) {
        return NextResponse.json({ error: "Localization does not belong to this content item" }, { status: 400 });
      }

      const { error } = await sb.from("content_publish_queue").upsert(
        {
          content_localization_id: localizationId,
          scheduled_for: scheduledFor,
          status: "pending",
        },
        { onConflict: "content_localization_id" }
      );
      if (error) throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
