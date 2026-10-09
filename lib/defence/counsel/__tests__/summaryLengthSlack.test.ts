/**
 * #100705 (2026-09-29): counsel wrote a sound not-as-described letter whose
 * summary was 92 words against a 90 limit, still over after both corrections,
 * and the dispute lost its only letter (`no_counsel_letter`). A summary a few
 * words over is a style miss: it is still reported and corrected, it is still
 * fact-checked, but after the corrections it no longer costs the letter. Far
 * over still blocks.
 */
import { describe, expect, it } from "vitest";

import { ITEM_NOT_RECEIVED_BRIEF } from "../briefs";
import { SUMMARY_SLACK_WORDS, isSoftLengthIssue } from "../checks";
import { disputeFrame } from "../frame";
import { writeLetter, type ModelCall } from "../generate";
import { CHECK, LEDGER, V12_SUMMARY } from "./fixture352543";

const LIMIT = 80; // CHECK carries no brief: the base limit applies.
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const REQUEST = "The merchant requests that the chargeback be reversed.";

/** V12_SUMMARY padded with plain words before its request, to `n` words. */
function summaryOf(n: number): string {
  const body = V12_SUMMARY.replace(REQUEST, "").trim();
  const pad = n - words(body) - words(REQUEST);
  const s = `${body} ${Array.from({ length: pad }, () => "indeed").join(" ")} ${REQUEST}`;
  expect(words(s)).toBe(n);
  return s;
}

const draftJson = (s: string) =>
  JSON.stringify({
    summary: [s],
    summaryClaimIds: ["carrier_delivered"],
    sections: {},
    conclusion: { text: "The carrier recorded delivery of the order. The non-receipt claim is not supported by the record.", claimIds: ["carrier_delivered"] },
  });
const CLEAN = JSON.stringify({ errors: [], unclear: [] });

function scripted(replies: string[]): { call: ModelCall; stages: string[] } {
  const stages: string[] = [];
  const queue = [...replies];
  return {
    stages,
    call: async ({ stage }) => {
      stages.push(stage);
      const r = queue.shift();
      if (r === undefined) throw new Error(`unexpected ${stage} call`);
      return r;
    },
  };
}

const write = (call: ModelCall) =>
  writeLetter({
    ledger: LEDGER,
    brief: ITEM_NOT_RECEIVED_BRIEF,
    frame: disputeFrame({ paymentFamily: null, paymentLabel: null, phase: "chargeback" }),
    merchantName: "Blume",
    pageContext: "Header: …",
    check: CHECK,
    call,
  });

describe("summary length slack (#100705)", () => {
  it("uses the shortened summary when the shortener gets it under the limit", async () => {
    const over = draftJson(summaryOf(LIMIT + 2));
    const short = V12_SUMMARY; // 75 words, under the limit
    const s = scripted([over, CLEAN, over, CLEAN, over, CLEAN, short, CLEAN]);
    const r = await write(s.call);
    // Two corrections, then the summary-only shortener; every draft fact-checked.
    expect(s.stages).toEqual(["write", "review", "correction", "review", "correction", "review", "correction", "review"]);
    expect(r.draft.summary.paragraphs).toEqual([short]);
    expect(r.ok).toBe(true);
  });

  it("keeps the letter when the shortener also misses by a few words", async () => {
    const overText = summaryOf(LIMIT + 2);
    const over = draftJson(overText);
    const s = scripted([over, CLEAN, over, CLEAN, over, CLEAN, summaryOf(LIMIT + 1), CLEAN]);
    const r = await write(s.call);
    expect(r.draft.summary.paragraphs).toEqual([overText]);
    expect(r.issues.every(isSoftLengthIssue)).toBe(true);
    expect(r.ok).toBe(true);
  });

  it("still blocks on a fact-check error in a slightly-over summary", async () => {
    const over = draftJson(summaryOf(LIMIT + 2));
    const bad = JSON.stringify({ errors: [{ sentence: "x", problem: "not in the ledger" }], unclear: [] });
    const s = scripted([over, bad, over, bad, over, bad]);
    const r = await write(s.call);
    // A fact error is not a length issue: no shortener call.
    expect(s.stages).toEqual(["write", "review", "correction", "review", "correction", "review"]);
    expect(r.ok).toBe(false);
  });

  // #99199 (prod, 2026-10-09): the reviewer listed a correct sentence under
  // "errors" while its own note ended "This is correct"; the letter was lost.
  it("does not block on an error the reviewer itself retracts", async () => {
    const ok = draftJson(V12_SUMMARY);
    const retracted = JSON.stringify({
      errors: [{ sentence: "x", problem: "The interval is inverted … let me re-examine. This is correct.", verdict: "correct" }],
      unclear: [],
    });
    const s = scripted([ok, retracted]);
    const r = await write(s.call);
    expect(s.stages).toEqual(["write", "review"]);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("still blocks on an error with verdict \"error\" or with none", async () => {
    const ok = draftJson(V12_SUMMARY);
    const confirmed = JSON.stringify({ errors: [{ sentence: "x", problem: "not in the ledger", verdict: "error" }], unclear: [] });
    const bare = JSON.stringify({ errors: [{ sentence: "x", problem: "not in the ledger" }], unclear: [] });
    const r = await write(scripted([ok, confirmed, ok, bare, ok, confirmed]).call);
    expect(r.ok).toBe(false);
    expect(r.issues).toHaveLength(1);
  });

  it("still blocks a summary more than the slack over the limit", async () => {
    const far = draftJson(summaryOf(LIMIT + SUMMARY_SLACK_WORDS + 1));
    const s = scripted([far, far, far, summaryOf(LIMIT + SUMMARY_SLACK_WORDS + 1)]);
    const r = await write(s.call);
    expect(s.stages).toEqual(["write", "correction", "correction", "correction"]);
    expect(r.ok).toBe(false);
  });
});
