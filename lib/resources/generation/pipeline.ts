/**
 * Generation pipeline orchestrator.
 * archive item → brief → AI generation → content_items + localizations.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { getCmsSettings } from "@/lib/resources/admin-queries";
import { resolvePrimaryPillarForGeneration } from "@/lib/resources/pillars";
import { ensurePublishPrerequisites } from "./publishPrerequisites";
import { generateAllLocales, isGenerationEnabled } from "./generate";
import { resolveGenerationPrompts } from "./prompts";
import type { GenerationBrief, GenerationContext } from "./prompts";
import type { GenerationResult } from "./generate";
import { routeKindForContentType } from "./contentRouteKind";
import { fetchSimilarPublishedArticles } from "./similarArticles";
import { executePublishQueueTick } from "@/lib/resources/cron/publishQueueTick";

export interface PipelineResult {
  contentItemId: string | null;
  results: GenerationResult[];
  error: string | null;
}

export type ArchiveLoadResult =
  | { ok: true; brief: GenerationBrief }
  | { ok: false; error: string; linkedContentItemId: string | null };

function archiveRowToBrief(data: Record<string, unknown>): GenerationBrief {
  const locs = data.target_locale_set as string[] | undefined;
  return {
    archiveItemId: data.id as string,
    proposedTitle: data.proposed_title as string,
    contentType: data.content_type as string,
    primaryPillar: data.primary_pillar as string,
    targetKeyword: (data.target_keyword as string | null) ?? null,
    searchIntent: (data.search_intent as string | null) ?? null,
    summary: (data.summary as string | null) ?? null,
    notes: (data.notes as string | null) ?? null,
    targetLocales: locs && locs.length > 0 ? locs : ["en-US", "de-DE", "fr-FR", "es-ES", "pt-BR", "sv-SE"],
  };
}

/** Single fetch: not found, already linked to content, or OK brief. */
export async function loadArchiveForGeneration(archiveItemId: string): Promise<ArchiveLoadResult> {
  const sb = getServiceClient();
  const { data, error } = await sb.from("content_archive_items").select("*").eq("id", archiveItemId).maybeSingle();

  if (error || !data) {
    return { ok: false, error: `Archive item ${archiveItemId} not found`, linkedContentItemId: null };
  }
  if (data.created_from_archive_to_content_item_id) {
    return {
      ok: false,
      error: `Archive item already converted to content item ${data.created_from_archive_to_content_item_id}.`,
      linkedContentItemId: data.created_from_archive_to_content_item_id as string,
    };
  }
  return { ok: true, brief: archiveRowToBrief(data as Record<string, unknown>) };
}

export async function buildBriefFromArchive(archiveItemId: string): Promise<GenerationBrief | null> {
  const r = await loadArchiveForGeneration(archiveItemId);
  return r.ok ? r.brief : null;
}

export interface PipelineOptions {
  autopilot?: boolean;
}

export async function runGenerationPipeline(archiveItemId: string, options: PipelineOptions = {}): Promise<PipelineResult> {
  if (!isGenerationEnabled()) {
    return { contentItemId: null, results: [], error: "Generation is not enabled. Set GENERATION_ENABLED=true and OPENAI_API_KEY." };
  }

  const loaded = await loadArchiveForGeneration(archiveItemId);
  if (!loaded.ok) {
    return {
      contentItemId: loaded.linkedContentItemId,
      results: [],
      error: loaded.error,
    };
  }

  const brief = loaded.brief;
  const routeKind = routeKindForContentType(brief.contentType);
  const cmsSettings = await getCmsSettings();
  const resolvedPrompts = resolveGenerationPrompts(cmsSettings);

  const contextByLocale: Record<string, GenerationContext> = {};
  for (const loc of brief.targetLocales) {
    const similarArticles = await fetchSimilarPublishedArticles(brief, loc, routeKind);
    contextByLocale[loc] = { similarArticles };
  }

  const sb = getServiceClient();

  const isSlugTaken = async (locale: string, slug: string): Promise<boolean> => {
    const s = slug.trim();
    if (!s) return true;
    const { data } = await sb
      .from("content_localizations")
      .select("id")
      .eq("locale", locale)
      .eq("route_kind", routeKind)
      .eq("slug", s)
      .limit(1);
    return (data?.length ?? 0) > 0;
  };

  const results = await generateAllLocales(brief, resolvedPrompts, {
    contextByLocale,
    isSlugTaken,
  });

  const successfulResults = results.filter((r) => r.content !== null);
  if (successfulResults.length === 0) {
    const errors = results.map((r) => `${r.locale}: ${r.error}`).join("; ");
    return { contentItemId: null, results, error: `All locale generations failed: ${errors}` };
  }

  const primaryPillar = resolvePrimaryPillarForGeneration({
    primaryPillar: brief.primaryPillar,
    proposedTitle: brief.proposedTitle,
    targetKeyword: brief.targetKeyword,
    summary: brief.summary,
  });

  let publishPrereq: Awaited<ReturnType<typeof ensurePublishPrerequisites>>;
  try {
    publishPrereq = await ensurePublishPrerequisites();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { contentItemId: null, results, error: `Publish prerequisites failed: ${msg}` };
  }

  const initialStatus = options.autopilot ? "published" : brief.contentType === "legal_update" ? "in-legal-review" : "drafting";

  const { data: newItem, error: itemError } = await sb
    .from("content_items")
    .insert({
      content_type: brief.contentType,
      primary_pillar: primaryPillar,
      topic: brief.targetKeyword,
      target_keyword: brief.targetKeyword,
      search_intent: brief.searchIntent,
      priority: "medium",
      workflow_status: initialStatus,
      generated_at: new Date().toISOString(),
      author_id: publishPrereq.authorId,
      primary_cta_id: publishPrereq.primaryCtaId,
    })
    .select("id")
    .single();

  if (itemError || !newItem) {
    return { contentItemId: null, results, error: `Failed to create content item: ${itemError?.message}` };
  }

  const contentItemId = newItem.id;

  const tagRows = publishPrereq.tagIds.map((tag_id) => ({ content_item_id: contentItemId, tag_id }));
  const { error: tagErr } = await sb.from("content_item_tags").insert(tagRows);
  if (tagErr) {
    await sb.from("content_items").delete().eq("id", contentItemId);
    return { contentItemId: null, results, error: `Failed to attach tags for publish: ${tagErr.message}` };
  }

  const { error: archiveErr } = await sb
    .from("content_archive_items")
    .update({
      created_from_archive_to_content_item_id: contentItemId,
      status: "converted",
      updated_at: new Date().toISOString(),
    })
    .eq("id", archiveItemId);

  if (archiveErr) {
    console.error("[generation] Failed to mark archive as converted:", archiveErr.message);
  }

  const localizationInserts = successfulResults
    .filter((r): r is GenerationResult & { content: NonNullable<GenerationResult["content"]> } => r.content !== null)
    .map((r) => ({
      content_item_id: contentItemId,
      locale: r.locale,
      route_kind: routeKind,
      title: r.content.title,
      slug: r.content.slug,
      excerpt: r.content.excerpt,
      body_json: r.content.body_json,
      meta_title: r.content.meta_title,
      meta_description: r.content.meta_description,
      translation_status: "complete",
    }));

  if (localizationInserts.length > 0) {
    const { error: locError } = await sb.from("content_localizations").insert(localizationInserts);
    if (locError) {
      console.error("[generation] Failed to insert localizations:", locError.message);
      return { contentItemId, results, error: `Failed to insert localizations: ${locError.message}` };
    }
  }

  const totalTokens = results.reduce((sum, r) => sum + r.tokensUsed, 0);
  await sb.from("content_revisions").insert({
    content_item_id: contentItemId,
    locale: "en-US",
    created_by: "ai-generation",
    change_summary: `AI-generated from archive item ${archiveItemId}. ${successfulResults.length}/${results.length} locales succeeded. ${totalTokens} tokens used.`,
    tokens_used: totalTokens,
  });

  await sb
    .from("content_items")
    .update({
      generated_at: new Date().toISOString(),
      generation_tokens: totalTokens,
    })
    .eq("id", contentItemId);

  if (options.autopilot && localizationInserts.length > 0) {
    const { data: locs } = await sb.from("content_localizations").select("id").eq("content_item_id", contentItemId);

    if (locs?.length) {
      const now = new Date().toISOString();
      const { error: qErr } = await sb.from("content_publish_queue").insert(
        locs.map((l) => ({
          content_localization_id: l.id,
          scheduled_for: now,
          status: "pending",
        }))
      );
      if (qErr) {
        console.error("[generation] Failed to enqueue publish queue:", qErr.message);
      } else {
        // Autopilot used to rely on the next Vercel publish cron; without it, workflow_status is
        // "published" but is_published stays false and published_at stays null — invisible on the hub.
        const tick = await executePublishQueueTick();
        if (!tick.ok) {
          console.error("[generation] Immediate publish-queue tick failed:", tick.error);
        }
      }
    }
  }

  return { contentItemId, results, error: null };
}
