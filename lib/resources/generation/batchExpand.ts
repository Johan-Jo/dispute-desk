/**
 * Batch-mode in-place expansion of the thin/under-tier Resources Hub backlog.
 *
 * This is the asynchronous, 50%-cheaper counterpart to regenerateArticleInPlace
 * (the synchronous drain). It reuses the EXACT same building blocks so quality
 * is identical to the sync path:
 *   - brief reconstruction (archiveRowToBrief / reconstructBriefFromItem)
 *   - prompt assembly (resolveGenerationPrompts + buildUserPrompt)
 *   - the at-floor + pre-flight dedup cost guards
 *   - the post-generation validators (Jaccard + runAllValidators)
 *   - the shared saveRegeneratedLocale writer (same publish patch / reading time)
 *
 * The ONLY difference is the transport: instead of one synchronous /v1/messages
 * call per locale (with an in-loop retry), we assemble all (item, locale)
 * requests, submit them as a single Anthropic Message Batch, then ingest the
 * results — validating each and re-batching hard-failures with retry feedback.
 *
 * Model: forced to Sonnet (claude-sonnet-4-6) by default — Haiku was rejected
 * on quality/reliability for non-English. Override via opts.model only for tests.
 *
 * custom_id format: `${contentItemId}::${locale}` — self-describing, so ingest
 * needs no side mapping table.
 */
import { getServiceClient } from "@/lib/supabase/server";
import { getCmsSettings } from "@/lib/resources/admin-queries";
import {
  resolveGenerationPrompts,
  buildUserPrompt,
  type GenerationBrief,
  type GenerationContext,
} from "./prompts";
import { routeKindForContentType } from "./contentRouteKind";
import { fetchSimilarPublishedArticles } from "./similarArticles";
import { archiveRowToBrief } from "./pipeline";
import {
  reconstructBriefFromItem,
  tierFloorFor,
  saveRegeneratedLocale,
  type ContentItemRow,
  type ExistingLoc,
  type RegenDraft,
} from "./expandInPlace";
import { assessGeneratedSimilarity, getSimilarityRetryInstruction } from "./similarity";
import {
  runAllValidators,
  hardFailures,
  softFailures,
  formatValidatorRetryFeedback,
  makeOpenAIEmbeddingClient,
  type ValidatorFailure,
} from "./validators";
import { briefToValidatorContext, isGenerationEnabled } from "./generate";
import { HUB_CONTENT_LOCALES } from "@/lib/resources/constants";
import {
  submitBatch,
  extractJsonFromBatchMessage,
  type BatchRequest,
  type BatchResultLine,
} from "./batchClient";

export const DEFAULT_BATCH_MODEL = "claude-sonnet-4-6";
const BATCH_MAX_TOKENS = 24000;

/** custom_id codec — itemId is a UUID (no "::"), so a "::" delimiter is safe. */
export function encodeKey(contentItemId: string, locale: string): string {
  return `${contentItemId}::${locale}`;
}
export function decodeKey(key: string): { contentItemId: string; locale: string } {
  const idx = key.indexOf("::");
  if (idx < 0) return { contentItemId: key, locale: "" };
  return { contentItemId: key.slice(0, idx), locale: key.slice(idx + 2) };
}

function wordCountOf(mainHtml: string | undefined): number {
  if (!mainHtml) return 0;
  return mainHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
}

function embeddingClient() {
  return process.env.GENERATION_EMBEDDINGS_ENABLED === "true"
    ? makeOpenAIEmbeddingClient(process.env.OPENAI_API_KEY)
    : null;
}

interface ItemContext {
  item: ContentItemRow;
  brief: GenerationBrief;
  routeKind: string;
  existingByLocale: Map<string, ExistingLoc>;
  selfLocIds: Set<string>;
  floor: number;
  contextByLocale: Record<string, GenerationContext>;
}

type Sb = ReturnType<typeof getServiceClient>;

/** Load everything needed to build a request OR validate a result for one item. */
async function loadItemContext(
  sb: Sb,
  contentItemId: string,
  locales: string[]
): Promise<ItemContext | null> {
  const { data: item } = await sb
    .from("content_items")
    .select("id, content_type, primary_pillar, target_keyword, search_intent, is_hub_article")
    .eq("id", contentItemId)
    .maybeSingle();
  if (!item) return null;

  const { data: existing } = await sb
    .from("content_localizations")
    .select("id, locale, slug, title, excerpt, body_json")
    .eq("content_item_id", contentItemId);
  const existingLocs = (existing ?? []) as ExistingLoc[];
  const existingByLocale = new Map(existingLocs.map((l) => [l.locale, l]));
  const selfLocIds = new Set(existingLocs.map((l) => l.id));

  const { data: archiveRow } = await sb
    .from("content_archive_items")
    .select("*")
    .eq("created_from_archive_to_content_item_id", contentItemId)
    .maybeSingle();
  const brief: GenerationBrief = archiveRow
    ? archiveRowToBrief(archiveRow as Record<string, unknown>)
    : reconstructBriefFromItem(item as ContentItemRow, existingByLocale.get("en-US"));
  brief.targetLocales = locales;

  const routeKind = routeKindForContentType(brief.contentType);
  const contextByLocale: Record<string, GenerationContext> = {};
  for (const loc of locales) {
    const peers = await fetchSimilarPublishedArticles(brief, loc, routeKind);
    contextByLocale[loc] = { similarArticles: peers.filter((p) => !selfLocIds.has(p.id)) };
  }

  return {
    item: item as ContentItemRow,
    brief,
    routeKind,
    existingByLocale,
    selfLocIds,
    floor: tierFloorFor(brief.contentType, brief.isHubArticle ?? null),
    contextByLocale,
  };
}

/** Resolve the (item -> locales) target map. */
async function resolveTargets(
  sb: Sb,
  opts: { keys?: string[]; itemIds?: string[]; locales?: string[]; limit?: number }
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const allLocales = (opts.locales && opts.locales.length > 0
    ? opts.locales
    : [...HUB_CONTENT_LOCALES]
  ).filter((l) => (HUB_CONTENT_LOCALES as readonly string[]).includes(l));

  if (opts.keys && opts.keys.length > 0) {
    for (const k of opts.keys) {
      const { contentItemId, locale } = decodeKey(k);
      if (!map.has(contentItemId)) map.set(contentItemId, []);
      if (!map.get(contentItemId)!.includes(locale)) map.get(contentItemId)!.push(locale);
    }
    return map;
  }
  if (opts.itemIds && opts.itemIds.length > 0) {
    for (const id of opts.itemIds) map.set(id, [...allLocales]);
    return map;
  }
  // Default: every localization flagged migration_action='expand', grouped by item.
  const { data } = await sb
    .from("content_localizations")
    .select("content_item_id, locale")
    .eq("migration_action", "expand");
  for (const r of (data ?? []) as Array<{ content_item_id: string; locale: string }>) {
    if (opts.locales && !allLocales.includes(r.locale)) continue;
    if (!map.has(r.content_item_id)) map.set(r.content_item_id, []);
    map.get(r.content_item_id)!.push(r.locale);
  }
  if (opts.limit && opts.limit > 0) {
    return new Map([...map.entries()].slice(0, opts.limit));
  }
  return map;
}

export interface BuildBatchOptions {
  /** Restrict to these locales (default: all 6 hub locales). */
  locales?: string[];
  /** Process at most N items (backlog mode only). */
  limit?: number;
  /** Target specific items (× locales). */
  itemIds?: string[];
  /** Target specific item::locale pairs (retry rounds). Skips the cost guards. */
  keys?: string[];
  /** Model id — defaults to Sonnet. */
  model?: string;
  /** Per-custom_id extra instructions to append (retry feedback). */
  extraByKey?: Record<string, string>;
  /** Apply the at-floor + dedup cost guards (default true; false for retry rounds). */
  applyGuards?: boolean;
}

export interface BatchSkip {
  key: string;
  contentItemId: string;
  locale: string;
  reason: string;
}

export interface BuildBatchResult {
  requests: BatchRequest[];
  skipped: BatchSkip[];
  model: string;
  itemCount: number;
}

/**
 * Assemble batch requests for the target set. Applies the same at-floor and
 * pre-flight dedup guards as the sync drain (and the same flag mutations:
 * at-floor → clear, dedup → 'merge') so we never pay to generate content that's
 * already fine or that the similarity validator would reject anyway.
 */
export async function buildBatchRequests(opts: BuildBatchOptions = {}): Promise<BuildBatchResult> {
  if (!isGenerationEnabled()) {
    throw new Error("Generation is not enabled (GENERATION_ENABLED / OPENAI_API_KEY).");
  }
  const sb = getServiceClient();
  const model = opts.model ?? DEFAULT_BATCH_MODEL;
  const applyGuards = opts.applyGuards !== false && !(opts.keys && opts.keys.length > 0);
  const resolvedPrompts = resolveGenerationPrompts(await getCmsSettings());

  const targets = await resolveTargets(sb, opts);
  const requests: BatchRequest[] = [];
  const skipped: BatchSkip[] = [];
  const atFloorByItem = new Map<string, string[]>();
  const dupByItem = new Map<string, string[]>();

  for (const [contentItemId, locales] of targets.entries()) {
    const ctx = await loadItemContext(sb, contentItemId, locales);
    if (!ctx) {
      for (const locale of locales)
        skipped.push({ key: encodeKey(contentItemId, locale), contentItemId, locale, reason: "content_item not found" });
      continue;
    }
    for (const locale of locales) {
      const key = encodeKey(contentItemId, locale);
      const ex = ctx.existingByLocale.get(locale);
      const peers = ctx.contextByLocale[locale]?.similarArticles ?? [];

      if (applyGuards && ex) {
        const exWords = wordCountOf(ex.body_json?.mainHtml);
        if (exWords >= ctx.floor) {
          skipped.push({ key, contentItemId, locale, reason: `already at floor (${exWords} >= ${ctx.floor})` });
          if (!atFloorByItem.has(contentItemId)) atFloorByItem.set(contentItemId, []);
          atFloorByItem.get(contentItemId)!.push(locale);
          continue;
        }
      }
      if (applyGuards && ex && peers.length > 0) {
        const sim = assessGeneratedSimilarity(
          { title: ex.title, excerpt: ex.excerpt ?? "", slug: ex.slug },
          peers,
          false
        );
        if (!sim.ok) {
          skipped.push({ key, contentItemId, locale, reason: `pre-flight dedup (${sim.reason})` });
          if (!dupByItem.has(contentItemId)) dupByItem.set(contentItemId, []);
          dupByItem.get(contentItemId)!.push(locale);
          continue;
        }
      }

      const ctxForLocale = ctx.contextByLocale[locale] ?? { similarArticles: [] };
      let userPrompt = buildUserPrompt(ctx.brief, locale, resolvedPrompts, ctxForLocale);
      const extra = opts.extraByKey?.[key];
      if (extra?.trim()) userPrompt += `\n\n${extra.trim()}`;
      const temperature = ctx.brief.contentType === "legal_update" ? 0.3 : 0.4;
      requests.push({
        custom_id: key,
        params: {
          model,
          max_tokens: BATCH_MAX_TOKENS,
          system: resolvedPrompts.systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          temperature,
        },
      });
    }
  }

  // Flag mutations for skipped locales (mirror the sync drain): at-floor → clear,
  // dedup → 'merge' so the backlog selector stops re-picking them.
  for (const [itemId, locs] of atFloorByItem.entries()) {
    await sb.from("content_localizations").update({ migration_action: null })
      .eq("content_item_id", itemId).in("locale", locs);
  }
  for (const [itemId, locs] of dupByItem.entries()) {
    await sb.from("content_localizations").update({ migration_action: "merge" })
      .eq("content_item_id", itemId).in("locale", locs);
  }

  return { requests, skipped, model, itemCount: targets.size };
}

/** Submit the backlog as one batch. Returns the batch id + what was skipped. */
export async function submitBacklogBatch(
  opts: BuildBatchOptions = {}
): Promise<{ batchId: string | null; requested: number; skipped: BatchSkip[]; model: string }> {
  const built = await buildBatchRequests(opts);
  if (built.requests.length === 0) {
    return { batchId: null, requested: 0, skipped: built.skipped, model: built.model };
  }
  const handle = await submitBatch(built.requests);
  return { batchId: handle.id, requested: built.requests.length, skipped: built.skipped, model: built.model };
}

export interface IngestOutcome {
  key: string;
  contentItemId: string;
  locale: string;
  status: "updated" | "inserted" | "failed" | "rejected";
  words?: number;
  error?: string | null;
  /** Retry feedback to append on a re-batch (present for retryable failures/rejects). */
  retryFeedback?: string | null;
}

/**
 * Validate + persist a batch's results. Each succeeded message is parsed and run
 * through the SAME validators as the sync path; passing drafts are saved via the
 * shared writer (published when opts.publish), hard-failures are returned with
 * retry feedback so the driver can re-batch them.
 */
export async function ingestBatchResults(
  lines: BatchResultLine[],
  opts: { publish?: boolean } = {}
): Promise<IngestOutcome[]> {
  const sb = getServiceClient();
  const publish = opts.publish === true;
  const nowIso = new Date().toISOString();
  const embClient = embeddingClient();

  // Group result lines by item so we load context once per item.
  const byItem = new Map<string, BatchResultLine[]>();
  for (const line of lines) {
    const { contentItemId } = decodeKey(line.custom_id);
    if (!byItem.has(contentItemId)) byItem.set(contentItemId, []);
    byItem.get(contentItemId)!.push(line);
  }

  const outcomes: IngestOutcome[] = [];
  for (const [contentItemId, itemLines] of byItem.entries()) {
    const locales = itemLines.map((l) => decodeKey(l.custom_id).locale);
    const ctx = await loadItemContext(sb, contentItemId, locales);
    const briefCtx = ctx ? briefToValidatorContext(ctx.brief) : null;

    for (const line of itemLines) {
      const { locale } = decodeKey(line.custom_id);
      const base = { key: line.custom_id, contentItemId, locale };

      if (!ctx || !briefCtx) {
        outcomes.push({ ...base, status: "failed", error: "content_item context not found" });
        continue;
      }
      if (line.result.type !== "succeeded") {
        // expired/canceled/errored → retryable (no generation persisted).
        outcomes.push({ ...base, status: "failed", error: `batch result ${line.result.type}`, retryFeedback: null });
        continue;
      }
      const rawJson = extractJsonFromBatchMessage(line);
      if (!rawJson) {
        outcomes.push({ ...base, status: "failed", error: "empty/non-text batch message", retryFeedback: JSON_RETRY_HINT });
        continue;
      }
      let parsed: RegenDraft;
      try {
        parsed = JSON.parse(rawJson) as RegenDraft;
      } catch {
        outcomes.push({ ...base, status: "failed", error: "model returned non-JSON", retryFeedback: JSON_RETRY_HINT });
        continue;
      }
      if (!parsed.title || !parsed.body_json?.mainHtml) {
        outcomes.push({ ...base, status: "failed", error: "invalid response structure", retryFeedback: JSON_RETRY_HINT });
        continue;
      }

      const peers = ctx.contextByLocale[locale]?.similarArticles ?? [];
      const slugTaken = await isSlugTakenForItem(sb, contentItemId, locale, parsed.slug, ctx.routeKind);
      const jaccard = assessGeneratedSimilarity(
        { title: parsed.title, excerpt: parsed.excerpt, slug: parsed.slug },
        peers,
        slugTaken
      );
      let failures: ValidatorFailure[] = [];
      if (!jaccard.ok) {
        failures.push({
          id: "V7_embedding_similarity",
          severity: "hard",
          message: `${jaccard.reason}: ${jaccard.detail}`,
          retryHint: getSimilarityRetryInstruction(),
        });
      }
      const editorial = await runAllValidators(
        {
          candidate: {
            title: parsed.title,
            excerpt: parsed.excerpt,
            slug: parsed.slug,
            meta_title: parsed.meta_title,
            meta_description: parsed.meta_description,
            body_json: parsed.body_json as { mainHtml: string; [k: string]: unknown },
          },
          brief: briefCtx,
          peers,
          locale,
        },
        { embeddingClient: embClient }
      );
      failures = [...failures, ...editorial.failures];

      const hard = hardFailures(failures);
      if (hard.length > 0) {
        outcomes.push({
          ...base,
          status: "rejected",
          error: hard.map((f) => `${f.id}: ${f.message}`).join("; ").slice(0, 300),
          retryFeedback: formatValidatorRetryFeedback(failures),
        });
        continue;
      }

      const saved = await saveRegeneratedLocale(sb, {
        contentItemId,
        locale,
        content: parsed,
        existingLoc: ctx.existingByLocale.get(locale),
        routeKind: ctx.routeKind,
        publish,
        nowIso,
      });
      const soft = softFailures(failures);
      outcomes.push({
        ...base,
        status: saved.status,
        words: saved.words,
        error: saved.error ?? (soft.length > 0 ? `accepted with ${soft.length} soft warning(s)` : null),
      });
    }
  }
  return outcomes;
}

const JSON_RETRY_HINT =
  "Return ONLY a single valid, parseable JSON object matching the schema — no prose, no explanation, no markdown code fences. Ensure all strings are properly escaped.";

/** Slug-collision check that ignores this item's own rows (mirrors expandInPlace). */
async function isSlugTakenForItem(
  sb: Sb,
  contentItemId: string,
  locale: string,
  slug: string,
  routeKind: string
): Promise<boolean> {
  const s = (slug ?? "").trim();
  if (!s) return true;
  const { data } = await sb
    .from("content_localizations")
    .select("id, content_item_id")
    .eq("locale", locale)
    .eq("route_kind", routeKind)
    .eq("slug", s)
    .limit(2);
  return (data ?? []).some((r) => r.content_item_id !== contentItemId);
}
