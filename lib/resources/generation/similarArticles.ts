import { getServiceClient } from "@/lib/supabase/server";
import type { GenerationBrief, SimilarContentReference } from "./prompts";
import { extractHeadingsFromMainHtml, extractIntroSnippet } from "./htmlSnippet";

type ContentItemJoin = {
  id: string;
  content_type: string;
  topic: string | null;
  target_keyword: string | null;
  primary_pillar: string;
  workflow_status: string;
};

type LocalizationRow = {
  id: string;
  locale: string;
  title: string;
  slug: string;
  excerpt: string;
  body_json: { mainHtml?: string } | null;
  route_kind: string;
  content_items: ContentItemJoin;
};

function toReference(row: LocalizationRow): SimilarContentReference {
  const mainHtml = row.body_json?.mainHtml ?? "";
  return {
    id: row.id,
    locale: row.locale,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt || null,
    primaryKeyword: row.content_items.target_keyword ?? row.content_items.topic ?? null,
    contentType: row.content_items.content_type,
    headings: mainHtml ? extractHeadingsFromMainHtml(mainHtml) : [],
    introSnippet: mainHtml ? extractIntroSnippet(mainHtml) : null,
  };
}

function scoreRow(brief: GenerationBrief, row: LocalizationRow): number {
  const kw = (brief.targetKeyword ?? "").trim().toLowerCase();
  const ci = row.content_items;
  const title = row.title.toLowerCase();
  const topic = (ci.topic ?? "").toLowerCase();
  const tk = (ci.target_keyword ?? "").toLowerCase();
  const proposedWords = brief.proposedTitle
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);

  let score = 0;
  if (ci.content_type === brief.contentType) score += 3;
  if (ci.primary_pillar === brief.primaryPillar) score += 2;
  if (kw && topic.includes(kw)) score += 4;
  if (kw && tk.includes(kw)) score += 4;
  if (kw && title.includes(kw)) score += 3;
  for (const w of proposedWords) {
    if (title.includes(w)) score += 1;
  }
  return score;
}

/**
 * Fetches a small set of published peer articles to inject into the user prompt.
 * Pragmatic v1: locale + route_kind + scoring over type/pillar/keyword/title overlap (no embeddings).
 */
export async function fetchSimilarPublishedArticles(
  brief: GenerationBrief,
  locale: string,
  routeKind: string
): Promise<SimilarContentReference[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("content_localizations")
    .select(
      `id, locale, title, slug, excerpt, body_json, route_kind,
       content_items!inner (
         id, content_type, topic, target_keyword, primary_pillar, workflow_status
       )`
    )
    .eq("locale", locale)
    .eq("route_kind", routeKind)
    .eq("is_published", true)
    .limit(80);

  if (error || !data?.length) return [];

  const rows = (data as unknown as LocalizationRow[])
    .map((r) => {
      const ci = r.content_items as ContentItemJoin | ContentItemJoin[] | undefined;
      const item = Array.isArray(ci) ? ci[0] : ci;
      if (!item) return null;
      return { ...r, content_items: item };
    })
    .filter((r): r is LocalizationRow => r !== null)
    .filter((r) => r.content_items.workflow_status === "published");

  const scored = rows
    .map((row) => ({ row, score: scoreRow(brief, row) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  if (scored.length > 0) {
    return scored.map(({ row }) => toReference(row));
  }

  const fallbackSameType = rows
    .filter((r) => r.content_items.content_type === brief.contentType)
    .slice(0, 8)
    .map(toReference);
  if (fallbackSameType.length > 0) return fallbackSameType;

  return rows.slice(0, 5).map(toReference);
}
