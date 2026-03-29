import "server-only";

import { getServiceClient } from "@/lib/supabase/server";
import type { HubContentLocale } from "./constants";

export type ContentItemRow = {
  id: string;
  content_type: string;
  primary_pillar: string;
  workflow_status: string;
  featured_image_url: string | null;
  author_id: string | null;
  reviewer_id: string | null;
  published_at: string | null;
};

export type ContentLocalizationRow = {
  id: string;
  content_item_id: string;
  locale: string;
  route_kind: string;
  title: string;
  slug: string;
  excerpt: string;
  body_json: Record<string, unknown>;
  meta_title: string;
  meta_description: string;
  og_title?: string;
  og_description?: string;
  reading_time_minutes: number | null;
  is_published: boolean;
  publish_at: string | null;
  last_updated_at: string | null;
};

export async function listPublishedByRoute(
  routeKind: string,
  locale: HubContentLocale,
  opts?: { pillar?: string; contentType?: string; search?: string; limit?: number; offset?: number }
) {
  const sb = getServiceClient();
  let q = sb
    .from("content_localizations")
    .select(
      "id, content_item_id, locale, route_kind, title, slug, excerpt, body_json, meta_title, meta_description, og_title, og_description, reading_time_minutes, is_published, publish_at, last_updated_at, content_items!inner(id, content_type, primary_pillar, workflow_status, featured_image_url, author_id, reviewer_id, published_at)"
    )
    .eq("route_kind", routeKind)
    .eq("locale", locale)
    .eq("is_published", true)
    .eq("content_items.workflow_status", "published");

  if (opts?.pillar) {
    q = q.eq("content_items.primary_pillar", opts.pillar);
  }
  if (opts?.contentType) {
    q = q.eq("content_items.content_type", opts.contentType);
  }

  if (opts?.search) {
    q = q.or(`title.ilike.%${opts.search}%,excerpt.ilike.%${opts.search}%,slug.ilike.%${opts.search}%`);
  }

  const limit = opts?.limit ?? 24;
  const offset = opts?.offset ?? 0;
  q = q
    .order("publish_at", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  type Row = ContentLocalizationRow & {
    content_items: ContentItemRow | ContentItemRow[];
  };

  return (data ?? []).map((raw: unknown) => {
    const r = raw as Row;
    const item = Array.isArray(r.content_items)
      ? r.content_items[0]
      : r.content_items;
    return { ...r, content_items: item } as ContentLocalizationRow & {
      content_items: ContentItemRow;
    };
  });
}

export async function getPublishedLocalizationBySlug(args: {
  routeKind: string;
  locale: HubContentLocale;
  slug: string;
}) {
  const sb = getServiceClient();
  const { data: loc, error: locErr } = await sb
    .from("content_localizations")
    .select("*")
    .eq("route_kind", args.routeKind)
    .eq("locale", args.locale)
    .eq("slug", args.slug)
    .eq("is_published", true)
    .maybeSingle();

  if (locErr) throw new Error(locErr.message);
  if (!loc) return null;

  const { data: item, error: itemErr } = await sb
    .from("content_items")
    .select("*")
    .eq("id", loc.content_item_id)
    .eq("workflow_status", "published")
    .maybeSingle();

  if (itemErr) throw new Error(itemErr.message);
  if (!item) return null;

  return { item: item as ContentItemRow, localization: loc as ContentLocalizationRow };
}

export async function getRelatedResources(args: {
  routeKind: string;
  locale: HubContentLocale;
  pillar: string;
  excludeItemId: string;
  limit?: number;
}) {
  const sb = getServiceClient();
  const cap = args.limit ?? 2;

  const { data, error } = await sb
    .from("content_localizations")
    .select(
      "id, content_item_id, title, slug, excerpt, reading_time_minutes, content_items!inner(id, content_type, primary_pillar, workflow_status)"
    )
    .eq("route_kind", args.routeKind)
    .eq("locale", args.locale)
    .eq("is_published", true)
    .eq("content_items.workflow_status", "published")
    .eq("content_items.primary_pillar", args.pillar)
    .neq("content_item_id", args.excludeItemId)
    .order("publish_at", { ascending: false, nullsFirst: false })
    .limit(cap);

  if (error) throw new Error(error.message);

  type RelatedRow = {
    id: string;
    content_item_id: string;
    title: string;
    slug: string;
    excerpt: string;
    reading_time_minutes: number | null;
    content_items: { id: string; content_type: string; primary_pillar: string; workflow_status: string } | { id: string; content_type: string; primary_pillar: string; workflow_status: string }[];
  };

  return (data ?? []).map((raw: unknown) => {
    const r = raw as RelatedRow;
    const item = Array.isArray(r.content_items) ? r.content_items[0] : r.content_items;
    return { ...r, content_items: item } as RelatedRow & {
      content_items: { id: string; content_type: string; primary_pillar: string; workflow_status: string };
    };
  });
}
