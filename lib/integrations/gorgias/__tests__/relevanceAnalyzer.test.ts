/**
 * Relevance-analyzer tests — normalization is the security boundary
 * against prompt injection, so it gets the densest matrix: invented ids,
 * bad categories, missing explanations, paraphrased excerpts, confidence
 * clamping. Plus segment selection, payload capping, cap short-circuit,
 * and the retry-on-parse loop.
 */

import { describe, expect, it, vi } from "vitest";
import {
  MAX_MESSAGES_PER_CALL,
  MAX_SEGMENT_CHARS,
  analyzeGorgiasRelevance,
  buildAnalyzerPayload,
  normalizeAnalyzerOutput,
  selectAnalysisSegment,
  type AnalyzerCaseInput,
  type AnalyzerMessageInput,
} from "../relevanceAnalyzer";

function msgInput(over: Partial<AnalyzerMessageInput> = {}): AnalyzerMessageInput {
  return {
    id: "m1",
    senderType: "customer",
    sentAt: "2026-03-10T10:00:00Z",
    text: "I received order #1066 yesterday and it works great.",
    contentTruncated: false,
    ...over,
  };
}

function caseInput(messages: AnalyzerMessageInput[]): AnalyzerCaseInput {
  return {
    disputeReason: "product_not_received",
    networkReasonCode: "13.1",
    orderName: "#1066",
    orderCreatedAt: "2026-03-01T10:00:00Z",
    deliveredAt: "2026-03-06T10:00:00Z",
    explanationLocale: "sv",
    tickets: [{ ticketId: 42, channel: "email", subject: "Order", messages }],
  };
}

function includedMap(...msgs: AnalyzerMessageInput[]) {
  return new Map(msgs.map((m) => [m.id, m]));
}

describe("normalizeAnalyzerOutput — validation matrix", () => {
  const included = includedMap(msgInput());

  it("accepts a valid proposal", () => {
    const out = normalizeAnalyzerOutput(
      JSON.stringify({
        messages: [
          {
            id: "m1",
            relevant: true,
            category: "delivery_recognition",
            explanation: "Kunden bekräftar mottagandet.",
            confidence: 88,
          },
        ],
      }),
      included,
    )!;
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0]).toMatchObject({
      id: "m1",
      category: "delivery_recognition",
      confidence: 88,
    });
    expect(out.rejectedCount).toBe(0);
  });

  it("drops invented message ids", () => {
    const out = normalizeAnalyzerOutput(
      JSON.stringify({
        messages: [
          {
            id: "not-a-real-id",
            relevant: true,
            category: "delivery_recognition",
            explanation: "x",
            confidence: 90,
          },
        ],
      }),
      included,
    )!;
    expect(out.proposals).toHaveLength(0);
    expect(out.rejectedCount).toBe(1);
  });

  it("drops non-allowlisted categories (injection can't mint new enums)", () => {
    const out = normalizeAnalyzerOutput(
      JSON.stringify({
        messages: [
          {
            id: "m1",
            relevant: true,
            category: "proof_of_delivery_supreme",
            explanation: "x",
            confidence: 90,
          },
        ],
      }),
      included,
    )!;
    expect(out.proposals).toHaveLength(0);
    expect(out.rejectedCount).toBe(1);
  });

  it("no explanation → no proposal (PRD 10.7)", () => {
    const out = normalizeAnalyzerOutput(
      JSON.stringify({
        messages: [
          { id: "m1", relevant: true, category: "product_usage", explanation: "  ", confidence: 50 },
        ],
      }),
      included,
    )!;
    expect(out.proposals).toHaveLength(0);
    expect(out.rejectedCount).toBe(1);
  });

  it("rejects paraphrased excerpts — verbatim substring or nothing", () => {
    const out = normalizeAnalyzerOutput(
      JSON.stringify({
        messages: [
          {
            id: "m1",
            relevant: true,
            category: "delivery_recognition",
            explanation: "ok",
            confidence: 70,
            excerpt: "I definitely received the order", // paraphrase
          },
        ],
      }),
      included,
    )!;
    expect(out.proposals).toHaveLength(0);
    expect(out.rejectedCount).toBe(1);

    const okOut = normalizeAnalyzerOutput(
      JSON.stringify({
        messages: [
          {
            id: "m1",
            relevant: true,
            category: "delivery_recognition",
            explanation: "ok",
            confidence: 70,
            excerpt: "received order #1066 yesterday", // verbatim
          },
        ],
      }),
      included,
    )!;
    expect(okOut.proposals).toHaveLength(1);
  });

  it("clamps confidence to 0–100 integers", () => {
    const out = normalizeAnalyzerOutput(
      JSON.stringify({
        messages: [
          { id: "m1", relevant: true, category: "contradiction", explanation: "x", confidence: 940 },
        ],
      }),
      included,
    )!;
    expect(out.proposals[0].confidence).toBe(100);
  });

  it("dedupes multiple emissions for the same id", () => {
    const out = normalizeAnalyzerOutput(
      JSON.stringify({
        messages: [
          { id: "m1", relevant: true, category: "contradiction", explanation: "a", confidence: 60 },
          { id: "m1", relevant: true, category: "product_usage", explanation: "b", confidence: 70 },
        ],
      }),
      included,
    )!;
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0].explanation).toBe("a");
  });

  it("returns null on unparseable / wrong-shape output (retry signal)", () => {
    expect(normalizeAnalyzerOutput("not json at all", included)).toBeNull();
    expect(normalizeAnalyzerOutput(JSON.stringify({ nope: [] }), included)).toBeNull();
  });
});

describe("selectAnalysisSegment", () => {
  it("returns short text whole", () => {
    const seg = selectAnalysisSegment("short text", ["#1066"]);
    expect(seg).toEqual({ text: "short text", truncated: false });
  });

  it("centers the segment on the order-number anchor in long text", () => {
    const long = "y".repeat(5000) + " regarding order #1066 thanks " + "z".repeat(5000);
    const seg = selectAnalysisSegment(long, ["#1066"]);
    expect(seg.truncated).toBe(true);
    expect(seg.text).toContain("#1066");
    expect(seg.text.length).toBe(MAX_SEGMENT_CHARS);
  });

  it("falls back to dispute keywords, then head", () => {
    const long = "a".repeat(5000) + " I want a refund now " + "b".repeat(5000);
    expect(selectAnalysisSegment(long, ["#1066"]).text).toContain("refund");
    const noAnchor = "c".repeat(5000);
    expect(selectAnalysisSegment(noAnchor, []).text).toBe("c".repeat(MAX_SEGMENT_CHARS));
  });
});

describe("buildAnalyzerPayload", () => {
  it("caps at MAX_MESSAGES_PER_CALL and counts overflow", () => {
    const messages = Array.from({ length: MAX_MESSAGES_PER_CALL + 15 }, (_, i) =>
      msgInput({ id: `m${i}` }),
    );
    const { included, overflowCount } = buildAnalyzerPayload(caseInput(messages));
    expect(included.size).toBe(MAX_MESSAGES_PER_CALL);
    expect(overflowCount).toBe(15);
  });

  it("marks stored-truncated messages truncated in the payload", () => {
    const { payload } = buildAnalyzerPayload(
      caseInput([msgInput({ contentTruncated: true })]),
    );
    const tickets = (payload as { tickets: Array<{ messages: Array<{ truncated: boolean }> }> }).tickets;
    expect(tickets[0].messages[0].truncated).toBe(true);
  });
});

describe("analyzeGorgiasRelevance", () => {
  it("short-circuits on the daily cap without calling the model", async () => {
    const callClaude = vi.fn();
    const res = await analyzeGorgiasRelevance("shop-1", caseInput([msgInput()]), {
      callClaude,
      checkCap: async () => ({ capReached: true }),
    });
    expect(res.capReached).toBe(true);
    expect(callClaude).not.toHaveBeenCalled();
  });

  it("retries once on parse failure, then succeeds", async () => {
    const callClaude = vi
      .fn()
      .mockResolvedValueOnce({
        raw: "garbage {{",
        promptTokens: 100,
        completionTokens: 10,
        cachedTokens: 0,
        durationMs: 5,
        error: null,
      })
      .mockResolvedValueOnce({
        raw: JSON.stringify({
          messages: [
            { id: "m1", relevant: true, category: "product_usage", explanation: "x", confidence: 60 },
          ],
        }),
        promptTokens: 100,
        completionTokens: 20,
        cachedTokens: 90,
        durationMs: 5,
        error: null,
      });
    const res = await analyzeGorgiasRelevance("shop-1", caseInput([msgInput()]), {
      callClaude,
      checkCap: async () => ({ capReached: false }),
    });
    expect(callClaude).toHaveBeenCalledTimes(2);
    expect(res.proposals).toHaveLength(1);
    expect(res.tokens.prompt).toBe(200);
    expect(res.error).toBeNull();
  });

  it("reports an error after two failed attempts", async () => {
    const callClaude = vi.fn().mockResolvedValue({
      raw: null,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      durationMs: 2,
      error: "Claude API error 529: overloaded",
    });
    const res = await analyzeGorgiasRelevance("shop-1", caseInput([msgInput()]), {
      callClaude,
      checkCap: async () => ({ capReached: false }),
    });
    expect(callClaude).toHaveBeenCalledTimes(2);
    expect(res.proposals).toHaveLength(0);
    expect(res.error).toMatch(/529/);
  });

  it("returns empty without calling the model when there are no messages", async () => {
    const callClaude = vi.fn();
    const res = await analyzeGorgiasRelevance("shop-1", caseInput([]), {
      callClaude,
      checkCap: async () => ({ capReached: false }),
    });
    expect(res.proposals).toHaveLength(0);
    expect(callClaude).not.toHaveBeenCalled();
  });
});
