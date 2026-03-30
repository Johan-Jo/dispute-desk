import { getServiceClient } from "@/lib/supabase/server";
import type { WorkflowStatus } from "./workflow";
import { assertTransition } from "./workflow";

const sb = () => getServiceClient();

/* ── Dashboard stats ───────────────────────────────────────────────── */

export async function getContentStats() {
  const { data, error } = await sb()
    .from("content_items")
    .select("workflow_status");

  if (error) throw error;
  const rows = data ?? [];

  const published = rows.filter((r) => r.workflow_status === "published").length;
  const scheduled = rows.filter((r) => r.workflow_status === "scheduled").length;
  const inReview = rows.filter(
    (r) =>
      r.workflow_status === "in-editorial-review" ||
      r.workflow_status === "in-legal-review"
  ).length;
  const draft = rows.filter(
    (r) =>
      r.workflow_status === "drafting" ||
      r.workflow_status === "in-translation"
  ).length;

  return { published, scheduled, inReview, draft, total: rows.length };
}

/* ── Upcoming scheduled ─────────────────────────────────────────────── */

export async function getUpcomingScheduled(limit = 4) {
  const { data, error } = await sb()
    .from("content_publish_queue")
    .select(
      `id, scheduled_for, status,
       content_localizations!inner(
         locale, title,
         content_items!inner(content_type, primary_pillar)
       )`
    )
    .eq("status", "pending")
    .order("scheduled_for", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

/* ── Translation gaps ───────────────────────────────────────────────── */

export async function getTranslationGaps(limit = 5) {
  const { data: items, error } = await sb()
    .from("content_items")
    .select(
      `id, priority,
       content_localizations(locale, title, translation_status)`
    )
    .in("workflow_status", ["published", "scheduled", "approved"])
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) throw error;

  const ALL_LOCALES = ["en-US", "de-DE", "fr-FR", "es-ES", "pt-BR", "sv-SE"];
  const gaps: Array<{
    contentItemId: string;
    title: string;
    missingLocales: string[];
    priority: string;
  }> = [];

  for (const item of items ?? []) {
    const locs = (item as Record<string, unknown>).content_localizations as Array<{
      locale: string;
      title: string;
      translation_status: string;
    }>;
    const presentLocales = locs
      .filter((l) => l.translation_status === "complete")
      .map((l) => l.locale);
    const missing = ALL_LOCALES.filter((l) => !presentLocales.includes(l));
    if (missing.length > 0) {
      const enLoc = locs.find((l) => l.locale === "en-US");
      gaps.push({
        contentItemId: item.id as string,
        title: enLoc?.title ?? "(untitled)",
        missingLocales: missing,
        priority: (item.priority as string) ?? "medium",
      });
    }
  }

  return gaps.slice(0, limit);
}

/* ── Recently edited ───────────────────────────────────────────────── */

export async function getRecentlyEdited(limit = 4) {
  const { data, error } = await sb()
    .from("content_items")
    .select(
      `id, content_type, workflow_status, updated_at,
       authors(name),
       content_localizations(locale, title)`
    )
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

/* ── Content list (paginated + filterable) ──────────────────────────── */

export interface ContentListFilters {
  status?: string;
  contentType?: string;
  topic?: string;
  search?: string;
  /** Article language (`content_items.source_locale`). Omit or `"all"` = no filter. */
  locale?: string;
  page?: number;
  pageSize?: number;
}

/** Row shape for admin content list. */
export type ContentListItem = Record<string, unknown> & {
  id: string;
  source_locale?: string | null;
  content_localizations?: Array<{
    locale: string;
    title: string;
    translation_status: string;
  }>;
};

export async function getContentList(filters: ContentListFilters = {}) {
  const { status, contentType, topic, search, locale, page = 1, pageSize = 20 } = filters;

  const articleLangFilterActive = Boolean(locale && locale !== "all");

  let query = sb()
    .from("content_items")
    .select(
      `id, content_type, primary_pillar, topic, workflow_status, priority,
       updated_at, published_at, source_locale,
       authors(name),
       reviewers(name),
       content_localizations(locale, title, translation_status)`,
      { count: "exact" }
    )
    .order("updated_at", { ascending: false });

  if (status && status !== "all") {
    if (status === "in-review") {
      query = query.in("workflow_status", ["in-editorial-review", "in-legal-review"]);
    } else if (status === "draft") {
      query = query.in("workflow_status", ["drafting", "in-translation"]);
    } else {
      query = query.eq("workflow_status", status);
    }
  }

  if (contentType && contentType !== "all") {
    query = query.eq("content_type", contentType);
  }

  if (topic && topic !== "all") {
    query = query.eq("topic", topic);
  }

  if (search) {
    query = query.or(`topic.ilike.%${search}%,primary_pillar.ilike.%${search}%,target_keyword.ilike.%${search}%`);
  }

  if (articleLangFilterActive) {
    query = query.eq("source_locale", locale!);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data, count, error } = await query;
  if (error) throw error;

  const items: ContentListItem[] = (data ?? []) as ContentListItem[];

  return { items, total: count ?? 0, page, pageSize };
}

/* ── Queue items ────────────────────────────────────────────────────── */

export async function getQueueItems(statusFilter?: string) {
  let query = sb()
    .from("content_publish_queue")
    .select(
      `id, scheduled_for, status, last_error, attempts, created_at,
       content_localizations!inner(
         id, content_item_id, locale, title,
         content_items!inner(content_type)
       )`
    )
    .order("scheduled_for", { ascending: false })
    .limit(50);

  if (statusFilter && statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/* ── Backlog items ──────────────────────────────────────────────────── */

export interface BacklogFilters {
  priority?: string;
  status?: string;
  search?: string;
}

export async function getBacklogItems(filters: BacklogFilters = {}) {
  const { priority, status, search } = filters;

  let query = sb()
    .from("content_archive_items")
    .select("*")
    .neq("status", "converted")
    .order("priority_score", { ascending: false });

  if (priority && priority !== "all") {
    if (priority === "high") query = query.gte("priority_score", 70);
    else if (priority === "medium") query = query.gte("priority_score", 40).lt("priority_score", 70);
    else query = query.lt("priority_score", 40);
  }

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  if (search) {
    query = query.or(`proposed_title.ilike.%${search}%,target_keyword.ilike.%${search}%`);
  }

  const { data, error } = await query.limit(200);
  if (error) throw error;
  return data ?? [];
}

/* ── Single content item for editor ─────────────────────────────────── */

export async function getContentForEditor(id: string) {
  const client = sb();
  const [itemRes, locsRes, tagsRes, revisionsRes] = await Promise.all([
    client.from("content_items").select("*, authors(*), reviewers(*)").eq("id", id).maybeSingle(),
    client.from("content_localizations").select("*").eq("content_item_id", id),
    client
      .from("content_item_tags")
      .select("content_tags(id, key)")
      .eq("content_item_id", id),
    client
      .from("content_revisions")
      .select("id, locale, created_by, created_at")
      .eq("content_item_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (itemRes.error) throw itemRes.error;
  if (!itemRes.data) return null;

  if (locsRes.error) throw locsRes.error;
  if (tagsRes.error) throw tagsRes.error;
  if (revisionsRes.error) throw revisionsRes.error;

  return {
    item: itemRes.data,
    localizations: locsRes.data ?? [],
    tags: tagsRes.data ?? [],
    revisions: revisionsRes.data ?? [],
  };
}

/* ── Workflow transition ────────────────────────────────────────────── */

export async function updateWorkflowStatus(
  id: string,
  currentStatus: WorkflowStatus,
  newStatus: WorkflowStatus
) {
  assertTransition(currentStatus, newStatus);

  const updates: Record<string, unknown> = {
    workflow_status: newStatus,
    updated_at: new Date().toISOString(),
  };

  if (newStatus === "published") {
    updates.published_at = new Date().toISOString();
  }

  const { data: updated, error } = await sb()
    .from("content_items")
    .update(updates)
    .eq("id", id)
    .eq("workflow_status", currentStatus)
    .select("id");

  if (error) throw error;
  if (!updated || updated.length === 0) {
    throw new Error(`Workflow transition failed: item ${id} is no longer in "${currentStatus}" status`);
  }
}

/* ── CMS settings ───────────────────────────────────────────────────── */

export async function getCmsSettings() {
  const { data, error } = await sb()
    .from("cms_settings")
    .select("settings_json")
    .eq("id", "singleton")
    .maybeSingle();

  if (error) throw error;
  return (data?.settings_json as Record<string, unknown>) ?? {};
}

export async function updateCmsSettings(settings: Record<string, unknown>) {
  const { error } = await sb()
    .from("cms_settings")
    .update({ settings_json: settings, updated_at: new Date().toISOString() })
    .eq("id", "singleton");

  if (error) throw error;
}

/* ── Generation analytics ────────────────────────────────────────── */

export async function getGenerationStats() {
  const { data: items } = await sb()
    .from("content_items")
    .select("id, generated_at, generation_tokens, workflow_status, rejection_reason, time_to_publish")
    .not("generated_at", "is", null);

  const generated = items ?? [];
  const totalGenerated = generated.length;
  const published = generated.filter((i) => i.workflow_status === "published").length;
  const rejected = generated.filter((i) => !!i.rejection_reason).length;
  const totalTokens = generated.reduce((sum, i) => sum + ((i.generation_tokens as number) ?? 0), 0);

  return {
    totalGenerated,
    published,
    rejected,
    inReview: generated.filter((i) =>
      i.workflow_status === "in-editorial-review" || i.workflow_status === "in-legal-review"
    ).length,
    drafting: generated.filter((i) => i.workflow_status === "drafting").length,
    totalTokens,
    acceptanceRate: totalGenerated > 0 ? Math.round((published / totalGenerated) * 100) : 0,
  };
}
