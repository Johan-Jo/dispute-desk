/**
 * Prod, 2026-11-10 (dispute d65b7220): a 93-word summary went through the
 * shortening pass and came back still over, so the letter was withheld. The
 * shortener's own target was a hard-coded 70 that bore no relation to the
 * limit the check enforces. It now derives its target from the same constants
 * and states the current count. No retry loop: still exactly one shorten call.
 */
import { describe, expect, it } from "vitest";

import { ITEM_NOT_RECEIVED_BRIEF } from "../briefs";
import { SUMMARY_LIMIT_WORDS, SUMMARY_LIMIT_WORDS_MANY_SECTIONS, summaryLimitFor } from "../checks";
import { disputeFrame } from "../frame";
import { SHORTEN_MARGIN_WORDS, shortenSystem, writeLetter, type ModelCall } from "../generate";
import { CHECK, LEDGER, V12_SUMMARY } from "./fixture352543";

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const REQUEST = "The merchant requests that the chargeback be reversed.";

/** The recorded over-length summary: 93 words, ends with the request. */
const RECORDED_93 = (() => {
  const body = V12_SUMMARY.replace(REQUEST, "").trim();
  const pad = 93 - words(body) - words(REQUEST);
  return `${body} ${Array.from({ length: pad }, () => "indeed").join(" ")} ${REQUEST}`;
})();

const draftJson = (s: string) =>
  JSON.stringify({
    summary: [s],
    summaryClaimIds: ["carrier_delivered"],
    sections: {},
    conclusion: { text: "The carrier recorded delivery of the order. The non-receipt claim is not supported by the record.", claimIds: ["carrier_delivered"] },
  });
const CLEAN = JSON.stringify({ errors: [], unclear: [] });

describe("summary shortener target", () => {
  it("derives its target from the enforced limit, not a second number", () => {
    expect(shortenSystem(SUMMARY_LIMIT_WORDS, 93)).toContain(`At most ${SUMMARY_LIMIT_WORDS - SHORTEN_MARGIN_WORDS} words`);
    expect(shortenSystem(SUMMARY_LIMIT_WORDS_MANY_SECTIONS, 93)).toContain(
      `At most ${SUMMARY_LIMIT_WORDS_MANY_SECTIONS - SHORTEN_MARGIN_WORDS} words`,
    );
    expect(shortenSystem(80, 93)).toContain("93 words");
  });

  it("the limit the shortener reads is the one checkDraft enforces", () => {
    const d = { summary: { paragraphs: [], claimIds: [] }, evidenceSections: [], conclusion: { paragraphs: [], claimIds: [] } };
    expect(summaryLimitFor(d as never, CHECK)).toBe(SUMMARY_LIMIT_WORDS);
  });

  it("sends the shortener the real limit and count for the recorded 93-word summary, and calls it once", async () => {
    const over = draftJson(RECORDED_93);
    const seen: Array<{ stage: string; system: string }> = [];
    const queue = [over, over, over, V12_SUMMARY, CLEAN]; // far over: no review until the shortened draft
    const call: ModelCall = async ({ stage, system }) => {
      seen.push({ stage, system });
      const r = queue.shift();
      if (r === undefined) throw new Error(`unexpected ${stage} call`);
      return r;
    };
    const r = await writeLetter({
      ledger: LEDGER,
      brief: ITEM_NOT_RECEIVED_BRIEF,
      frame: disputeFrame({ paymentFamily: null, paymentLabel: null, phase: "chargeback" }),
      merchantName: "Blume",
      pageContext: "Header: …",
      check: CHECK,
      call,
    });
    expect(words(RECORDED_93)).toBe(93);
    const shorten = seen.filter((s) => s.system.includes("shorten the executive summary"));
    expect(shorten).toHaveLength(1);
    expect(shorten[0].system).toContain(`At most ${SUMMARY_LIMIT_WORDS - SHORTEN_MARGIN_WORDS} words`);
    expect(shorten[0].system).toContain("93 words");
    expect(r.ok).toBe(true);
  });
});
