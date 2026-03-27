/**
 * Generation pipeline orchestrator.
 * archive item → brief → AI generation → content_items + localizations.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { generateAllLocales, isGenerationEnabled } from "./generate";
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

export async function runGenerationPipeline(archiveItemId: string): Promise<PipelineResult> {
  if (!isGenerationEnabled()) {
    return { contentItemId: null, results: [], error: "Generation is not enabled. Set GENERATION_ENABLED=true and OPENAI_API_KEY." };
  }

  const brief = await buildBriefFromArchive(archiveItemId);
  if (!brief) {
    return { contentItemId: null, results: [], error: `Archive item ${archiveItemId} not found` };
  }

  const results = await generateAllLocales(brief);
  const sb = getServiceClient();

  const successfulResults = results.filter((r) => r.content !== null);
  if (successfulResults.length === 0) {
    const errors = results.map((r) => `${r.locale}: ${r.error}`).join("; ");
    return { contentItemId: null, results, error: `All locale generations failed: ${errors}` };
  }

  // Determine workflow status based on content type
  const needsLegalReview = brief.contentType === "legal_update";
  const initialStatus = needsLegalReview ? "in_legal_review" : "drafting";

  // Create content_items row
  const { data: newItem, error: itemError } = await sb
    .from("content_items")
    .insert({
      content_type: brief.contentType,
      primary_pillar: brief.primaryPillar,
      topic: brief.targetKeyword,
      target_keyword: brief.targetKeyword,
      search_intent: brief.searchIntent,
      priority: "medium",
      workflow_status: initialStatus,
      generated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (itemError || !newItem) {
    return { contentItemId: null, results, error: `Failed to create content item: ${itemError?.message}` };
  }

  const contentItemId = newItem.id;

  // Link archive item to new content item
  await sb
    .from("content_archive_items")
    .update({
      created_from_archive_to_content_item_id: contentItemId,
      status: "converted",
      updated_at: new Date().toISOString(),
    })
    .eq("id", archiveItemId);

  // Insert localizations for each successful result
  const localizationInserts = successfulResults
    .filter((r): r is GenerationResult & { content: NonNullable<GenerationResult["content"]> } => r.content !== null)
    .map((r) => ({
      content_item_id: contentItemId,
      locale: r.locale,
      title: r.content.title,
      slug: r.content.slug,
      excerpt: r.content.excerpt,
      body_json: r.content.body_json,
      meta_title: r.content.meta_title,
      meta_description: r.content.meta_description,
      translation_status: r.locale === "en-US" ? "source" : "complete",
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

  return { contentItemId, results, error: null };
}
