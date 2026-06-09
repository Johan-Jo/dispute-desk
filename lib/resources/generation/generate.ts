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
import { resolveArchetype } from "./tiers";
import {
  PASS_ONE_SYSTEM_PROMPT,
  PASS_TWO_SYSTEM_PROMPT,
  buildPassOneUserPrompt,
  buildPassTwoUserPrompt,
  validatePassOneShape,
  type PassOneSourceMaterial,
  type TwoPassBriefContext,
} from "./twoPassPrompts";
import { DEFAULT_LOCALE_INSTRUCTIONS } from "./prompts";
import { repairTruncatedBody } from "./repairBody";
import { ARTICLE_OUTPUT_CONFIG } from "./articleJsonSchema";

const MODEL = process.env.GENERATION_MODEL ?? "gpt-4o";
// Bumped 2 → 3 after observing repeat schema-leakage cases where the model
// took 3 attempts to escape "DisputeDesk's Role" / "Failure Modes" patterns.
// Pass 2 retries are cheap (~$0.10 each) compared to losing the whole article.
const MAX_VALIDATOR_RETRIES = 3;

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

export function briefToValidatorContext(brief: GenerationBrief): ValidatorBriefContext {
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

/**
 * Provider selector for the single-call generation path. Defaults to OpenAI;
 * set GENERATION_PROVIDER=claude (with ANTHROPIC_API_KEY) to assemble articles
 * on Claude instead. An explicit per-call override beats the env (used for
 * A/B comparison via the expand-thin route's ?provider= param).
 */
function generationProvider(override?: "openai" | "claude" | null): "openai" | "claude" {
  const hasClaude = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
  if (override === "openai") return "openai";
  if (override === "claude") return hasClaude ? "claude" : "openai";
  const envChoice = process.env.GENERATION_PROVIDER?.toLowerCase();
  if (envChoice === "openai") return "openai"; // explicit opt-out
  if (envChoice === "claude") return hasClaude ? "claude" : "openai";
  // Default (chosen 2026-05-31): Claude/Sonnet when an Anthropic key is present.
  // gpt-4o would not write to tier-floor depth even with explicit retry hints
  // (it stalled at ~300w on a 1500-floor cluster; Sonnet produced ~1800w on the
  // same brief). Falls back to OpenAI only when no Anthropic key is configured.
  return hasClaude ? "claude" : "openai";
}

export async function generateForLocale(
  brief: GenerationBrief,
  locale: string,
  resolvedPrompts: ResolvedGenerationPrompts,
  context: GenerationContext,
  options?: { extraUserInstructions?: string; provider?: "openai" | "claude" | null }
): Promise<GenerationResult> {
  let userPrompt = buildUserPrompt(brief, locale, resolvedPrompts, context);
  if (options?.extraUserInstructions?.trim()) {
    userPrompt += `\n\n${options.extraUserInstructions.trim()}`;
  }

  const temperature = brief.contentType === "legal_update" ? 0.3 : 0.4;
  const provider = generationProvider(options?.provider ?? null);

  let raw: string | null = null;
  let tokensUsed = 0;
  let error: string | null = null;

  if (provider === "claude") {
    ({ raw, tokensUsed, error } = await callClaudeChat(resolvedPrompts.systemPrompt, userPrompt, temperature));
  } else {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { locale, content: null, error: "OPENAI_API_KEY not configured", tokensUsed: 0 };
    }
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: resolvedPrompts.systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature,
          // Non-English locales need ~40-60% more tokens than English for the same word count.
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
      tokensUsed = data.usage?.total_tokens ?? 0;
      raw = data.choices?.[0]?.message?.content ?? null;
    } catch (err) {
      return { locale, content: null, error: err instanceof Error ? err.message : "Unknown generation error", tokensUsed: 0 };
    }
  }

  if (!raw) {
    return { locale, content: null, error: error ?? "Empty response from model", tokensUsed };
  }

  let parsed: GeneratedContent;
  try {
    parsed = JSON.parse(raw) as GeneratedContent;
  } catch {
    return { locale, content: null, error: "Model returned non-JSON", tokensUsed };
  }
  if (!parsed.title || !parsed.body_json?.mainHtml) {
    return { locale, content: null, error: "Invalid response structure — missing title or mainHtml", tokensUsed };
  }
  return { locale, content: parsed, error: null, tokensUsed };
}

/**
 * Low-level OpenAI chat call. Returns the raw assistant message + tokens used.
 * Used by both single-call generation and the two-pass orchestrator below.
 */
async function callOpenAIChat(
  systemPrompt: string,
  userPrompt: string,
  temperature: number
): Promise<{ raw: string | null; tokensUsed: number; error: string | null }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { raw: null, tokensUsed: 0, error: "OPENAI_API_KEY not configured" };

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
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature,
        max_tokens: 16384,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return { raw: null, tokensUsed: 0, error: `OpenAI API error ${res.status}: ${errBody.slice(0, 200)}` };
    }

    const data = await res.json();
    const tokensUsed = data.usage?.total_tokens ?? 0;
    const raw = data.choices?.[0]?.message?.content as string | undefined;
    if (!raw) return { raw: null, tokensUsed, error: "Empty response from model" };
    return { raw, tokensUsed, error: null };
  } catch (err) {
    return { raw: null, tokensUsed: 0, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Anthropic (Claude) chat call. Used for Pass 2 when GENERATION_PASS_TWO_PROVIDER=claude
 * and ANTHROPIC_API_KEY is set. Pass 1 stays on OpenAI (the structured-source-material
 * job suits gpt-4o fine; Claude is being tested specifically for the article-assembly
 * length-compliance problem in Pass 2).
 *
 * Anthropic's API differs from OpenAI: system prompt is a top-level field (not a
 * message); auth is x-api-key (not Bearer); response_format is implicit (no JSON
 * mode flag — we ask for JSON in the prompt instead).
 */
async function callClaudeChat(
  systemPrompt: string,
  userPrompt: string,
  temperature: number
): Promise<{ raw: string | null; tokensUsed: number; error: string | null }> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
  if (!apiKey) return { raw: null, tokensUsed: 0, error: "ANTHROPIC_API_KEY not configured" };

  const model = process.env.GENERATION_MODEL_PASS_TWO ?? "claude-sonnet-4-6";

  // Opus 4.x dropped `temperature` (400s with "deprecated"). Send it for
  // Sonnet / Haiku / older models only.
  const supportsTemperature = !/^claude-opus-4/.test(model);
  // JSON is guaranteed by Anthropic structured outputs (output_config.format),
  // NOT by prompt instructions. History: we first used an assistant-turn "{"
  // prefill (Claude 4.x rejects it with a 400), then a prompt "return only JSON"
  // nudge — but Sonnet did not reliably escape double-quotes inside the article
  // HTML, so JSON.parse failed on long articles ("model returned non-JSON").
  // output_config.format makes the API itself emit schema-valid, properly-escaped
  // JSON — no prefill, no escaping bugs, no retries. The conversation still ends
  // on a user turn (structured outputs are incompatible with prefill anyway).
  const requestBody: Record<string, unknown> = {
    model,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    // Headroom for tier-floor articles (clusters ~1500w, pillars 3000w+) plus JSON wrapping.
    max_tokens: 24000,
    output_config: ARTICLE_OUTPUT_CONFIG,
  };
  if (supportsTemperature) requestBody.temperature = temperature;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return { raw: null, tokensUsed: 0, error: `Claude API error ${res.status}: ${errBody.slice(0, 300)}` };
    }

    const data = await res.json();
    const tokensUsed = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
    // Anthropic returns content as an array of blocks. We requested JSON in the
    // prompt — first text block is the JSON payload.
    const block = (data.content as Array<{ type: string; text?: string }> | undefined)?.find(
      (b) => b.type === "text"
    );
    const raw = block?.text;
    if (!raw) return { raw: null, tokensUsed, error: "Empty response from Claude" };
    // Without the prefill the reply normally starts with "{". Strip any stray
    // ```json fence, restore a leading "{" if the model dropped it, and slice to
    // the last "}" to drop any trailing prose.
    let cleaned = raw
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    if (!cleaned.startsWith("{")) cleaned = `{${cleaned}`;
    const last = cleaned.lastIndexOf("}");
    if (last > 0) cleaned = cleaned.slice(0, last + 1);
    return { raw: cleaned, tokensUsed, error: null };
  } catch (err) {
    return { raw: null, tokensUsed: 0, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/** Provider selector for Pass 2 only. Pass 1 always uses OpenAI. Defaults to
 *  Claude/Sonnet when an Anthropic key is present (see generationProvider). */
function passTwoProvider(): "openai" | "claude" {
  const hasClaude = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
  const envChoice = process.env.GENERATION_PASS_TWO_PROVIDER?.toLowerCase();
  if (envChoice === "openai") return "openai";
  if (envChoice === "claude") return hasClaude ? "claude" : "openai";
  return hasClaude ? "claude" : "openai";
}

function buildTwoPassContext(brief: GenerationBrief, locale: string): TwoPassBriefContext {
  const localeInstruction =
    DEFAULT_LOCALE_INSTRUCTIONS[locale] ?? DEFAULT_LOCALE_INSTRUCTIONS["en-US"];
  // Filter brief notes the same way the single-call path does — strip CMS bookkeeping.
  let notes = brief.notes ?? null;
  if (notes) {
    try {
      const parsed = JSON.parse(notes) as Record<string, unknown>;
      const noisy = new Set([
        "brief_version",
        "cluster",
        "page_role",
        "complexity",
        "target_word_range",
        "page_title",
        "seo_title",
        "cta_type",
      ]);
      const filtered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (!noisy.has(k)) filtered[k] = v;
      }
      notes = JSON.stringify(filtered, null, 2);
    } catch {
      /* keep notes as-is if not valid JSON */
    }
  }

  return {
    topic: brief.proposedTitle,
    targetKeyword: brief.targetKeyword,
    contextSummary: brief.summary,
    notes,
    locale,
    localeInstruction,
  };
}

/**
 * Pass 1 — generate raw operator source material (observations, failure modes,
 * messy examples, evidence hierarchy notes). Single attempt; no retry. The
 * output is structural data, not prose, so retries don't add much value.
 */
export async function generatePassOne(
  brief: GenerationBrief,
  locale: string
): Promise<{ material: PassOneSourceMaterial | null; tokensUsed: number; error: string | null }> {
  const ctx = buildTwoPassContext(brief, locale);
  const userPrompt = buildPassOneUserPrompt(ctx);
  const { raw, tokensUsed, error } = await callOpenAIChat(PASS_ONE_SYSTEM_PROMPT, userPrompt, 0.5);
  if (!raw) return { material: null, tokensUsed, error };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { material: null, tokensUsed, error: "Pass 1: model returned non-JSON" };
  }
  if (!validatePassOneShape(parsed)) {
    return { material: null, tokensUsed, error: "Pass 1: response missing required source-material fields" };
  }
  return { material: parsed, tokensUsed, error: null };
}

/**
 * Pass 2 — assemble the article from Pass 1 source material. Used by the
 * retry loop: when Pass 2 fails validators, we regenerate Pass 2 only
 * (cheaper than re-running Pass 1) with retry feedback appended.
 */
async function generatePassTwo(
  brief: GenerationBrief,
  locale: string,
  sourceMaterial: PassOneSourceMaterial,
  extraInstructions?: string
): Promise<GenerationResult> {
  const ctx = buildTwoPassContext(brief, locale);
  const baseUserPrompt = buildPassTwoUserPrompt(ctx, sourceMaterial);
  const userPrompt = extraInstructions
    ? `${baseUserPrompt}\n\n${extraInstructions.trim()}`
    : baseUserPrompt;

  const provider = passTwoProvider();
  const { raw, tokensUsed, error } =
    provider === "claude"
      ? await callClaudeChat(PASS_TWO_SYSTEM_PROMPT, userPrompt, 0.4)
      : await callOpenAIChat(PASS_TWO_SYSTEM_PROMPT, userPrompt, 0.4);
  if (!raw) return { locale, content: null, error, tokensUsed };

  let parsed: GeneratedContent;
  try {
    parsed = JSON.parse(raw) as GeneratedContent;
  } catch {
    return { locale, content: null, error: "Pass 2: model returned non-JSON", tokensUsed };
  }

  if (!parsed.title || !parsed.body_json?.mainHtml) {
    return { locale, content: null, error: "Pass 2: invalid response structure", tokensUsed };
  }

  return { locale, content: parsed, error: null, tokensUsed };
}

export interface GenerateAllLocalesOptions {
  /** Per-locale similar published articles (from DB) for prompt + post checks. */
  contextByLocale: Record<string, GenerationContext>;
  /** True if slug already exists for this locale + route_kind (any row). */
  isSlugTaken: (locale: string, slug: string) => Promise<boolean>;
  /** Test override: provide a fake embedding client. Defaults to OpenAI client when env enables. */
  embeddingClient?: EmbeddingClient | null;
  /** Per-call provider override for the single-call path (A/B). Defaults to env (GENERATION_PROVIDER). */
  provider?: "openai" | "claude" | null;
  /** Per-call validator/JSON retry budget. Lower it to keep one request under the
   *  300s function limit (the caller re-invokes on failure). Defaults to MAX_VALIDATOR_RETRIES. */
  maxRetries?: number;
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

  // PR 7 — two-pass routing for authority_pillar. Pass 1 produces source
  // material once; Pass 2 assembles into article (and re-runs on retry with
  // validator feedback). Other archetypes use the single-call path.
  const archetype = resolveArchetype({
    archetype: brief.archetype ?? null,
    contentType: brief.contentType,
    isHubArticle: brief.isHubArticle ?? null,
  });
  const useTwoPass = archetype === "authority_pillar";

  let totalTokens = 0;
  let lastError: string | null = null;
  let lastSoftWarnings: ValidatorFailure[] = [];
  let extraInstructions: string | undefined;
  let passOneMaterial: PassOneSourceMaterial | null = null;
  // Per-call retry budget. The in-place rebuild lowers this so a single HTTP
  // request finishes well under the 300s function limit (each Sonnet attempt
  // can take 60-120s); the client re-calls on failure, spreading retries across
  // separate requests instead of stacking them into one 504-prone call.
  const maxRetries = opts.maxRetries ?? MAX_VALIDATOR_RETRIES;

  if (useTwoPass) {
    const p1 = await generatePassOne(brief, locale);
    totalTokens += p1.tokensUsed;
    if (!p1.material) {
      return { locale, content: null, error: `Pass 1 failed: ${p1.error}`, tokensUsed: totalTokens };
    }
    passOneMaterial = p1.material;
  }

  // Initial attempt + up to maxRetries retries.
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const result = useTwoPass && passOneMaterial
      ? await generatePassTwo(brief, locale, passOneMaterial, extraInstructions)
      : await generateForLocale(
          brief,
          locale,
          resolvedPrompts,
          ctx,
          { extraUserInstructions: extraInstructions || undefined, provider: opts.provider ?? null }
        );
    totalTokens += result.tokensUsed;

    if (!result.content) {
      lastError = result.error;
      // A null result is usually a transient generation failure (Claude has no
      // JSON response_format, so Sonnet occasionally emits unparseable JSON;
      // also empty responses / 5xx). Re-roll with an explicit JSON nudge rather
      // than failing the locale outright. Only give up on non-retryable config
      // errors (missing API key).
      const retryable =
        /non-JSON|Empty response|invalid response structure|API error 5\d\d|429|rate limit|timeout/i.test(
          result.error ?? ""
        );
      if (retryable && attempt < maxRetries) {
        extraInstructions =
          "Return ONLY a single valid, parseable JSON object matching the schema — no prose, no explanation, no markdown code fences. Ensure all strings are properly escaped.";
        continue;
      }
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

    // Repair a body left truncated at the tail before validation — salvages an
    // otherwise-complete article instead of triggering a (re-billed) retry.
    const repaired = repairTruncatedBody(result.content.body_json.mainHtml);
    if (repaired.changed) {
      result.content.body_json.mainHtml = repaired.html;
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

    if (attempt >= maxRetries) {
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
