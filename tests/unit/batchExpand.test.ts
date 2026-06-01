import { describe, it, expect } from "vitest";
import { encodeKey, decodeKey, DEFAULT_BATCH_MODEL } from "@/lib/resources/generation/batchExpand";
import { extractJsonFromBatchMessage, type BatchResultLine } from "@/lib/resources/generation/batchClient";

describe("custom_id codec", () => {
  it("round-trips a UUID + hyphenated locale", () => {
    const id = "d3ec0c17-8449-4555-ac63-190cc07e29a7";
    const key = encodeKey(id, "de-DE");
    expect(key).toBe(`${id}::de-DE`);
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

  it("returns the raw JSON object unchanged", () => {
    const out = extractJsonFromBatchMessage(succeeded('{"title":"Hi"}'));
    expect(out).toBe('{"title":"Hi"}');
  });

  it("strips markdown code fences", () => {
    const out = extractJsonFromBatchMessage(succeeded('```json\n{"title":"Hi"}\n```'));
    expect(out).toBe('{"title":"Hi"}');
  });

  it("slices a leading preamble down to the outer braces", () => {
    const out = extractJsonFromBatchMessage(succeeded('Here is the article:\n{"title":"Hi"}'));
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
