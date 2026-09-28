/**
 * The Messages API accepts at most four `cache_control` breakpoints.
 *
 * Regression: on 2026-09-24 a Klarna item-not-received build in prod sent
 * five — base + family overlay + payment overlay + reason module + strategy
 * bundle — and failed deterministically:
 *
 *   400 invalid_request_error
 *   "A maximum of 4 blocks with cache_control may be provided. Found 5."
 *
 * Card disputes carry no payment overlay, so they stayed at four and passed;
 * only the BNPL path could reach five, and only once P0 gave INR a non-empty
 * strategy bundle. These cases pin the cap at the client boundary so no call
 * site can reintroduce it.
 */

import { describe, it, expect } from "vitest";
import {
  capCacheControlBlocks,
  MAX_CACHE_CONTROL_BLOCKS,
  type ClaudeSystemBlock,
} from "../anthropicClient";

const cached = (text: string): ClaudeSystemBlock => ({
  type: "text",
  text,
  cache_control: { type: "ephemeral" },
});

const plain = (text: string): ClaudeSystemBlock => ({ type: "text", text });

const markedCount = (blocks: ClaudeSystemBlock[]) =>
  blocks.filter((b) => b.cache_control).length;

describe("capCacheControlBlocks", () => {
  it("leaves a payload within the cap completely untouched", () => {
    // The card path — four blocks — must keep the exact caching behaviour it
    // has today. Identity, not just equality, so nothing is reallocated.
    const system = [
      cached("base"),
      cached("family"),
      cached("module"),
      cached("strategies"),
    ];
    const out = capCacheControlBlocks(system);
    expect(out).toBe(system);
    expect(markedCount(out)).toBe(4);
  });

  it("caps the Klarna INR payload that failed in prod, at five blocks", () => {
    const system = [
      cached("BASE_SYSTEM_PROMPT"),
      cached("family overlay: item_not_received"),
      cached("payment overlay: klarna"),
      cached("module: inr_product_not_received"),
      cached("strategy: item_not_received_carrier_possession"),
    ];
    const out = capCacheControlBlocks(system);

    expect(markedCount(out)).toBe(MAX_CACHE_CONTROL_BLOCKS);
    expect(markedCount(out)).toBeLessThanOrEqual(4);
  });

  it("never drops content — every block is still sent, in order", () => {
    const texts = ["base", "family", "payment", "module", "strategies"];
    const out = capCacheControlBlocks(texts.map(cached));

    expect(out.map((b) => b.text)).toEqual(texts);
    expect(out).toHaveLength(5);
    for (const block of out) expect(block.type).toBe("text");
  });

  it("keeps the first and the last breakpoints, dropping from the middle", () => {
    // The first covers the prefix every call shares; the last covers an exact
    // repeat of the whole payload. Those are the two worth keeping.
    const out = capCacheControlBlocks(
      ["base", "family", "payment", "module", "strategies"].map(cached),
    );

    expect(out[0].cache_control).toBeDefined();
    expect(out[4].cache_control).toBeDefined();
    expect(out[1].cache_control).toBeUndefined();
  });

  it("caps a payload well past the limit", () => {
    const out = capCacheControlBlocks(
      Array.from({ length: 9 }, (_, i) => cached(`block ${i}`)),
    );

    expect(markedCount(out)).toBe(MAX_CACHE_CONTROL_BLOCKS);
    expect(out[0].cache_control).toBeDefined();
    expect(out[8].cache_control).toBeDefined();
    expect(out.map((b) => b.text)).toHaveLength(9);
  });

  it("counts only marked blocks, ignoring unmarked ones", () => {
    // Five blocks but four breakpoints — already valid, leave it alone.
    const system = [
      cached("base"),
      plain("uncached filler"),
      cached("payment"),
      cached("module"),
      cached("strategies"),
    ];
    expect(capCacheControlBlocks(system)).toBe(system);
  });

  it("handles the trivial payloads", () => {
    expect(capCacheControlBlocks([])).toEqual([]);
    const one = [cached("base")];
    expect(capCacheControlBlocks(one)).toBe(one);
  });
});
