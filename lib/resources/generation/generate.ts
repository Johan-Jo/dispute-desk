/**
 * Core generation engine — calls OpenAI to produce article body_json per locale.
 */

import { buildUserPrompt } from "./prompts";
import type { GenerationBrief, ResolvedGenerationPrompts, GenerationContext } from "./prompts";
import { assessGeneratedSimilarity, getSimilarityRetryInstruction } from "./similarity";

const MODEL = process.env.GENERATION_MODEL ?? "gpt-4o";

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
}

export function isGenerationEnabled(): boolean {
  return process.env.GENERATION_ENABLED === "true" && !!process.env.OPENAI_API_KEY;
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
        // gpt-4o supports 16 384 output tokens; stay comfortably below that.
        max_tokens: 12000,
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
}

async function generateLocaleWithSimilarityGuards(
  brief: GenerationBrief,
  locale: string,
  resolvedPrompts: ResolvedGenerationPrompts,
  opts: GenerateAllLocalesOptions
): Promise<GenerationResult> {
  const ctx = opts.contextByLocale[locale] ?? { similarArticles: [] };
  const similar = ctx.similarArticles;

  const callOnce = async (extra?: string) =>
    generateForLocale(brief, locale, resolvedPrompts, ctx, extra ? { extraUserInstructions: extra } : undefined);

  const first = await callOnce();
  let totalTokens = first.tokensUsed;

  if (!first.content) return first;

  const slugTaken1 = await opts.isSlugTaken(locale, first.content.slug);
  let guard = assessGeneratedSimilarity(
    {
      title: first.content.title,
      excerpt: first.content.excerpt,
      slug: first.content.slug,
    },
    similar,
    slugTaken1
  );

  if (guard.ok) return first;

  const second = await callOnce(getSimilarityRetryInstruction());
  totalTokens += second.tokensUsed;

  if (!second.content) {
    return {
      locale,
      content: null,
      error: second.error,
      tokensUsed: totalTokens,
    };
  }

  const slugTaken2 = await opts.isSlugTaken(locale, second.content.slug);
  guard = assessGeneratedSimilarity(
    {
      title: second.content.title,
      excerpt: second.content.excerpt,
      slug: second.content.slug,
    },
    similar,
    slugTaken2
  );

  if (!guard.ok) {
    return {
      locale,
      content: null,
      error: `Generation rejected after similarity retry (${guard.reason}): ${guard.detail}`,
      tokensUsed: totalTokens,
    };
  }

  return { ...second, tokensUsed: totalTokens };
}

export async function generateAllLocales(
  brief: GenerationBrief,
  resolvedPrompts: ResolvedGenerationPrompts,
  opts: GenerateAllLocalesOptions
): Promise<GenerationResult[]> {
  return Promise.all(
    brief.targetLocales.map((locale) =>
      generateLocaleWithSimilarityGuards(brief, locale, resolvedPrompts, opts)
    )
  );
}
