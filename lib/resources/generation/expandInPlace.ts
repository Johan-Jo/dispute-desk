/**
 * In-place regeneration of an EXISTING content_item.
 *
 * `runGenerationPipeline` is create-only (it refuses already-converted archive
 * rows and INSERTs a brand-new item). To rebuild a thin/under-tier article to
 * its tier floor without churning its public URLs, this helper:
 *   1. Loads the item's source archive brief (or reconstructs one from the item
 *      + its en-US localization when the archive row is gone).
 *   2. Re-runs `generateAllLocales`. Because the V1 gate is now tier-relative
 *      (see validators.ts), thin drafts hard-fail and the retry loop forces
 *      expansion to the tier floor — no explicit "write more" instruction is
 *      needed beyond the retry hints.
 *   3. UPDATEs existing localizations in place (keeping their slugs, so hreflang
 *      and inbound links stay stable) and INSERTs any missing locales (backfill).
 *
 * Self-collision avoidance: the article's own published localizations are
 * filtered out of the similarity peers, and `isSlugTaken` ignores rows that
 * belong to this same content_item — otherwise the dedup guards would reject
 * the regenerated article as a near-duplicate of its old self.
 */
import { getServiceClient } from "@/lib/supabase/server";
import { getCmsSettings } from "@/lib/resources/admin-queries";
import { resolveGenerationPrompts } from "./prompts";
import type { GenerationBrief, GenerationContext } from "./prompts";
import { generateAllLocales, generateForLocale, isGenerationEnabled } from "./generate";
import { routeKindForContentType } from "./contentRouteKind";
import { fetchSimilarPublishedArticles } from "./similarArticles";
import { estimateReadingTimeMinutes } from "@/lib/resources/readingTime";
import { archiveRowToBrief } from "./pipeline";
import { assessGeneratedSimilarity } from "./similarity";
import { HUB_CONTENT_LOCALES } from "@/lib/resources/constants";

export interface ContentItemRow {
  id: string;
  content_type: string;
  primary_pillar: string;
  target_keyword: string | null;
  search_intent: string | null;
  is_hub_article: boolean | null;
}

export interface ExistingLoc {
  id: string;
  locale: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body_json?: { mainHtml?: string } | null;
}

/** Tier word-count floor (mirrors validators/audit): pillar/hub 3000, cluster/case/legal 1500, else 800. */
export function tierFloorFor(contentType: string, isHubArticle: boolean | null | undefined): number {
  if (isHubArticle || contentType === "pillar_page") return 3000;
  if (["cluster_article", "case_study", "legal_update"].includes(contentType)) return 1500;
  return 800;
}

/**
 * Pure brief reconstruction for items whose source archive row is gone.
 * Exported for unit testing.
 */
export function reconstructBriefFromItem(
  item: ContentItemRow,
  enLoc: ExistingLoc | undefined
): GenerationBrief {
  return {
    archiveItemId: "",
    proposedTitle: enLoc?.title ?? item.target_keyword ?? "Untitled article",
    contentType: item.content_type,
    pageRole: null,
    primaryPillar: item.primary_pillar,
    targetKeyword: item.target_keyword ?? null,
    searchIntent: item.search_intent ?? null,
    complexity: null,
    targetWordRange: null,
    tier: null,
    archetype: null,
    isHubArticle: item.is_hub_article ?? null,
    summary: enLoc?.excerpt ?? null,
    notes: null,
    targetLocales: [...HUB_CONTENT_LOCALES],
  };
}

export interface ExpandLocaleOutcome {
  locale: string;
  status: "updated" | "inserted" | "failed" | "skipped";
  words?: number;
  error?: string | null;
}

export interface ExpandResult {
  contentItemId: string;
  perLocale: ExpandLocaleOutcome[];
  tokensUsed: number;
  error: string | null;
}

export interface ExpandOptions {
  /**
   * When true, publish successful locales (is_published=true, clear thin flags,
   * mark the item published). Default false: hold for human review — the rows
   * are refreshed but stay unpublished/thin-flagged until promoted.
   */
  publish?: boolean;
  /**
   * Restrict regeneration to these locales (default: all HUB_CONTENT_LOCALES).
   * The client paces one locale per call to stay under the OpenAI TPM cap —
   * generating all 6 in one call runs them in parallel and 429s on low tiers.
   */
  locales?: string[];
  /** Single-call generation provider override (A/B). Defaults to env GENERATION_PROVIDER. */
  provider?: "openai" | "claude" | null;
}

function wordCountOf(mainHtml: string | undefined): number {
  if (!mainHtml) return 0;
  return mainHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
}

/** Structural shape of an accepted generation draft (matches GeneratedContent). */
export interface RegenDraft {
  title: string;
  excerpt: string;
  slug: string;
  meta_title: string;
  meta_description: string;
  body_json: { mainHtml?: string; [k: string]: unknown };
}

/**
 * Persist one regenerated locale in place (UPDATE keeping the slug) or backfill
 * (INSERT) a missing one. Shared by the sync drain (regenerateArticleInPlace)
 * and the batch ingest path so both write identically — same publish patch,
 * reading-time recompute, and translation_status. Returns the per-locale outcome.
 */
export async function saveRegeneratedLocale(
  sb: ReturnType<typeof getServiceClient>,
  args: {
    contentItemId: string;
    locale: string;
    content: RegenDraft;
    existingLoc: ExistingLoc | undefined;
    routeKind: string;
    publish: boolean;
    nowIso: string;
  }
): Promise<{ locale: string; status: "updated" | "inserted" | "failed"; words: number; error: string | null }> {
  const { contentItemId, locale, content, existingLoc, routeKind, publish, nowIso } = args;
  const words = wordCountOf(content.body_json?.mainHtml);
  // publish_at must be set whenever we publish — the hub listing sorts by it
  // (nulls last), so a published localization with a null publish_at is invisible
  // on its locale hub. publish.ts sets it on the canonical path; this batch/regen
  // path must too, or non-English locales never surface in the listing.
  const publishPatch = publish
    ? { is_published: true, publish_at: nowIso, quality_status: null, is_excluded_from_sitemap: false, migration_action: null }
    : {};

  if (existingLoc) {
    const { error } = await sb
      .from("content_localizations")
      .update({
        title: content.title,
        excerpt: content.excerpt,
        body_json: content.body_json,
        meta_title: content.meta_title,
        meta_description: content.meta_description,
        reading_time_minutes: estimateReadingTimeMinutes(content.body_json?.mainHtml),
        translation_status: "complete",
        last_updated_at: nowIso,
        updated_at: nowIso,
        ...publishPatch,
      })
      .eq("id", existingLoc.id);
    return { locale, status: error ? "failed" : "updated", words, error: error?.message ?? null };
  }
  const { error } = await sb.from("content_localizations").insert({
    content_item_id: contentItemId,
    locale,
    route_kind: routeKind,
    title: content.title,
    slug: content.slug,
    excerpt: content.excerpt,
    body_json: content.body_json,
    meta_title: content.meta_title,
    meta_description: content.meta_description,
    reading_time_minutes: estimateReadingTimeMinutes(content.body_json?.mainHtml),
    translation_status: "complete",
    is_published: publish === true,
    publish_at: publish === true ? nowIso : null,
    last_updated_at: nowIso,
  });
  return { locale, status: error ? "failed" : "inserted", words, error: error?.message ?? null };
}

export async function regenerateArticleInPlace(
  contentItemId: string,
  opts: ExpandOptions = {}
): Promise<ExpandResult> {
  if (!isGenerationEnabled()) {
    return {
      contentItemId,
      perLocale: [],
      tokensUsed: 0,
      error: "Generation is not enabled. Set GENERATION_ENABLED=true and OPENAI_API_KEY.",
    };
  }

  const sb = getServiceClient();

  const { data: item } = await sb
    .from("content_items")
    .select("id, content_type, primary_pillar, target_keyword, search_intent, is_hub_article")
    .eq("id", contentItemId)
    .maybeSingle();
  if (!item) {
    return { contentItemId, perLocale: [], tokensUsed: 0, error: "content_item not found" };
  }

  const { data: existing } = await sb
    .from("content_localizations")
    .select("id, locale, slug, title, excerpt, body_json")
    .eq("content_item_id", contentItemId);
  const existingLocs = (existing ?? []) as ExistingLoc[];
  const existingByLocale = new Map(existingLocs.map((l) => [l.locale, l]));
  const selfLocIds = new Set(existingLocs.map((l) => l.id));

  // Brief: prefer the source archive row (already-converted, so we read it
  // directly rather than via loadArchiveForGeneration which would reject it).
  let brief: GenerationBrief | null = null;
  const { data: archiveRow } = await sb
    .from("content_archive_items")
    .select("*")
    .eq("created_from_archive_to_content_item_id", contentItemId)
    .maybeSingle();
  if (archiveRow) {
    brief = archiveRowToBrief(archiveRow as Record<string, unknown>);
  } else {
    brief = reconstructBriefFromItem(item as ContentItemRow, existingByLocale.get("en-US"));
  }
  // Regenerate the requested locales (default: all 6, backfilling any missing).
  const requested =
    opts.locales && opts.locales.length > 0
      ? opts.locales.filter((l) => (HUB_CONTENT_LOCALES as readonly string[]).includes(l))
      : [...HUB_CONTENT_LOCALES];
  brief.targetLocales = requested;

  const routeKind = routeKindForContentType(brief.contentType);
  const cmsSettings = await getCmsSettings();
  const resolvedPrompts = resolveGenerationPrompts(cmsSettings);

  const contextByLocale: Record<string, GenerationContext> = {};
  for (const loc of brief.targetLocales) {
    const peers = await fetchSimilarPublishedArticles(brief, loc, routeKind);
    contextByLocale[loc] = { similarArticles: peers.filter((p) => !selfLocIds.has(p.id)) };
  }

  // PRE-FLIGHT DEDUP (cost guard): if a locale's EXISTING article is already a
  // near-duplicate of a published peer (title/title+excerpt Jaccard), the
  // post-generation similarity validator would reject the regeneration anyway —
  // so DON'T pay to generate it. Skip + flag 'merge' for human consolidation.
  // No LLM call, no API cost (Jaccard is deterministic). Locales with no
  // existing row (backfill) can't be pre-checked and fall through to generation.
  const floor = tierFloorFor(brief.contentType, brief.isHubArticle ?? null);
  const skipped: ExpandLocaleOutcome[] = [];
  const atFloorLocales: string[] = [];
  const dupLocales: string[] = [];
  const localesToGenerate: string[] = [];
  for (const loc of brief.targetLocales) {
    const ex = existingByLocale.get(loc);
    const peers = contextByLocale[loc]?.similarArticles ?? [];
    // AT-FLOOR GUARD: never regenerate a locale already at/above its tier floor —
    // protects every caller (drain/client/route) from re-doing fine content even
    // if the selector over-flagged. No LLM call.
    if (ex) {
      const exWords = wordCountOf(ex.body_json?.mainHtml);
      if (exWords >= floor) {
        skipped.push({ locale: loc, status: "skipped", words: exWords, error: `already at floor (${exWords} >= ${floor})` });
        atFloorLocales.push(loc);
        continue;
      }
    }
    // PRE-FLIGHT DEDUP: existing article already a near-duplicate of a published
    // peer → the post-gen similarity validator would reject it; skip + flag merge.
    if (ex && peers.length > 0) {
      const sim = assessGeneratedSimilarity(
        { title: ex.title, excerpt: ex.excerpt ?? "", slug: ex.slug },
        peers,
        false
      );
      if (!sim.ok) {
        skipped.push({ locale: loc, status: "skipped", error: `pre-flight dedup (${sim.reason}): ${sim.detail}` });
        dupLocales.push(loc);
        continue;
      }
    }
    localesToGenerate.push(loc);
  }
  // Clear the flag on already-at-floor locales (done, no action); flag dedup skips
  // 'merge' so the drain stops re-picking them and they surface for consolidation.
  if (atFloorLocales.length > 0) {
    await sb.from("content_localizations").update({ migration_action: null })
      .eq("content_item_id", contentItemId).in("locale", atFloorLocales);
  }
  if (dupLocales.length > 0) {
    await sb.from("content_localizations").update({ migration_action: "merge" })
      .eq("content_item_id", contentItemId).in("locale", dupLocales);
  }
  brief.targetLocales = localesToGenerate;
  if (localesToGenerate.length === 0) {
    return {
      contentItemId,
      perLocale: skipped,
      tokensUsed: 0,
      error: "All requested locales skipped as near-duplicates (flagged merge) — no generation spend.",
    };
  }

  // Slug collision check that ignores this item's own rows.
  const isSlugTaken = async (locale: string, slug: string): Promise<boolean> => {
    const s = slug.trim();
    if (!s) return true;
    const { data } = await sb
      .from("content_localizations")
      .select("id, content_item_id")
      .eq("locale", locale)
      .eq("route_kind", routeKind)
      .eq("slug", s)
      .limit(2);
    return (data ?? []).some((r) => r.content_item_id !== contentItemId);
  };

  const results = await generateAllLocales(brief, resolvedPrompts, {
    contextByLocale,
    isSlugTaken,
    provider: opts.provider ?? null,
    // 3 attempts (initial + 2) balances flaky Sonnet JSON against the 300s
    // function limit; the caller (drain cron / client) re-invokes on any miss.
    maxRetries: 2,
  });

  const perLocale: ExpandLocaleOutcome[] = [];
  let tokensUsed = 0;
  const nowIso = new Date().toISOString();

  for (const r of results) {
    tokensUsed += r.tokensUsed;
    if (!r.content) {
      perLocale.push({ locale: r.locale, status: "failed", error: r.error });
      continue;
    }
    // Keep the existing slug to preserve the public URL + hreflang siblings.
    const outcome = await saveRegeneratedLocale(sb, {
      contentItemId,
      locale: r.locale,
      content: r.content,
      existingLoc: existingByLocale.get(r.locale),
      routeKind,
      publish: opts.publish === true,
      nowIso,
    });
    perLocale.push(outcome);
  }

  await sb.from("content_revisions").insert({
    content_item_id: contentItemId,
    locale: "en-US",
    created_by: "ai-expand-in-place",
    change_summary: `In-place expansion. ${perLocale.filter((p) => p.status !== "failed").length}/${results.length} locales rebuilt. ${tokensUsed} tokens.`,
    tokens_used: tokensUsed,
  });

  await sb
    .from("content_items")
    .update({ generated_at: nowIso, generation_tokens: tokensUsed, updated_at: nowIso })
    .eq("id", contentItemId);

  const allOutcomes = [...perLocale, ...skipped];
  const anyFailed = allOutcomes.some((p) => p.status === "failed");
  return {
    contentItemId,
    perLocale: allOutcomes,
    tokensUsed,
    error: anyFailed ? "One or more locales failed to regenerate (see perLocale)." : null,
  };
}

export interface ComparisonDraft {
  provider: "openai" | "claude";
  title: string | null;
  words: number;
  html: string | null;
  excerpt: string | null;
  tokensUsed: number;
  error: string | null;
}

/**
 * Head-to-head model comparison for ONE locale: runs the EXACT same brief,
 * system prompt, user prompt and peer context through both providers (single
 * attempt each — raw writing, no validator retries, no DB write) so the two
 * drafts can be compared apples-to-apples. The only variable is the model.
 */
export async function generateComparisonForLocale(
  contentItemId: string,
  locale: string
): Promise<{ contentItemId: string; locale: string; drafts: ComparisonDraft[]; error: string | null }> {
  if (!isGenerationEnabled()) {
    return { contentItemId, locale, drafts: [], error: "Generation is not enabled." };
  }
  const sb = getServiceClient();

  const { data: item } = await sb
    .from("content_items")
    .select("id, content_type, primary_pillar, target_keyword, search_intent, is_hub_article")
    .eq("id", contentItemId)
    .maybeSingle();
  if (!item) return { contentItemId, locale, drafts: [], error: "content_item not found" };

  const { data: existing } = await sb
    .from("content_localizations")
    .select("id, locale, slug, title, excerpt, body_json")
    .eq("content_item_id", contentItemId);
  const existingLocs = (existing ?? []) as ExistingLoc[];
  const selfLocIds = new Set(existingLocs.map((l) => l.id));
  const existingByLocale = new Map(existingLocs.map((l) => [l.locale, l]));

  let brief: GenerationBrief | null = null;
  const { data: archiveRow } = await sb
    .from("content_archive_items")
    .select("*")
    .eq("created_from_archive_to_content_item_id", contentItemId)
    .maybeSingle();
  brief = archiveRow
    ? archiveRowToBrief(archiveRow as Record<string, unknown>)
    : reconstructBriefFromItem(item as ContentItemRow, existingByLocale.get("en-US"));
  brief.targetLocales = [locale];

  const routeKind = routeKindForContentType(brief.contentType);
  const resolvedPrompts = resolveGenerationPrompts(await getCmsSettings());
  const peers = await fetchSimilarPublishedArticles(brief, locale, routeKind);
  const ctx: GenerationContext = { similarArticles: peers.filter((p) => !selfLocIds.has(p.id)) };

  const drafts: ComparisonDraft[] = [];
  // Sequential (not parallel) so the two calls never contend on a shared limit.
  for (const provider of ["openai", "claude"] as const) {
    const r = await generateForLocale(brief, locale, resolvedPrompts, ctx, { provider });
    drafts.push({
      provider,
      title: r.content?.title ?? null,
      words: wordCountOf(r.content?.body_json?.mainHtml),
      html: r.content?.body_json?.mainHtml ?? null,
      excerpt: r.content?.excerpt ?? null,
      tokensUsed: r.tokensUsed,
      error: r.error,
    });
  }

  return { contentItemId, locale, drafts, error: null };
}
