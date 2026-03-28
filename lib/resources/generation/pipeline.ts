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
import type { GenerationBrief } from "./prompts";
import type { GenerationResult } from "./generate";

export interface PipelineResult {
  contentItemId: string | null;
  results: GenerationResult[];
  error: string | null;
}

export async function buildBriefFromArchive(archiveItemId: string): Promise<GenerationBrief | null> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("content_archive_items")
    .select("*")
    .eq("id", archiveItemId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    archiveItemId: data.id,
    proposedTitle: data.proposed_title,
    contentType: data.content_type,
    primaryPillar: data.primary_pillar,
    targetKeyword: data.target_keyword,
    searchIntent: data.search_intent,
    summary: data.summary,
    notes: data.notes,
    targetLocales: data.target_locale_set?.length > 0
      ? data.target_locale_set
      : ["en-US", "de-DE", "fr-FR", "es-ES", "pt-BR", "sv-SE"],
  };
}

export interface PipelineOptions {
  autopilot?: boolean;
}

export async function runGenerationPipeline(archiveItemId: string, options: PipelineOptions = {}): Promise<PipelineResult> {
  if (!isGenerationEnabled()) {
    return { contentItemId: null, results: [], error: "Generation is not enabled. Set GENERATION_ENABLED=true and OPENAI_API_KEY." };
  }

  const brief = await buildBriefFromArchive(archiveItemId);
  if (!brief) {
    return { contentItemId: null, results: [], error: `Archive item ${archiveItemId} not found` };
  }

  const cmsSettings = await getCmsSettings();
  const resolvedPrompts = resolveGenerationPrompts(cmsSettings);
  const results = await generateAllLocales(brief, resolvedPrompts);
  const sb = getServiceClient();

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

  // Determine workflow status based on content type and autopilot mode
  const initialStatus = options.autopilot ? "published" : (brief.contentType === "legal_update" ? "in_legal_review" : "drafting");

  // Create content_items row (author + CTA + tags satisfy publishLocalization)
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

  // Link archive item to new content item
  await sb
    .from("content_archive_items")
    .update({
      created_from_archive_to_content_item_id: contentItemId,
      status: "converted",
      updated_at: new Date().toISOString(),
    })
    .eq("id", archiveItemId);

  // Map content_type → route_kind for public hub routing
  const ROUTE_KIND_MAP: Record<string, string> = {
    template: "templates",
    case_study: "case-studies",
    glossary_entry: "glossary",
    faq_entry: "glossary",
  };
  const routeKind = ROUTE_KIND_MAP[brief.contentType] ?? "resources";

  // Insert localizations for each successful result
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
    const { error: locError } = await sb
      .from("content_localizations")
      .insert(localizationInserts);
    if (locError) {
      console.error("[generation] Failed to insert localizations:", locError.message);
    }
  }

  // Record revision for generation
  const totalTokens = results.reduce((sum, r) => sum + r.tokensUsed, 0);
  await sb.from("content_revisions").insert({
    content_item_id: contentItemId,
    locale: "en-US",
    created_by: "ai-generation",
    change_summary: `AI-generated from archive item ${archiveItemId}. ${successfulResults.length}/${results.length} locales succeeded. ${totalTokens} tokens used.`,
    tokens_used: totalTokens,
  });

  // Update content_items with generation metadata
  await sb
    .from("content_items")
    .update({
      generated_at: new Date().toISOString(),
      generation_tokens: totalTokens,
    })
    .eq("id", contentItemId);

  // Autopilot: enqueue all localizations for immediate publish
  if (options.autopilot && localizationInserts.length > 0) {
    const { data: locs } = await sb
      .from("content_localizations")
      .select("id")
      .eq("content_item_id", contentItemId);

    if (locs) {
      const now = new Date().toISOString();
      await sb.from("content_publish_queue").insert(
        locs.map((l) => ({
          content_localization_id: l.id,
          scheduled_for: now,
          status: "pending",
        }))
      );
    }
  }

  return { contentItemId, results, error: null };
}
