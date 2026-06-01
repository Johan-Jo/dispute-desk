import { describe, it, expect } from "vitest";
import { encodeKey, decodeKey, DEFAULT_BATCH_MODEL } from "@/lib/resources/generation/batchExpand";
import { extractJsonFromBatchMessage, type BatchResultLine } from "@/lib/resources/generation/batchClient";

describe("custom_id codec", () => {
  it("round-trips a UUID + hyphenated locale (underscore delimiter, no colons)", () => {
    const id = "d3ec0c17-8449-4555-ac63-190cc07e29a7";
    const key = encodeKey(id, "de-DE");
    expect(key).toBe(`${id}__de-DE`);
    // Anthropic custom_id must match ^[a-zA-Z0-9_-]{1,64}$ — assert it does.
    expect(key).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(decodeKey(key)).toEqual({ contentItemId: id, locale: "de-DE" });
  });

  it("decodes a key with no delimiter as item-only", () => {
    expect(decodeKey("abc")).toEqual({ contentItemId: "abc", locale: "" });
  });

  it("defaults to Sonnet (Haiku was rejected on quality)", () => {
    expect(DEFAULT_BATCH_MODEL).toBe("claude-sonnet-4-6");
  });
});

describe("extractJsonFromBatchMessage", () => {
  const succeeded = (text: string): BatchResultLine => ({
    custom_id: "x::en-US",
    result: { type: "succeeded", message: { content: [{ type: "text", text }] } },
  });

  it("restores the leading '{' on a prefill continuation", () => {
    // With the assistant-turn "{" prefill, the reply starts mid-object.
    const out = extractJsonFromBatchMessage(succeeded('"title":"Hi"}'));
    expect(out).toBe('{"title":"Hi"}');
  });

  it("does not double-brace when the model echoes the '{'", () => {
    const out = extractJsonFromBatchMessage(succeeded('{"title":"Hi"}'));
    expect(out).toBe('{"title":"Hi"}');
  });

  it("drops trailing prose after the closing brace", () => {
    const out = extractJsonFromBatchMessage(succeeded('"title":"Hi"} — hope that helps!'));
    expect(out).toBe('{"title":"Hi"}');
  });

  it("strips a stray closing code fence", () => {
    const out = extractJsonFromBatchMessage(succeeded('"title":"Hi"}\n```'));
    expect(out).toBe('{"title":"Hi"}');
  });

  it("returns null for errored / expired / canceled results", () => {
    expect(extractJsonFromBatchMessage({ custom_id: "x", result: { type: "errored", error: {} } })).toBeNull();
    expect(extractJsonFromBatchMessage({ custom_id: "x", result: { type: "expired" } })).toBeNull();
    expect(extractJsonFromBatchMessage({ custom_id: "x", result: { type: "canceled" } })).toBeNull();
  });

  it("returns null when the message has no text block", () => {
    const line: BatchResultLine = {
      custom_id: "x::en-US",
      result: { type: "succeeded", message: { content: [{ type: "tool_use" }] } },
    };
    expect(extractJsonFromBatchMessage(line)).toBeNull();
  });
});
