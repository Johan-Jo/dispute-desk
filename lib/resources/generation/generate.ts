/**
 * Core generation engine — calls OpenAI to produce article body_json per locale,
 * and runs the V1–V8 editorial validators (lib/resources/generation/validators.ts)
 * with up to 2 retries (3 total attempts) before accepting or rejecting.
 *
 * Retry feedback: every validator failure carries a concrete retry hint;
 * `formatValidatorRetryFeedback` concatenates them into the next user message
 * so the model sees exactly what to fix.
 *
 * Soft failures (V1 on Tier B/C, V4, V5) become `validatorWarnings` on the
 * result — the pipeline can still publish the article but the warnings flow
 * into review surfaces. Hard failures (V2, V3, V6, V8, V1 on Tier A,
 * V7 embedding) trigger retry; if still failing after 2 retries the result
 * is rejected.
 */

import { buildUserPrompt } from "./prompts";
import type { GenerationBrief, ResolvedGenerationPrompts, GenerationContext } from "./prompts";
import { assessGeneratedSimilarity, getSimilarityRetryInstruction } from "./similarity";
import {
  formatValidatorRetryFeedback,
  hardFailures,
  makeOpenAIEmbeddingClient,
  runAllValidators,
  softFailures,
  type EmbeddingClient,
  type ValidatorBriefContext,
  type ValidatorCandidate,
  type ValidatorFailure,
} from "./validators";

const MODEL = process.env.GENERATION_MODEL ?? "gpt-4o";
const MAX_VALIDATOR_RETRIES = 2;

interface GeneratedContent {
  title: string;
  excerpt: string;
  slug: string;
  meta_title: string;
  meta_description: string;
  body_json: {
    mainHtml: string;
    keyTakeaways: string[];
    faq: Array<{ q: string; a: string }>;
    disclaimer: string;
  };
}

export interface GenerationResult {
  locale: string;
  content: GeneratedContent | null;
  error: string | null;
  tokensUsed: number;
  /** Soft validator failures recorded against an *accepted* article. */
  validatorWarnings?: ValidatorFailure[];
}

export function isGenerationEnabled(): boolean {
  return process.env.GENERATION_ENABLED === "true" && !!process.env.OPENAI_API_KEY;
}

function isEmbeddingValidatorEnabled(): boolean {
  return process.env.GENERATION_EMBEDDINGS_ENABLED === "true";
}

function briefToValidatorContext(brief: GenerationBrief): ValidatorBriefContext {
  return {
    contentType: brief.contentType,
    primaryPillar: brief.primaryPillar,
    targetKeyword: brief.targetKeyword,
    proposedTitle: brief.proposedTitle,
    tier: brief.tier ?? null,
    archetype: brief.archetype ?? null,
    isHubArticle: brief.isHubArticle ?? null,
  };
}

export async function generateForLocale(
  brief: GenerationBrief,
  locale: string,
  resolvedPrompts: ResolvedGenerationPrompts,
  context: GenerationContext,
  options?: { extraUserInstructions?: string }
): Promise<GenerationResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { locale, content: null, error: "OPENAI_API_KEY not configured", tokensUsed: 0 };
  }

  let userPrompt = buildUserPrompt(brief, locale, resolvedPrompts, context);
  if (options?.extraUserInstructions?.trim()) {
    userPrompt += `\n\n${options.extraUserInstructions.trim()}`;
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: resolvedPrompts.systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: brief.contentType === "legal_update" ? 0.3 : 0.4,
        // Non-English locales need ~40-60% more tokens than English for the same word count.
        // 4096 caused self-truncation in DE/FR/ES/PT/SV, producing shorter articles.
        // 12000 was too tight for Tier A (3500-5000w + JSON wrapping → 8000+ tokens).
        // gpt-4o caps at 16384; we use the full ceiling for Tier A headroom.
        max_tokens: 16384,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return { locale, content: null, error: `OpenAI API error ${res.status}: ${errBody.slice(0, 200)}`, tokensUsed: 0 };
    }

    const data = await res.json();
    const tokensUsed = data.usage?.total_tokens ?? 0;
    const raw = data.choices?.[0]?.message?.content;

    if (!raw) {
      return { locale, content: null, error: "Empty response from model", tokensUsed };
    }

    const parsed = JSON.parse(raw) as GeneratedContent;

    if (!parsed.title || !parsed.body_json?.mainHtml) {
      return { locale, content: null, error: "Invalid response structure — missing title or mainHtml", tokensUsed };
    }

    return { locale, content: parsed, error: null, tokensUsed };
  } catch (err) {
    return {
      locale,
      content: null,
      error: err instanceof Error ? err.message : "Unknown generation error",
      tokensUsed: 0,
    };
  }
}

export interface GenerateAllLocalesOptions {
  /** Per-locale similar published articles (from DB) for prompt + post checks. */
  contextByLocale: Record<string, GenerationContext>;
  /** True if slug already exists for this locale + route_kind (any row). */
  isSlugTaken: (locale: string, slug: string) => Promise<boolean>;
  /** Test override: provide a fake embedding client. Defaults to OpenAI client when env enables. */
  embeddingClient?: EmbeddingClient | null;
}

async function generateLocaleWithValidators(
  brief: GenerationBrief,
  locale: string,
  resolvedPrompts: ResolvedGenerationPrompts,
  opts: GenerateAllLocalesOptions
): Promise<GenerationResult> {
  const ctx = opts.contextByLocale[locale] ?? { similarArticles: [] };
  const peers = ctx.similarArticles;
  const briefCtx = briefToValidatorContext(brief);

  const embeddingClient =
    opts.embeddingClient !== undefined
      ? opts.embeddingClient
      : isEmbeddingValidatorEnabled()
        ? makeOpenAIEmbeddingClient(process.env.OPENAI_API_KEY)
        : null;

  let totalTokens = 0;
  let lastError: string | null = null;
  let lastSoftWarnings: ValidatorFailure[] = [];
  let extraInstructions: string | undefined;

  // Initial attempt + up to MAX_VALIDATOR_RETRIES retries.
  for (let attempt = 0; attempt <= MAX_VALIDATOR_RETRIES; attempt += 1) {
    const result = await generateForLocale(
      brief,
      locale,
      resolvedPrompts,
      ctx,
      extraInstructions ? { extraUserInstructions: extraInstructions } : undefined
    );
    totalTokens += result.tokensUsed;

    if (!result.content) {
      lastError = result.error;
      break;
    }

    // Slug-collision and Jaccard guard from similarity.ts still apply — they
    // catch fast/cheap duplicates without an embedding round-trip.
    const slugTaken = await opts.isSlugTaken(locale, result.content.slug);
    const jaccardGuard = assessGeneratedSimilarity(
      {
        title: result.content.title,
        excerpt: result.content.excerpt,
        slug: result.content.slug,
      },
      peers,
      slugTaken
    );

    let validatorFailures: ValidatorFailure[] = [];
    if (!jaccardGuard.ok) {
      validatorFailures.push({
        id: "V7_embedding_similarity",
        severity: "hard",
        message: `${jaccardGuard.reason}: ${jaccardGuard.detail}`,
        retryHint: getSimilarityRetryInstruction(),
      });
    }

    const candidate: ValidatorCandidate = {
      title: result.content.title,
      excerpt: result.content.excerpt,
      slug: result.content.slug,
      meta_title: result.content.meta_title,
      meta_description: result.content.meta_description,
      body_json: result.content.body_json,
    };

    const editorial = await runAllValidators(
      { candidate, brief: briefCtx, peers, locale },
      { embeddingClient }
    );
    validatorFailures = [...validatorFailures, ...editorial.failures];

    const hard = hardFailures(validatorFailures);
    const soft = softFailures(validatorFailures);

    if (hard.length === 0) {
      // Accept; soft failures become warnings on the result.
      return {
        locale,
        content: result.content,
        error: null,
        tokensUsed: totalTokens,
        ...(soft.length > 0 ? { validatorWarnings: soft } : {}),
      };
    }

    lastSoftWarnings = soft;

    if (attempt >= MAX_VALIDATOR_RETRIES) {
      const summary = hard.map((f) => `${f.id}: ${f.message}`).join("; ");
      return {
        locale,
        content: null,
        error: `Generation rejected after ${MAX_VALIDATOR_RETRIES} retries — ${summary}`,
        tokensUsed: totalTokens,
        ...(soft.length > 0 ? { validatorWarnings: soft } : {}),
      };
    }

    extraInstructions = formatValidatorRetryFeedback(validatorFailures);
  }

  return {
    locale,
    content: null,
    error: lastError ?? "Generation failed",
    tokensUsed: totalTokens,
    ...(lastSoftWarnings.length > 0 ? { validatorWarnings: lastSoftWarnings } : {}),
  };
}

export async function generateAllLocales(
  brief: GenerationBrief,
  resolvedPrompts: ResolvedGenerationPrompts,
  opts: GenerateAllLocalesOptions
): Promise<GenerationResult[]> {
  return Promise.all(
    brief.targetLocales.map((locale) =>
      generateLocaleWithValidators(brief, locale, resolvedPrompts, opts)
    )
  );
}
