/**
 * Core generation engine — calls OpenAI to produce article body_json per locale.
 */

import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts";
import type { GenerationBrief } from "./prompts";

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
  locale: string
): Promise<GenerationResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { locale, content: null, error: "OPENAI_API_KEY not configured", tokensUsed: 0 };
  }

  const userPrompt = buildUserPrompt(brief, locale);

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
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: brief.contentType === "legal_update" ? 0.3 : 0.4,
        max_tokens: 4096,
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

export async function generateAllLocales(
  brief: GenerationBrief
): Promise<GenerationResult[]> {
  const results = await Promise.allSettled(
    brief.targetLocales.map((locale) => generateForLocale(brief, locale))
  );

  return results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { locale: "unknown", content: null, error: String(r.reason), tokensUsed: 0 }
  );
}
