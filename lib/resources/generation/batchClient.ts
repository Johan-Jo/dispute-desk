/**
 * Thin client for Anthropic's Message Batches API.
 *
 * Batches run the SAME model + params as a normal /v1/messages call, but
 * asynchronously and at a 50% token discount — the right tool for backfilling
 * a large content backlog where latency (results within 24h, usually much
 * sooner) doesn't matter. Reference: https://docs.anthropic.com/en/api/creating-message-batches
 *
 * Each request carries a `custom_id` that we round-trip through the result set
 * to know which (content_item, locale) a completion belongs to (see batchExpand).
 *
 * Auth + versioning mirror callClaudeChat: x-api-key + anthropic-version 2023-06-01.
 * Message Batches is GA under that version — no beta header required.
 */

const ANTHROPIC_BASE = "https://api.anthropic.com/v1/messages/batches";

export interface BatchRequestParams {
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  temperature?: number;
  /** Anthropic structured outputs — guarantees schema-valid JSON (see articleJsonSchema). */
  output_config?: unknown;
}

export interface BatchRequest {
  custom_id: string;
  params: BatchRequestParams;
}

export interface BatchRequestCounts {
  processing: number;
  succeeded: number;
  errored: number;
  canceled: number;
  expired: number;
}

export interface BatchHandle {
  id: string;
  processing_status: "in_progress" | "canceling" | "ended";
  request_counts: BatchRequestCounts;
  results_url: string | null;
}

/** One line of the JSONL results stream. */
export interface BatchResultLine {
  custom_id: string;
  result:
    | { type: "succeeded"; message: { content: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } } }
    | { type: "errored"; error: unknown }
    | { type: "canceled" }
    | { type: "expired" };
}

function apiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY ?? null;
}

function headers(key: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
  };
}

/** Submit a batch. Returns the batch handle (id + initial status). */
export async function submitBatch(requests: BatchRequest[]): Promise<BatchHandle> {
  const key = apiKey();
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  if (requests.length === 0) throw new Error("submitBatch called with zero requests");
  // Anthropic caps a batch at 100,000 requests / 256MB; our backlogs are tiny.
  const res = await fetch(ANTHROPIC_BASE, {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify({ requests }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic batch create ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as BatchHandle;
}

/** Poll a batch's status. */
export async function getBatch(batchId: string): Promise<BatchHandle> {
  const key = apiKey();
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  const res = await fetch(`${ANTHROPIC_BASE}/${batchId}`, { headers: headers(key) });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic batch get ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as BatchHandle;
}

/**
 * Fetch + parse the JSONL results of an ended batch. Order is not guaranteed;
 * callers key off custom_id. Throws if the batch hasn't ended (no results_url).
 */
export async function getBatchResults(batchId: string): Promise<BatchResultLine[]> {
  const key = apiKey();
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  const handle = await getBatch(batchId);
  if (handle.processing_status !== "ended" || !handle.results_url) {
    throw new Error(`Batch ${batchId} not ready (status=${handle.processing_status})`);
  }
  const res = await fetch(handle.results_url, { headers: headers(key) });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic batch results ${res.status}: ${body.slice(0, 300)}`);
  }
  const text = await res.text();
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as BatchResultLine);
}

/**
 * Extract the JSON-bearing text from a succeeded batch message. The reply
 * normally starts with "{" (we instruct JSON-only output rather than prefilling,
 * since Claude 4.x rejects assistant prefill). Strip any stray fence, restore a
 * leading "{" if the model dropped it, then slice to the last "}" to drop any
 * trailing prose. Tolerant of both shapes so older results still parse.
 */
export function extractJsonFromBatchMessage(line: BatchResultLine): string | null {
  if (line.result.type !== "succeeded") return null;
  const block = line.result.message.content.find((b) => b.type === "text");
  const raw = block?.text;
  if (!raw) return null;
  let cleaned = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  if (!cleaned) return null;
  if (!cleaned.startsWith("{")) cleaned = `{${cleaned}`;
  const last = cleaned.lastIndexOf("}");
  if (last > 0) cleaned = cleaned.slice(0, last + 1);
  return cleaned || null;
}
