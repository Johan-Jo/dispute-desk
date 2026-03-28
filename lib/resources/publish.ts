import "server-only";

import { getServiceClient } from "@/lib/supabase/server";
import { isResourceHubPillar } from "@/lib/resources/pillars";
import type { HubContentLocale } from "./constants";
import { HUB_CONTENT_LOCALES } from "./constants";

const REQUIRED = ["title", "slug", "excerpt", "meta_title", "meta_description"] as const;

export function validateLocalizationForPublish(row: {
  title: string;
  slug: string;
  excerpt: string;
  meta_title: string;
  meta_description: string;
  body_json: Record<string, unknown>;
}): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const k of REQUIRED) {
    if (!row[k]?.toString().trim()) errors.push(`missing_${k}`);
  }
  const body = row.body_json;
  if (!body || typeof body !== "object" || Object.keys(body).length === 0) {
    errors.push("missing_body");
  }
  return { ok: errors.length === 0, errors };
}

export async function publishLocalization(id: string): Promise<{ ok: boolean; error?: string }> {
  const sb = getServiceClient();
  const { data: loc, error: le } = await sb
    .from("content_localizations")
    .select("*, content_items(*)")
    .eq("id", id)
    .maybeSingle();
  if (le || !loc) return { ok: false, error: le?.message ?? "not_found" };

  const rawItem = loc.content_items as Record<string, unknown> | Record<string, unknown>[] | null;
  const item = (Array.isArray(rawItem) ? rawItem[0] : rawItem) as Record<string, unknown> | undefined;
  if (!item) return { ok: false, error: "missing_content_item" };
  const pillar = item.primary_pillar;
  if (typeof pillar !== "string" || !isResourceHubPillar(pillar)) {
    return { ok: false, error: "invalid_primary_pillar" };
  }
  const v = validateLocalizationForPublish({
    title: loc.title,
    slug: loc.slug,
    excerpt: loc.excerpt,
    meta_title: loc.meta_title,
    meta_description: loc.meta_description,
    body_json: (loc.body_json as Record<string, unknown>) ?? {},
  });
  if (!v.ok) return { ok: false, error: v.errors.join(",") };

  if (!item.author_id) return { ok: false, error: "missing_author" };
  if (!item.primary_cta_id) return { ok: false, error: "missing_primary_cta" };

  const { count: tagCount } = await sb
    .from("content_item_tags")
    .select("*", { count: "exact", head: true })
    .eq("content_item_id", loc.content_item_id);
  if ((tagCount ?? 0) < 3) return { ok: false, error: "min_3_tags" };

  const now = new Date().toISOString();
  await sb
    .from("content_localizations")
    .update({
      is_published: true,
      publish_at: (loc.publish_at as string | null) ?? now,
      last_updated_at: now,
      updated_at: now,
    })
    .eq("id", id);

  await sb
    .from("content_items")
    .update({
      workflow_status: "published",
      published_at: item.published_at ?? now,
      updated_at: now,
    })
    .eq("id", loc.content_item_id);

  await sb.from("content_revisions").insert({
    content_item_id: loc.content_item_id,
    locale: loc.locale,
    snapshot_json: loc as unknown as Record<string, unknown>,
    created_by: "cron",
  });

  return { ok: true };
}

export async function isLaunchCompleteForItem(contentItemId: string): Promise<boolean> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("content_localizations")
    .select("locale, translation_status")
    .eq("content_item_id", contentItemId);

  if (!data?.length) return false;
  for (const loc of HUB_CONTENT_LOCALES) {
    const row = data.find((d) => d.locale === loc);
    if (!row || row.translation_status !== "complete") return false;
  }
  return true;
}

export type HubLocaleString = HubContentLocale;
