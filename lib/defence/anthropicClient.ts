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

/**
 * The Messages API rejects a request carrying more than four `cache_control`
 * blocks — 400 `invalid_request_error`, "A maximum of 4 blocks with
 * cache_control may be provided."
 *
 * This is enforced HERE, at the one door every Claude call goes through,
 * rather than at each call site. On 2026-09-24 a Klarna item-not-received
 * build in prod sent five (base + family overlay + payment overlay + reason
 * module + strategy bundle) and failed deterministically on every retry;
 * `narrativeWriter`'s own layout comment documented four and had never
 * counted the payment overlay, which is only emitted for non-card disputes.
 * A per-call-site fix would have left the next optional block free to
 * reintroduce the same 400.
 */
export const MAX_CACHE_CONTROL_BLOCKS = 4;

/**
 * Drop surplus cache breakpoints, keeping the request valid.
 *
 * A breakpoint caches the prefix up to and including its block, so the
 * markers are not equally valuable: the FIRST covers the prefix every call
 * shares, and the LAST covers an exact repeat of the whole system payload.
 * When the cap is exceeded we therefore keep the first and the final
 * `MAX - 1`, dropping from the middle.
 *
 * Content is never dropped — only markers. Every block is still sent.
 * A payload already within the cap is returned untouched, so the common
 * (card) path keeps the exact caching behaviour it has today.
 */
export function capCacheControlBlocks(
  system: ClaudeSystemBlock[],
): ClaudeSystemBlock[] {
  const marked: number[] = [];
  for (let i = 0; i < system.length; i++) {
    if (system[i].cache_control) marked.push(i);
  }
  if (marked.length <= MAX_CACHE_CONTROL_BLOCKS) return system;

  const keep = new Set<number>([
    marked[0],
    ...marked.slice(-(MAX_CACHE_CONTROL_BLOCKS - 1)),
  ]);
  return system.map((block, i) => {
    if (!block.cache_control || keep.has(i)) return block;
    const { cache_control: _dropped, ...rest } = block;
    return rest;
  });
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
  /** Tokens written to the prompt cache (billed at 1.25× input). Absent on errors. */
  cacheWriteTokens?: number;
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
    // Never send more breakpoints than the API accepts — see
    // `capCacheControlBlocks`. Applied on the way out so no caller can
    // reintroduce the 400 by adding another optional block.
    system: capCacheControlBlocks(input.system),
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
    const cacheWriteTokens = data.usage?.cache_creation_input_tokens ?? 0;

    const block = data.content?.find((b) => b.type === "text");
    const raw = block?.text ?? null;
    if (!raw) {
      return {
        raw: null,
        promptTokens,
        completionTokens,
        cachedTokens,
        cacheWriteTokens,
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
      cacheWriteTokens,
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
