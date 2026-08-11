/**
 * The list's `?strength=` filter and its strength pill answer from ONE
 * usability predicate — asserted through the real route handler.
 *
 * ── WHAT WENT WRONG, AND WHY SOURCE ASSERTIONS MISSED IT ──────────────
 *
 * The pill checked the policy version and `rebuild_pending`; the filter query
 * selected only `->strength->>overall`, so it checked neither. A
 * superseded-policy Strong snapshot therefore MATCHED `?strength=strong` and
 * then rendered as unassessed: the merchant filtered to Strong and got a page
 * of blanks.
 *
 * A test asserting the route's source mentions `ASSESSMENT_POLICY_VERSION`
 * passed throughout — the constant was mentioned, on the other code path. Only
 * running the handler can tell the two apart, so these call `GET`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/middleware/extractShopId", () => ({
  extractShopId: vi.fn().mockReturnValue("shop-1"),
}));
vi.mock("@/lib/disputes/presentation/serverFacts", () => ({
  gatherPresentations: vi.fn().mockResolvedValue(new Map()),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { GET } from "@/app/api/disputes/route";
import { NextRequest } from "next/server";
import { ASSESSMENT_POLICY_VERSION, ASSESSMENT_VERSION } from "@/lib/evidence/model/assessmentSnapshot";

const mockSb = vi.mocked(getServiceClient);

const DISPUTE_ID = "d1";

/** A snapshot carrying a STRONG band. Only its version fields vary. */
function strongSnapshot(over: { policyVersion?: number; assessmentVersion?: number } = {}) {
  return {
    caseId: DISPUTE_ID,
    assessmentVersion: over.assessmentVersion ?? ASSESSMENT_VERSION,
    strength: {
      overall: "strong",
      score: 9,
      coveragePercent: 92,
      strongCount: 3,
      moderateCount: 0,
      supportingCount: 0,
      supportedClaims: 3,
      totalClaims: 3,
      improvementHintI18n: null,
      strengthReasonI18n: { key: "disputes.strengthReason.general.strong" },
      heroVariant: "likely_to_win",
    },
    completeness: {
      score: 95,
      evidenceStrengthScore: 90,
      readiness: "ready",
      blockers: [],
    },
    gateDecision: null,
    reviewRequiredCount: 0,
    modelVersion: 1,
    freshness: {
      inputHash: "h",
      policyVersion: over.policyVersion ?? ASSESSMENT_POLICY_VERSION,
      computedAt: "2026-08-10T00:00:00.000Z",
    },
  };
}

const DISPUTE_ROW = {
  id: DISPUTE_ID,
  shop_id: "shop-1",
  reason: "FRAUDULENT",
  status: "needs_response",
  normalized_status: "in_progress",
  customer_display_name: "A Customer",
  created_at: "2026-08-01T00:00:00.000Z",
  due_at: "2026-08-20T00:00:00.000Z",
  closed_at: null,
  final_outcome: null,
  submission_state: "not_saved",
  amount: 100,
  currency_code: "USD",
  phase: "chargeback",
};

/**
 * One Supabase stub serving both the dispute list and the pack queries.
 *
 * The SAME pack row answers the filter query and the pill query, which is the
 * point: two surfaces reading one row must not reach two conclusions.
 */
function setup(opts: {
  snapshot: unknown;
  rebuildPending?: boolean;
}) {
  const packRow = {
    id: "p1",
    dispute_id: DISPUTE_ID,
    status: "ready",
    created_at: "2026-08-02T00:00:00.000Z",
    rebuild_pending: opts.rebuildPending ?? false,
    case_assessment: opts.snapshot,
  };

  const from = vi.fn((table: string) => {
    if (table === "evidence_packs") {
      const chain: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
      };
      // Both pack queries end in `.order(...)` and are awaited.
      chain.order = vi.fn(() =>
        Promise.resolve({ data: [packRow], error: null }),
      );
      return chain;
    }
    if (table === "disputes") {
      /* The id pre-filter is HONOURED, not swallowed.
       *
       * `?strength=` resolves a match set and applies it as `.in("id", …)`,
       * with an impossible uuid when nothing matched. A stub that ignored
       * `.in()` would return the row regardless and every filter assertion
       * below would pass on a route that filters nothing. */
      let idFilter: string[] | null = null;
      const chain: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn((col: string, ids: string[]) => {
          if (col === "id") idFilter = ids;
          return chain;
        }),
        is: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        range: vi.fn(() => {
          const rows =
            idFilter === null || idFilter.includes(DISPUTE_ID) ? [DISPUTE_ROW] : [];
          return Promise.resolve({ data: rows, error: null, count: rows.length });
        }),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      return chain;
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order: vi.fn(() => Promise.resolve({ data: [], error: null })),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      range: vi.fn(() => Promise.resolve({ data: [], error: null, count: 0 })),
    };
  });

  mockSb.mockReturnValue({ from } as never);
}

async function listWith(query: string) {
  const res = await GET(
    new NextRequest(`https://x.test/api/disputes${query}`) as never,
  );
  return (await res.json()) as {
    disputes?: Array<{ id: string; caseStrength: { overall: string } | null }>;
  };
}

beforeEach(() => vi.clearAllMocks());

describe("guard the guard — a CURRENT strong snapshot does both things", () => {
  it("renders Strong and matches ?strength=strong", async () => {
    /* Without this, every assertion below would be satisfiable by a route that
     * simply never returns anything. */
    setup({ snapshot: strongSnapshot() });
    const shown = await listWith("");
    expect(shown.disputes?.[0]?.caseStrength?.overall).toBe("strong");

    setup({ snapshot: strongSnapshot() });
    const filtered = await listWith("?strength=strong");
    expect(filtered.disputes?.map((d) => d.id)).toEqual([DISPUTE_ID]);
  });
});

describe("a SUPERSEDED-POLICY strong snapshot", () => {
  it("displays no Strong verdict", async () => {
    setup({ snapshot: strongSnapshot({ policyVersion: ASSESSMENT_POLICY_VERSION - 1 }) });
    const body = await listWith("");
    expect(body.disputes?.[0]?.caseStrength).toBeNull();
  });

  it("does not match ?strength=strong", async () => {
    /* The defect, precisely: the filter used to select only the band, so this
     * dispute matched and then rendered blank. */
    setup({ snapshot: strongSnapshot({ policyVersion: ASSESSMENT_POLICY_VERSION - 1 }) });
    const body = await listWith("?strength=strong");
    expect(body.disputes ?? []).toEqual([]);
  });
});

describe("a REBUILD-PENDING strong snapshot", () => {
  it("displays no Strong verdict", async () => {
    setup({ snapshot: strongSnapshot(), rebuildPending: true });
    const body = await listWith("");
    expect(body.disputes?.[0]?.caseStrength).toBeNull();
  });

  it("does not match ?strength=strong", async () => {
    setup({ snapshot: strongSnapshot(), rebuildPending: true });
    const body = await listWith("?strength=strong");
    expect(body.disputes ?? []).toEqual([]);
  });
});

describe("a snapshot from a superseded ASSESSMENT SHAPE", () => {
  it("is unusable on both surfaces", async () => {
    setup({ snapshot: strongSnapshot({ assessmentVersion: ASSESSMENT_VERSION + 1 }) });
    expect((await listWith("")).disputes?.[0]?.caseStrength).toBeNull();

    setup({ snapshot: strongSnapshot({ assessmentVersion: ASSESSMENT_VERSION + 1 }) });
    expect((await listWith("?strength=strong")).disputes ?? []).toEqual([]);
  });
});

describe("an ABSENT snapshot", () => {
  it("displays nothing and matches nothing", async () => {
    setup({ snapshot: null });
    expect((await listWith("")).disputes?.[0]?.caseStrength).toBeNull();

    setup({ snapshot: null });
    expect((await listWith("?strength=strong")).disputes ?? []).toEqual([]);
  });
});
