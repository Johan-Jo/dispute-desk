/**
 * Anthropic Messages API client for the Defence Package narrative writer.
 *
 * Direct fetch — no SDK. Mirrors the working pattern in
 * `lib/resources/generation/generate.ts:218-273`.
 *
 * Supports prompt caching on the system block via `cache_control`. The
 * caller passes a split system payload (static base + module guidance) so
 * the static portion stays cached across calls while only the per-dispute
 * user message is full-priced.
 *
 * No SDK dependency, no module-level singletons — keep this thin.
 */

export interface ClaudeSystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CallClaudeInput {
  model: string;
  system: ClaudeSystemBlock[];
  messages: ClaudeMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface CallClaudeResult {
  raw: string | null;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  durationMs: number;
  error: string | null;
}

export async function callClaudeMessages(
  input: CallClaudeInput,
): Promise<CallClaudeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return {
      raw: null,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      durationMs: 0,
      error: "ANTHROPIC_API_KEY not configured",
    };
  }

  // Opus 4.x dropped `temperature`; everything else still accepts it.
  const supportsTemperature = !/^claude-opus-4/.test(input.model);
  const body: Record<string, unknown> = {
    model: input.model,
    system: input.system,
    messages: input.messages,
    max_tokens: input.maxTokens ?? 4096,
  };
  if (supportsTemperature && input.temperature !== undefined) {
    body.temperature = input.temperature;
  }

  const started = Date.now();
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    const durationMs = Date.now() - started;

    if (!res.ok) {
      const errBody = await res.text();
      return {
        raw: null,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
        durationMs,
        error: `Claude API error ${res.status}: ${errBody.slice(0, 300)}`,
      };
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };
    const promptTokens = data.usage?.input_tokens ?? 0;
    const completionTokens = data.usage?.output_tokens ?? 0;
    const cachedTokens = data.usage?.cache_read_input_tokens ?? 0;

    const block = data.content?.find((b) => b.type === "text");
    const raw = block?.text ?? null;
    if (!raw) {
      return {
        raw: null,
        promptTokens,
        completionTokens,
        cachedTokens,
        durationMs,
        error: "Empty response from Claude",
      };
    }

    // Strip ```json fences when the model wraps its output despite the
    // JSON-only instruction.
    const cleaned = raw
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    return {
      raw: cleaned,
      promptTokens,
      completionTokens,
      cachedTokens,
      durationMs,
      error: null,
    };
  } catch (err) {
    return {
      raw: null,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
