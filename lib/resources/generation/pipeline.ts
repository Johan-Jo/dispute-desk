/**
 * Generation pipeline orchestrator.
 * archive item → brief → AI generation → content_items + localizations.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { getCmsSettings } from "@/lib/resources/admin-queries";
import { resolvePrimaryPillarForGeneration } from "@/lib/resources/pillars";
import { ensurePublishPrerequisites } from "./publishPrerequisites";
import { generateAllLocales, isGenerationEnabled } from "./generate";
import { submitBacklogBatch } from "./batchExpand";
import { resolveGenerationPrompts } from "./prompts";
import type { GenerationBrief, GenerationContext } from "./prompts";
import type { GenerationResult } from "./generate";
import { routeKindForContentType } from "./contentRouteKind";
import {
  autopilotInitialWorkflowStatus,
  shouldSkipAutopilotPublish,
} from "./tierAutopilotPolicy";
import { shouldHoldForIncompleteLocales } from "./localeCompleteness";
import { fetchSimilarPublishedArticles } from "./similarArticles";
import {
  drainPublishQueueAfterAutopilotEnqueue,
  publishQueuedRowsForLocalizationIds,
  type PublishQueueTickResult,
} from "@/lib/resources/cron/publishQueueTick";
import { estimateReadingTimeMinutes } from "@/lib/resources/readingTime";
import { sendPartialGenerationAlert } from "@/lib/email/sendPartialGenerationAlert";
import { getPublicSiteBaseUrl } from "@/lib/email/publicSiteUrl";

export interface PipelineResult {
  contentItemId: string | null;
  results: GenerationResult[];
  error: string | null;
  /** Autopilot only: priority publish + optional backlog drain (see `publishQueuedRowsForLocalizationIds` / `drainPublishQueueAfterAutopilotEnqueue`). */
  publishQueueDrain?: PublishQueueTickResult;
}

export type ArchiveLoadResult =
  | { ok: true; brief: GenerationBrief }
  | { ok: false; error: string; linkedContentItemId: string | null };

function parseArchiveNotesBriefFields(notes: string | null | undefined): Partial<
  Pick<GenerationBrief, "pageRole" | "complexity" | "targetWordRange">
> {
  if (!notes?.trim()) return {};
  try {
    const j = JSON.parse(notes) as Record<string, unknown>;
    if (!j || typeof j !== "object") return {};
    const pr = j.page_role ?? j.pageRole;
    const cx = j.complexity;
    const tw = j.target_word_range ?? j.targetWordRange;
    return {
      pageRole: typeof pr === "string" ? pr : undefined,
      complexity: typeof cx === "string" ? cx : undefined,
      targetWordRange: typeof tw === "string" ? tw : undefined,
    };
  } catch {
    return {};
  }
}

export function archiveRowToBrief(data: Record<string, unknown>): GenerationBrief {
  const locs = data.target_locale_set as string[] | undefined;
  const fromNotes = parseArchiveNotesBriefFields((data.notes as string | null) ?? null);
  const pageRoleCol = data.page_role as string | null | undefined;
  const complexityCol = data.complexity as string | null | undefined;
  const targetWordRangeCol = data.target_word_range as string | null | undefined;
  const tierCol = data.tier_override as string | null | undefined;
  const archetypeCol = data.archetype as string | null | undefined;
  const isHubArticle = data.is_hub_article as boolean | null | undefined;

  return {
    archiveItemId: data.id as string,
    proposedTitle: data.proposed_title as string,
    contentType: data.content_type as string,
    pageRole: pageRoleCol ?? fromNotes.pageRole ?? null,
    primaryPillar: data.primary_pillar as string,
    targetKeyword: (data.target_keyword as string | null) ?? null,
    searchIntent: (data.search_intent as string | null) ?? null,
    complexity: complexityCol ?? fromNotes.complexity ?? null,
    targetWordRange: targetWordRangeCol ?? fromNotes.targetWordRange ?? null,
    tier: tierCol ?? null,
    archetype: archetypeCol ?? null,
    isHubArticle: isHubArticle ?? null,
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

/** First target locale that was generated successfully; else first successful locale. */
function resolveSourceLocale(
  brief: GenerationBrief,
  successfulResults: GenerationResult[]
): string | undefined {
  const ok = new Set(
    successfulResults.filter((r) => r.content !== null).map((r) => r.locale)
  );
  for (const loc of brief.targetLocales) {
    if (ok.has(loc)) return loc;
  }
  const first = successfulResults.find((r) => r.content !== null);
  return first?.locale;
}

export async function buildBriefFromArchive(archiveItemId: string): Promise<GenerationBrief | null> {
  const r = await loadArchiveForGeneration(archiveItemId);
  return r.ok ? r.brief : null;
}

export interface PipelineOptions {
  autopilot?: boolean;
  /**
   * When `autopilot` is true: after enqueue, also run global FIFO backlog drain (`drainPublishQueueAfterAutopilotEnqueue`).
   * Default `true` (scheduled cron). Manual admin runs pass `false` so only this article’s locales publish in-request.
   */
  autopilotDrainBacklog?: boolean;
  /**
   * English-first generation. When true, the synchronous request generates and
   * publishes ONLY the source locale (en-US), then submits the remaining target
   * locales to the async Anthropic batch path (drained + published later by the
   * batch-expand cron). This keeps a single article well under Vercel's 300s
   * function limit — generating all 6 locales synchronously was 504-ing, so no
   * article was ever saved. The set this article is responsible for is remembered
   * on `content_archive_items.target_locale_set` (durable post-conversion), so the
   * batch step recovers the missing locales from there. Default off (full sync).
   */
  englishFirstAsyncRest?: boolean;
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

  // English-first: generate + publish only the source locale synchronously and
  // hand the rest to the async batch (see PipelineOptions.englishFirstAsyncRest).
  // `fullTargetLocales` is the set this article must eventually cover; it stays
  // recoverable from content_archive_items.target_locale_set for the batch step.
  const fullTargetLocales = brief.targetLocales;
  const englishFirstSourceLocale = fullTargetLocales[0] ?? "en-US";
  const englishFirst = options.englishFirstAsyncRest === true && fullTargetLocales.length > 1;
  if (englishFirst) {
    brief.targetLocales = [englishFirstSourceLocale];
  }

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

  const failedResults = results.filter((r) => r.content === null);
  if (failedResults.length > 0) {
    const notifyEmail = (cmsSettings.settings_json as Record<string, unknown> | null)?.autopilotNotifyEmail;
    if (typeof notifyEmail === "string" && notifyEmail.trim()) {
      void sendPartialGenerationAlert({
        to: notifyEmail.trim(),
        contentItemId: "pending",
        proposedTitle: brief.proposedTitle,
        succeededLocales: successfulResults.map((r) => r.locale),
        failedLocales: failedResults.map((r) => ({ locale: r.locale, error: r.error ?? null })),
        adminBaseUrl: getPublicSiteBaseUrl(),
      });
    }
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

  // Autopilot must not set "published" until publishLocalization runs; otherwise the admin list
  // shows Published with no date and the hub stays empty if the queue tick fails.
  // PR 5: Tier A on autopilot holds at `in-editorial-review` so admin reviews the
  // pillar before it goes live. tierAutopilotPolicy is the single source of truth.
  const tierSignals = {
    contentType: brief.contentType,
    tier_override: brief.tier ?? null,
    is_hub_article: brief.isHubArticle ?? null,
    autopilot_approved: true, // already passed the picker by the time we land here
  };
  // Partial-locale guard: if any locale was rejected, never auto-publish the
  // successful subset — hold the whole item for human review so a merchant
  // never lands on a half-localized article with a broken language switcher.
  const holdForIncompleteLocales =
    options.autopilot && shouldHoldForIncompleteLocales(results);
  const initialStatus = options.autopilot
    ? holdForIncompleteLocales
      ? "in-editorial-review"
      : autopilotInitialWorkflowStatus(tierSignals)
    : brief.contentType === "legal_update"
      ? "in-legal-review"
      : "drafting";

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
      reading_time_minutes: estimateReadingTimeMinutes(r.content.body_json?.mainHtml),
      translation_status: "complete",
    }));

  if (localizationInserts.length > 0) {
    const { error: locError } = await sb.from("content_localizations").insert(localizationInserts);
    if (locError) {
      console.error("[generation] Failed to insert localizations:", locError.message);
      return { contentItemId, results, error: `Failed to insert localizations: ${locError.message}` };
    }
  }

  // English-first: the remaining target locales are generated off-request by the
  // async Anthropic batch (batch-expand cron drains + publishes each as it lands).
  // Non-blocking: a submit failure leaves the article live in en-US only and is
  // recoverable by re-running the batch-expand submit for this item.
  if (englishFirst) {
    const remainingLocales = fullTargetLocales.filter((l) => l !== englishFirstSourceLocale);
    if (remainingLocales.length > 0) {
      try {
        const submitted = await submitBacklogBatch({
          itemIds: [contentItemId],
          locales: remainingLocales,
          applyGuards: false,
        });
        if (submitted.batchId) {
          // Recorded so the autopilot-batch-drain cron can ingest + publish the
          // remaining locales once the batch ends, then clear this.
          await sb
            .from("content_items")
            .update({ pending_batch_id: submitted.batchId })
            .eq("id", contentItemId);
        }
        console.log(
          `[generation] English-first: submitted batch ${submitted.batchId ?? "(none)"} for ${submitted.requested} locale(s) on ${contentItemId}`
        );
      } catch (e) {
        console.error(
          "[generation] English-first batch submit failed (en-US is live; rest will backfill on retry):",
          e instanceof Error ? e.message : String(e)
        );
      }
    }
  }

  const totalTokens = results.reduce((sum, r) => sum + r.tokensUsed, 0);
  const sourceLocale = resolveSourceLocale(brief, successfulResults);

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
      ...(sourceLocale ? { source_locale: sourceLocale } : {}),
    })
    .eq("id", contentItemId);

  // PR 5: Tier A holds at in-editorial-review — skip publish-queue enqueue so
  // the publish cron does not auto-promote the pillar before a human reviews it.
  // Incomplete locale sets are held the same way (see holdForIncompleteLocales).
  if (options.autopilot && (shouldSkipAutopilotPublish(tierSignals) || holdForIncompleteLocales)) {
    return { contentItemId, results, error: null };
  }

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
        const locIds = locs.map((l) => l.id);
        // Publish this article’s locales first; otherwise FIFO tick may never reach them behind a backlog.
        const priority = await publishQueuedRowsForLocalizationIds(locIds);
        const drainBacklog = options.autopilotDrainBacklog !== false;
        const tail = drainBacklog ? await drainPublishQueueAfterAutopilotEnqueue() : null;
        const tick: PublishQueueTickResult =
          !priority.ok
            ? priority
            : tail && !tail.ok
              ? tail
              : !tail
                ? priority
                : {
                    ok: true,
                    processed: priority.processed + tail.processed,
                    results: [...priority.results, ...tail.results],
                  };
        if (!tick.ok) {
          console.error("[generation] Autopilot publish-queue drain failed:", tick.error);
        } else {
          const failed = tick.results.filter((r) => !r.ok);
          if (failed.length > 0) {
            console.error(
              "[generation] Some publish queue rows failed (first errors):",
              failed.slice(0, 8).map((r) => `${r.id}:${r.error ?? "unknown"}`)
            );
          }
        }
        return { contentItemId, results, error: null, publishQueueDrain: tick };
      }
    }
  }

  return { contentItemId, results, error: null };
}
