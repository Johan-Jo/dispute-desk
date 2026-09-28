/**
 * What the bank's claim disputes, and how that steers the letter
 * (lib/disputes/bankClaimAnalysis.ts). The fixture is the Sura Svenne test
 * claim of 2026-09-27: not-as-described, return requested, authorisation
 * "not in dispute" — the letter wrongly argued authorisation and "no return".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/defence/anthropicClient", () => ({ callClaudeMessages: vi.fn() }));

import {
  analyzeBankClaim,
  effectiveReasonForClaim,
  scopeFactsToBankClaim,
} from "@/lib/disputes/bankClaimAnalysis";
import { callClaudeMessages } from "@/lib/defence/anthropicClient";

const mockClaude = vi.mocked(callClaudeMessages);
const ok = (raw: string) => ({ raw, promptTokens: 1, completionTokens: 1, cachedTokens: 0, durationMs: 1, error: null });

beforeEach(() => vi.clearAllMocks());

describe("analyzeBankClaim", () => {
  it("parses the model's JSON, tolerating prose around it", async () => {
    mockClaude.mockResolvedValueOnce(
      ok('Here you go: {"reason":"PRODUCT_UNACCEPTABLE","authorizationDisputed":false,"returnOrRefundRequested":true}'),
    );
    const a = await analyzeBankClaim("The item is not as described…");
    expect(a).toMatchObject({ reason: "PRODUCT_UNACCEPTABLE", authorizationDisputed: false, returnOrRefundRequested: true });
  });

  it("an unknown reason becomes GENERAL; non-boolean flags become null", async () => {
    mockClaude.mockResolvedValueOnce(ok('{"reason":"WHATEVER","authorizationDisputed":"maybe","returnOrRefundRequested":null}'));
    expect(await analyzeBankClaim("x")).toMatchObject({ reason: "GENERAL", authorizationDisputed: null, returnOrRefundRequested: null });
  });

  it("returns null on a model error or unparseable output", async () => {
    mockClaude.mockResolvedValueOnce({ ...ok(""), raw: null, error: "Claude API error 500" });
    expect(await analyzeBankClaim("x")).toBeNull();
    mockClaude.mockResolvedValueOnce(ok("no json here"));
    expect(await analyzeBankClaim("x")).toBeNull();
  });
});

describe("scopeFactsToBankClaim", () => {
  const facts = [
    { id: "pa", category: "payment_authentication" },
    { id: "bm", category: "billing_match" },
    { id: "nr", category: "no_return_initiated" },
    { id: "or", category: "order_record" },
    { id: "pl", category: "product_listing" },
  ];

  it("Sura Svenne case: drops authorisation facts and the no-return fact, keeps the rest", () => {
    const r = scopeFactsToBankClaim(facts, { authorizationDisputed: false, returnOrRefundRequested: true });
    expect(r.facts.map((f) => f.id)).toEqual(["or", "pl"]);
    expect(r.removed).toEqual([
      { id: "pa", category: "payment_authentication", why: "authorization_not_disputed" },
      { id: "bm", category: "billing_match", why: "authorization_not_disputed" },
      { id: "nr", category: "no_return_initiated", why: "return_requested" },
    ]);
  });

  it("an unclear claim (nulls) removes nothing; a fraud claim keeps authorisation facts", () => {
    expect(scopeFactsToBankClaim(facts, { authorizationDisputed: null, returnOrRefundRequested: null }).facts).toHaveLength(5);
    expect(scopeFactsToBankClaim(facts, { authorizationDisputed: true, returnOrRefundRequested: false }).facts).toHaveLength(5);
    expect(scopeFactsToBankClaim(facts, null).facts).toHaveLength(5);
  });
});

describe("effectiveReasonForClaim", () => {
  it("uses the claim's reason only when Shopify's is GENERAL or missing", () => {
    expect(effectiveReasonForClaim("GENERAL", { reason: "PRODUCT_UNACCEPTABLE" })).toBe("PRODUCT_UNACCEPTABLE");
    expect(effectiveReasonForClaim(null, { reason: "PRODUCT_NOT_RECEIVED" })).toBe("PRODUCT_NOT_RECEIVED");
    expect(effectiveReasonForClaim("FRAUDULENT", { reason: "PRODUCT_UNACCEPTABLE" })).toBe("FRAUDULENT");
    expect(effectiveReasonForClaim("GENERAL", { reason: "GENERAL" })).toBe("GENERAL");
    expect(effectiveReasonForClaim("GENERAL", null)).toBe("GENERAL");
  });
});
