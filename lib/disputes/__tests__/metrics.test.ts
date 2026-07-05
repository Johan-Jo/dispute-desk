/**
 * Tests for `computeDisputeMetrics` — the shared dashboard math.
 *
 * Closes the "Dashboard metrics tests" gap from
 * RELEASE_TESTING_PLAN.md §12. Covers the count, sum, rate, period-
 * over-period, and breakdown logic against fixture dispute rows.
 *
 * Supabase + chargebackRate are mocked. The actual SQL view + snapshot
 * semantics are exercised by the seeded smoke (`scripts/smoke-test.mjs`)
 * and by the chargebackRate module's own test (when added).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/disputes/chargebackRate", () => ({
  computeChargebackRate: vi.fn(),
  defaultWindowEndDate: vi.fn((d: Date) => d.toISOString().slice(0, 10)),
  windowStartDate: vi.fn((to: string, days: number) => {
    const d = new Date(to);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  }),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { computeChargebackRate } from "@/lib/disputes/chargebackRate";
import { computeDisputeMetrics } from "@/lib/disputes/metrics";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockChargebackRate = vi.mocked(computeChargebackRate);

type DisputeRow = Record<string, unknown>;

interface ScenarioRows {
  /** Disputes for the shop. Production fetches all rows in one query and
   *  applies the period in-memory (snapshot metrics span all rows; outcome
   *  metrics are windowed by closed_at). */
  current: DisputeRow[];
  /** Additional rows representing the prior window (closed earlier). Merged
   *  into the single result set; kept as a separate field only for
   *  readability in period-over-period tests. */
  previous?: DisputeRow[];
  /** Notes count (admin-only path). */
  notesCount?: number;
}

/** Wires a per-table Supabase mock that returns a sequence of dispute
 *  rows. The route fetches:
 *    1. current period (full select)
 *    2. previous period (only when periodFrom set; partial select)
 *    3. dispute_notes count (admin-only, when shopId omitted)
 *  We track call sequence per-table via call indices. */
function mockSupabase(rows: ScenarioRows): void {
  // Production makes ONE disputes query (all rows for the shop — no
  // created_at window; the period is applied in-memory per metric) plus,
  // on the admin path, one dispute_notes count query. A chained-thenable
  // returns `this` for every builder method and resolves to { data } when
  // awaited.
  const makeThenable = (data: DisputeRow[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj: any = {};
    obj.select = () => obj;
    obj.eq = () => obj;
    obj.gte = () => obj;
    obj.lte = () => obj;
    obj.lt = () => obj;
    obj.not = () => obj;
    obj.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(resolve({ data, error: null }));
    return obj;
  };

  const fromImpl = (table: string) => {
    if (table === "disputes") {
      // The `previous` field is retained on ScenarioRows for readability
      // in period-over-period tests: since production now derives the
      // prior window from the same all-rows fetch (by closed_at), any
      // `previous` rows are merged into the single result set here.
      const all = [...rows.current, ...(rows.previous ?? [])];
      return makeThenable(all);
    }
    if (table === "dispute_notes") {
      return {
        select: () => Promise.resolve({
          count: rows.notesCount ?? 0,
          data: null,
          error: null,
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  };

  mockGetServiceClient.mockReturnValue({ from: fromImpl } as never);
}

const NULL_CHARGEBACK = {
  rate: null,
  rateChange: null,
  numerator: 0,
  denominator: 0,
  available: false,
  lowVolume: false,
  lastSyncedAt: null,
  daysCovered: 0,
};

describe("computeDisputeMetrics — counts and rates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChargebackRate.mockResolvedValue(NULL_CHARGEBACK as never);
  });

  it("counts active disputes from ACTIVE_NORMALIZED statuses and sums amountAtRisk", async () => {
    mockSupabase({
      current: [
        { id: "1", normalized_status: "new", amount: 100 },
        { id: "2", normalized_status: "needs_review", amount: 50 },
        { id: "3", normalized_status: "waiting_on_issuer", amount: 200 },
        { id: "4", normalized_status: "won", amount: 999 },        // closed → excluded
        { id: "5", normalized_status: "lost", amount: 999 },       // closed → excluded
      ],
    });

    const m = await computeDisputeMetrics({ shopId: "s1" });
    expect(m.activeDisputes).toBe(3);
    expect(m.amountAtRisk).toBe(350);
  });

  it("computes winRate from final_outcome won/lost and ignores rows without an outcome", async () => {
    // Outcome metrics window by closed_at, so decided rows carry a
    // closed_at. All-time query (no periodFrom) → every closed row counts.
    const C = "2026-04-10T00:00:00Z";
    mockSupabase({
      current: [
        { id: "1", final_outcome: "won", closed_at: C },
        { id: "2", final_outcome: "won", closed_at: C },
        { id: "3", final_outcome: "won", closed_at: C },
        { id: "4", final_outcome: "lost", closed_at: C },
        { id: "5", final_outcome: null }, // not counted
        { id: "6", final_outcome: undefined }, // not counted
      ],
    });

    const m = await computeDisputeMetrics({ shopId: "s1" });
    expect(m.disputesWon).toBe(3);
    expect(m.disputesLost).toBe(1);
    expect(m.winRate).toBe(75); // 3/4
  });

  it("returns winRate=0 with no won/lost disputes (no division by zero)", async () => {
    mockSupabase({
      current: [
        { id: "1", normalized_status: "new" },
        { id: "2", final_outcome: null },
      ],
    });
    const m = await computeDisputeMetrics({ shopId: "s1" });
    expect(m.winRate).toBe(0);
  });

  it("sums amountRecovered + amountLost and computes recoveryRate", async () => {
    // Financial outcomes window by closed_at → rows need a closed_at.
    const C = "2026-04-10T00:00:00Z";
    mockSupabase({
      current: [
        { outcome_amount_recovered: 300, outcome_amount_lost: 0, closed_at: C },
        { outcome_amount_recovered: 0, outcome_amount_lost: 100, closed_at: C },
        { outcome_amount_recovered: 100, outcome_amount_lost: 0, closed_at: C },
      ],
    });
    const m = await computeDisputeMetrics({ shopId: "s1" });
    expect(m.amountRecovered).toBe(400);
    expect(m.amountLost).toBe(100);
    expect(m.recoveryRate).toBe(80); // 400/(400+100)
  });

  it("counts totalClosed by closed_at presence (all-time)", async () => {
    mockSupabase({
      current: [
        { closed_at: "2026-04-01T00:00:00Z" },
        { closed_at: "2026-04-15T00:00:00Z" },
        { closed_at: null },
      ],
    });
    const m = await computeDisputeMetrics({ shopId: "s1" });
    expect(m.totalClosed).toBe(2);
  });

  it("windows totalClosed by closed_at, NOT created_at (bulk-import regression)", async () => {
    // Regression for the cay-collective dashboard bug: an established
    // shop's history was bulk-imported on a single day, so every imported
    // dispute shares one created_at. The old code derived totalClosed
    // (and every outcome metric) from a created_at-windowed row set, which
    // counted all historical closures as "closed this period" until the
    // import aged out — then cliffed to 0. Now the query fetches all rows
    // and windows by closed_at in-memory. Only the rows whose closed_at
    // falls in [periodFrom, now] count.
    const now = "2026-07-05T00:00:00Z";
    mockSupabase({
      current: [
        // 2 closed inside the window (after periodFrom 2026-06-05)
        { id: "a", closed_at: "2026-06-18T00:00:00Z", final_outcome: "won" },
        { id: "b", closed_at: "2026-06-20T00:00:00Z", final_outcome: "won" },
        // 59 closed BEFORE the window — same shop history, must be excluded
        ...Array.from({ length: 59 }, (_, i) => ({
          id: `old-${i}`,
          closed_at: "2026-04-01T00:00:00Z",
          final_outcome: "won",
        })),
      ],
    });
    const m = await computeDisputeMetrics({
      shopId: "s1",
      periodFrom: "2026-06-05T00:00:00Z",
      periodTo: now,
    });
    // Only the 2 closed inside the window — not all 61.
    expect(m.totalClosed).toBe(2);
    expect(m.disputesWon).toBe(2);
  });

  it("computes avgTimeToSubmit in days and rounds to 1 decimal place", async () => {
    const day = 24 * 60 * 60 * 1000;
    // Timing is scoped to disputes decided in the window (closed_at set).
    const C = new Date(10 * day).toISOString();
    mockSupabase({
      current: [
        // 3 days
        { initiated_at: new Date(0).toISOString(), submitted_at: new Date(3 * day).toISOString(), closed_at: C },
        // 5 days
        { initiated_at: new Date(0).toISOString(), submitted_at: new Date(5 * day).toISOString(), closed_at: C },
      ],
    });
    const m = await computeDisputeMetrics({ shopId: "s1" });
    expect(m.avgTimeToSubmit).toBe(4); // (3 + 5) / 2
  });

  it("returns avgTimeToSubmit=null when no dispute has both initiated_at and submitted_at", async () => {
    mockSupabase({
      current: [
        { initiated_at: null, submitted_at: "2026-04-01T00:00:00Z" },
      ],
    });
    const m = await computeDisputeMetrics({ shopId: "s1" });
    expect(m.avgTimeToSubmit).toBeNull();
  });

  it("builds statusBreakdown (snapshot, all rows) and outcomeBreakdown (windowed by closed_at)", async () => {
    const C = "2026-04-10T00:00:00Z";
    mockSupabase({
      current: [
        { normalized_status: "new", final_outcome: null },
        { normalized_status: "new", final_outcome: null },
        { normalized_status: "needs_review", final_outcome: null },
        { normalized_status: "won", final_outcome: "won", closed_at: C },
        { normalized_status: "won", final_outcome: "won", closed_at: C },
        { normalized_status: "lost", final_outcome: "lost", closed_at: C },
      ],
    });
    const m = await computeDisputeMetrics({ shopId: "s1" });
    // statusBreakdown spans ALL disputes (snapshot).
    expect(m.statusBreakdown).toEqual({
      new: 2,
      needs_review: 1,
      won: 2,
      lost: 1,
    });
    // outcomeBreakdown counts only disputes decided in the window.
    expect(m.outcomeBreakdown).toEqual({
      won: 2,
      lost: 1,
    });
  });

  it("counts inquiry vs chargeback among ACTIVE disputes only", async () => {
    mockSupabase({
      current: [
        { normalized_status: "new", phase: "inquiry" },
        { normalized_status: "new", phase: "inquiry" },
        { normalized_status: "needs_review", phase: "chargeback" },
        // closed disputes don't count toward inquiry/chargeback
        { normalized_status: "won", phase: "chargeback" },
      ],
    });
    const m = await computeDisputeMetrics({ shopId: "s1" });
    expect(m.inquiryCount).toBe(2);
    expect(m.chargebackCount).toBe(1);
  });

  it("counts needsAttention across the full row set (not just active)", async () => {
    mockSupabase({
      current: [
        { normalized_status: "new", needs_attention: true },
        { normalized_status: "won", needs_attention: true },
        { normalized_status: "lost", needs_attention: false },
      ],
    });
    const m = await computeDisputeMetrics({ shopId: "s1" });
    expect(m.needsAttentionCount).toBe(2);
  });

  it("picks the most-common currency_code and defaults to USD when none present", async () => {
    mockSupabase({
      current: [
        { currency_code: "EUR" },
        { currency_code: "EUR" },
        { currency_code: "USD" },
      ],
    });
    const eur = await computeDisputeMetrics({ shopId: "s1" });
    expect(eur.currencyCode).toBe("EUR");

    mockSupabase({ current: [] });
    const empty = await computeDisputeMetrics({ shopId: "s1" });
    expect(empty.currencyCode).toBe("USD");
  });

  it("scopes amount sums to the primary currency and emits other currency counts", async () => {
    // EUR wins the popularity contest (2 disputes) so it becomes the
    // primary currency. The SEK + USD disputes must NOT be summed into
    // EUR totals (a real bug we shipped to prod before this test) and
    // must instead surface via `otherCurrencyCounts` so the UI can hint
    // that they exist.
    const C = "2026-04-10T00:00:00Z";
    mockSupabase({
      current: [
        // 2 active EUR — included in amountAtRisk
        { normalized_status: "new", currency_code: "EUR", amount: 100, outcome_amount_recovered: 0, outcome_amount_lost: 0 },
        { normalized_status: "new", currency_code: "EUR", amount: 50,  outcome_amount_recovered: 0, outcome_amount_lost: 0 },
        // 1 active SEK — counted in activeDisputes but NOT in amountAtRisk
        { normalized_status: "new", currency_code: "SEK", amount: 999, outcome_amount_recovered: 0, outcome_amount_lost: 0 },
        // 1 closed USD — currency-other, also affects recovered/lost scoping
        { normalized_status: "won", currency_code: "USD", outcome_amount_recovered: 200, outcome_amount_lost: 0, closed_at: C },
        // 1 closed EUR — included in EUR amountRecovered
        { normalized_status: "won", currency_code: "EUR", outcome_amount_recovered: 80,  outcome_amount_lost: 0, closed_at: C },
      ],
    });

    const m = await computeDisputeMetrics({ shopId: "s1" });

    expect(m.currencyCode).toBe("EUR");
    // EUR-only sums:
    expect(m.amountAtRisk).toBe(150);     // 100 + 50, NOT 1149
    expect(m.amountRecovered).toBe(80);   // NOT 280
    expect(m.amountLost).toBe(0);
    // Count is currency-agnostic — all 3 active disputes still counted:
    expect(m.activeDisputes).toBe(3);
    // The other currencies surface as a hint, not a silent drop:
    expect(m.otherCurrencyCounts).toEqual({ SEK: 1, USD: 1 });
  });

  it("returns an empty otherCurrencyCounts when all disputes share one currency", async () => {
    mockSupabase({
      current: [
        { normalized_status: "new", currency_code: "USD", amount: 100 },
        { normalized_status: "new", currency_code: "USD", amount: 50 },
      ],
    });
    const m = await computeDisputeMetrics({ shopId: "s1" });
    expect(m.currencyCode).toBe("USD");
    expect(m.amountAtRisk).toBe(150);
    expect(m.otherCurrencyCounts).toEqual({});
  });

  it("prefers `preferredCurrency` when the shop has matching disputes (shop currency wins over most-frequent)", async () => {
    // Most-frequent currency in the window is EUR (2 disputes vs 1 USD).
    // But the shop's Shopify presentment currency is USD — so as long
    // as at least one dispute is denominated in USD, USD wins.
    mockSupabase({
      current: [
        { normalized_status: "new", currency_code: "EUR", amount: 100, outcome_amount_recovered: 0 },
        { normalized_status: "new", currency_code: "EUR", amount: 50,  outcome_amount_recovered: 0 },
        { normalized_status: "new", currency_code: "USD", amount: 200, outcome_amount_recovered: 0 },
      ],
    });

    const m = await computeDisputeMetrics({
      shopId: "s1",
      preferredCurrency: "USD",
    });
    expect(m.currencyCode).toBe("USD");
    // Only the USD dispute is summed into amountAtRisk:
    expect(m.amountAtRisk).toBe(200);
    // EUR disputes surface as "other":
    expect(m.otherCurrencyCounts).toEqual({ EUR: 2 });
  });

  it("falls back to most-frequent when `preferredCurrency` has zero matching disputes", async () => {
    // Shop is configured as USD but every dispute is in EUR. Showing
    // "$0 recovered" would be misleading — fall back to EUR so the
    // merchant sees what they actually have in play.
    mockSupabase({
      current: [
        { normalized_status: "new", currency_code: "EUR", amount: 100 },
        { normalized_status: "new", currency_code: "EUR", amount: 50 },
      ],
    });

    const m = await computeDisputeMetrics({
      shopId: "s1",
      preferredCurrency: "USD",
    });
    expect(m.currencyCode).toBe("EUR");
    expect(m.amountAtRisk).toBe(150);
  });

  it("honors `preferredCurrency` on an empty dispute set (so the empty dashboard shows the right symbol)", async () => {
    mockSupabase({ current: [] });
    const m = await computeDisputeMetrics({
      shopId: "s1",
      preferredCurrency: "EUR",
    });
    expect(m.currencyCode).toBe("EUR");
    expect(m.amountAtRisk).toBe(0);
  });

  it("ignores a null `preferredCurrency` and keeps the legacy heuristic intact", async () => {
    mockSupabase({
      current: [
        { normalized_status: "new", currency_code: "EUR", amount: 100 },
        { normalized_status: "new", currency_code: "USD", amount: 50 },
      ],
    });

    const m = await computeDisputeMetrics({
      shopId: "s1",
      preferredCurrency: null,
    });
    expect(m.currencyCode).toBe("EUR"); // most-frequent
  });
});

describe("computeDisputeMetrics — period-over-period", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChargebackRate.mockResolvedValue(NULL_CHARGEBACK as never);
  });

  it("returns null period-over-period change fields when periodFrom is omitted", async () => {
    mockSupabase({ current: [{ normalized_status: "new", amount: 100 }] });
    const m = await computeDisputeMetrics({ shopId: "s1" });
    expect(m.activeDisputesChange).toBeNull();
    expect(m.winRateChange).toBeNull();
    expect(m.amountAtRiskChange).toBeNull();
    expect(m.disputesWonChange).toBeNull();
    expect(m.amountRecoveredChange).toBeNull();
  });

  it("treats Active Disputes as a period-independent snapshot (no prior-window delta)", async () => {
    // Active is a point-in-time snapshot now — it counts all open disputes
    // regardless of the selected window, and has no meaningful prior-window
    // comparison, so activeDisputesChange is always null.
    mockSupabase({
      current: [
        { normalized_status: "new", amount: 100 },
        { normalized_status: "new", amount: 100 },
        { normalized_status: "new", amount: 100 },
      ],
    });
    const m = await computeDisputeMetrics({
      shopId: "s1",
      periodFrom: "2026-04-01T00:00:00Z",
      periodTo: "2026-04-30T00:00:00Z",
    });
    expect(m.activeDisputes).toBe(3);
    expect(m.activeDisputesChange).toBeNull();
    expect(m.amountAtRiskChange).toBeNull();
  });

  it("returns winRateChange in percentage points, comparing closed_at windows", async () => {
    // Current window = April; prior equal-length window = March. Outcomes
    // are placed via closed_at into the matching window.
    const APRIL = "2026-04-10T00:00:00Z"; // in [periodFrom, periodTo]
    const MARCH = "2026-03-10T00:00:00Z"; // in the prior window
    mockSupabase({
      current: [
        { final_outcome: "won", closed_at: APRIL },
        { final_outcome: "won", closed_at: APRIL },
        { final_outcome: "lost", closed_at: APRIL },
      ], // April winRate = 67
      previous: [
        { final_outcome: "won", closed_at: MARCH },
        { final_outcome: "lost", closed_at: MARCH },
        { final_outcome: "lost", closed_at: MARCH },
      ], // March winRate = 33
    });
    const m = await computeDisputeMetrics({
      shopId: "s1",
      periodFrom: "2026-04-01T00:00:00Z",
      periodTo: "2026-04-30T00:00:00Z",
    });
    expect(m.winRate).toBe(67);
    // Δ = 67 - 33 = 34 pp
    expect(m.winRateChange).toBe(34);
  });

  it("returns 100% pctChange when prior-window outcomes are 0 and current>0", async () => {
    // disputesWonChange uses pctChange, which returns 100 when prev=0 and
    // current>0 (so growth from nothing isn't hidden as a divide-by-zero).
    const APRIL = "2026-04-10T00:00:00Z";
    mockSupabase({
      current: [{ final_outcome: "won", closed_at: APRIL }],
      previous: [], // no outcomes decided in the prior window
    });
    const m = await computeDisputeMetrics({
      shopId: "s1",
      periodFrom: "2026-04-01T00:00:00Z",
      periodTo: "2026-04-30T00:00:00Z",
    });
    expect(m.disputesWon).toBe(1);
    expect(m.disputesWonChange).toBe(100);
  });
});

describe("computeDisputeMetrics — admin-only fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChargebackRate.mockResolvedValue(NULL_CHARGEBACK as never);
  });

  it("returns nulls for overriddenCount/syncIssueCount/disputesWithNotesCount when shopId is provided", async () => {
    mockSupabase({
      current: [
        { has_admin_override: true, sync_health: "stale", needs_attention: true },
      ],
    });
    const m = await computeDisputeMetrics({ shopId: "s1" });
    expect(m.overriddenCount).toBeNull();
    expect(m.syncIssueCount).toBeNull();
    expect(m.disputesWithNotesCount).toBeNull();
  });
});

describe("computeDisputeMetrics — chargeback rate integration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("threads computeChargebackRate output into the response when shopId is given", async () => {
    mockChargebackRate.mockResolvedValue({
      rate: 0.7,
      rateChange: 0.1,
      numerator: 7,
      denominator: 1000,
      available: true,
      lowVolume: false,
      lastSyncedAt: "2026-04-30T12:00:00Z",
      daysCovered: 30,
    } as never);
    mockSupabase({ current: [] });

    const m = await computeDisputeMetrics({ shopId: "s1" });
    expect(m.chargebackRate).toBe(0.7);
    expect(m.chargebackRateNumerator).toBe(7);
    expect(m.chargebackRateDenominator).toBe(1000);
    expect(m.chargebackRateAvailable).toBe(true);
    expect(m.chargebackRateLowVolume).toBe(false);
    expect(m.chargebackRateLastSyncedAt).toBe("2026-04-30T12:00:00Z");
  });

  it("leaves chargeback rate fields at defaults when shopId is omitted (admin path)", async () => {
    mockSupabase({ current: [], notesCount: 0 });
    const m = await computeDisputeMetrics({});
    expect(m.chargebackRate).toBeNull();
    expect(m.chargebackRateAvailable).toBe(false);
    expect(mockChargebackRate).not.toHaveBeenCalled();
  });
});
