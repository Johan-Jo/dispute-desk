import "server-only";

import { getServiceClient } from "@/lib/supabase/server";
import type { HubContentLocale } from "./constants";

export type ContentItemRow = {
  id: string;
  content_type: string;
  primary_pillar: string;
  workflow_status: string;
  featured_image_url: string | null;
  featured_image_alt: string | null;
  author_id: string | null;
  reviewer_id: string | null;
  published_at: string | null;
  publish_priority: number;
  is_hub_article: boolean;
  curated_related_ids: string[];
  target_keyword: string | null;
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

/** Count published rows for the same filters as `listPublishedByRoute` (for hub pagination). */
export async function countPublishedForRoute(
  routeKind: string,
  locale: HubContentLocale,
  opts?: { pillar?: string; contentType?: string; search?: string },
): Promise<number> {
  const sb = getServiceClient();
  let q = sb
    .from("content_localizations")
    .select("id, content_items!inner(id)", { count: "exact", head: true })
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

  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export type ListPublishedByRouteResult = {
  rows: (ContentLocalizationRow & { content_items: ContentItemRow })[];
  total: number;
};

export async function listPublishedByRoute(
  routeKind: string,
  locale: HubContentLocale,
  opts?: {
    pillar?: string;
    contentType?: string;
    search?: string;
    limit?: number;
    offset?: number;
    /** When true (default), run a matching count query in parallel for pagination. Set false if you already counted. */
    includeTotal?: boolean;
  },
): Promise<ListPublishedByRouteResult> {
  const sb = getServiceClient();
  let q = sb
    .from("content_localizations")
    .select(
      "id, content_item_id, locale, route_kind, title, slug, excerpt, body_json, meta_title, meta_description, og_title, og_description, reading_time_minutes, is_published, publish_at, last_updated_at, content_items!inner(id, content_type, primary_pillar, workflow_status, featured_image_url, featured_image_alt, author_id, reviewer_id, published_at, publish_priority, is_hub_article, curated_related_ids, target_keyword)",
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
    .order("publish_priority", { referencedTable: "content_items", ascending: false, nullsFirst: false })
    .order("publish_at", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  const filterOpts = {
    pillar: opts?.pillar,
    contentType: opts?.contentType,
    search: opts?.search,
  };

  const includeTotal = opts?.includeTotal !== false;

  const [listResult, total] = await Promise.all([
    q,
    includeTotal ? countPublishedForRoute(routeKind, locale, filterOpts) : Promise.resolve(0),
  ]);

  const { data, error } = listResult;
  if (error) throw new Error(error.message);

  type Row = ContentLocalizationRow & {
    content_items: ContentItemRow | ContentItemRow[];
  };

  const rows = (data ?? []).map((raw: unknown) => {
    const r = raw as Row;
    const item = Array.isArray(r.content_items)
      ? r.content_items[0]
      : r.content_items;
    return { ...r, content_items: item } as ContentLocalizationRow & {
      content_items: ContentItemRow;
    };
  });

  return { rows, total };
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

/**
 * Same published article in another hub locale (per-locale slug). Used by marketing language switcher.
 */
export async function getAlternatePublishedResourceSlug(args: {
  fromLocale: HubContentLocale;
  slug: string;
  pillar: string;
  toLocale: HubContentLocale;
}): Promise<{ slug: string; pillar: string } | null> {
  const row = await getPublishedLocalizationBySlug({
    routeKind: "resources",
    locale: args.fromLocale,
    slug: args.slug,
  });
  if (!row || row.item.primary_pillar !== args.pillar) return null;

  const sb = getServiceClient();
  const { data: target, error } = await sb
    .from("content_localizations")
    .select("slug, content_items!inner(primary_pillar, workflow_status)")
    .eq("content_item_id", row.item.id)
    .eq("locale", args.toLocale)
    .eq("route_kind", "resources")
    .eq("is_published", true)
    .maybeSingle();

  if (error || !target) return null;
  const rawItem = target.content_items as
    | { primary_pillar: string; workflow_status: string }
    | { primary_pillar: string; workflow_status: string }[];
  const item = Array.isArray(rawItem) ? rawItem[0] : rawItem;
  if (!item || item.workflow_status !== "published" || item.primary_pillar !== args.pillar) {
    return null;
  }

  return { slug: target.slug, pillar: item.primary_pillar };
}

type RelatedRow = {
  id: string;
  content_item_id: string;
  title: string;
  slug: string;
  excerpt: string;
  reading_time_minutes: number | null;
  content_items:
    | {
        id: string;
        content_type: string;
        primary_pillar: string;
        workflow_status: string;
        featured_image_url: string | null;
        featured_image_alt: string | null;
      }
    | {
        id: string;
        content_type: string;
        primary_pillar: string;
        workflow_status: string;
        featured_image_url: string | null;
        featured_image_alt: string | null;
      }[];
};

function normalizeRelatedRows(data: unknown[]): (RelatedRow & {
  content_items: {
    id: string;
    content_type: string;
    primary_pillar: string;
    workflow_status: string;
    featured_image_url: string | null;
    featured_image_alt: string | null;
  };
})[] {
  return data.map((raw) => {
    const r = raw as RelatedRow;
    const item = Array.isArray(r.content_items) ? r.content_items[0] : r.content_items;
    return { ...r, content_items: item };
  });
}

export async function getRelatedResources(args: {
  routeKind: string;
  locale: HubContentLocale;
  pillar: string;
  excludeItemId: string;
  limit?: number;
  /** Curated content_item IDs from the article's curated_related_ids field.
   *  Each ID is validated against published content before inclusion.
   *  Unresolved IDs are silently dropped. Falls back to pillar-based recency
   *  if curated results are fewer than limit. */
  curatedIds?: string[];
}) {
  const sb = getServiceClient();
  const cap = args.limit ?? 3;
  const SELECT =
    "id, content_item_id, title, slug, excerpt, reading_time_minutes, content_items!inner(id, content_type, primary_pillar, workflow_status, featured_image_url, featured_image_alt)";

  const curated = (args.curatedIds ?? []).filter((id) => id && id !== args.excludeItemId);

  let results: ReturnType<typeof normalizeRelatedRows> = [];

  // Phase 1: resolve curated IDs against published content
  if (curated.length > 0) {
    const { data: curatedData } = await sb
      .from("content_localizations")
      .select(SELECT)
      .eq("route_kind", args.routeKind)
      .eq("locale", args.locale)
      .eq("is_published", true)
      .eq("content_items.workflow_status", "published")
      .in("content_item_id", curated);

    if (curatedData && curatedData.length > 0) {
      // Preserve the curated order from curated_related_ids
      const byItemId = new Map(
        normalizeRelatedRows(curatedData).map((r) => [r.content_item_id, r])
      );
      results = curated
        .map((id) => byItemId.get(id))
        .filter((r): r is NonNullable<typeof r> => r !== undefined)
        .slice(0, cap);
    }
  }

  // Phase 2: pad with pillar-based recency if curated didn't fill the cap
  if (results.length < cap) {
    const excludeIds = [args.excludeItemId, ...results.map((r) => r.content_item_id)];
    const remaining = cap - results.length;

    const { data: fallbackData, error } = await sb
      .from("content_localizations")
      .select(SELECT)
      .eq("route_kind", args.routeKind)
      .eq("locale", args.locale)
      .eq("is_published", true)
      .eq("content_items.workflow_status", "published")
      .eq("content_items.primary_pillar", args.pillar)
      .not("content_item_id", "in", `(${excludeIds.map((id) => `"${id}"`).join(",")})`)
      .order("publish_at", { ascending: false, nullsFirst: false })
      .limit(remaining);

    if (error) throw new Error(error.message);
    results = [...results, ...normalizeRelatedRows(fallbackData ?? [])];
  }

  return results;
}

/** Published article counts per pillar for the hub index sticky row (current locale). */
export async function countPublishedByPillar(
  routeKind: string,
  locale: HubContentLocale
): Promise<Record<string, number>> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("content_localizations")
    .select("content_items!inner(primary_pillar)")
    .eq("route_kind", routeKind)
    .eq("locale", locale)
    .eq("is_published", true)
    .eq("content_items.workflow_status", "published");

  if (error) throw new Error(error.message);

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const raw = (row as { content_items: { primary_pillar: string } | { primary_pillar: string }[] })
      .content_items;
    const pillar = Array.isArray(raw) ? raw[0]?.primary_pillar : raw?.primary_pillar;
    if (pillar) counts[pillar] = (counts[pillar] ?? 0) + 1;
  }
  return counts;
}
