import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/middleware/extractShopId", () => ({ extractShopId: () => "shop-1" }));
vi.mock("@/lib/insights/period/readProgrammeMonth", () => ({ readProgrammeMonth: vi.fn() }));

import { getServiceClient } from "@/lib/supabase/server";
import { readProgrammeMonth } from "@/lib/insights/period/readProgrammeMonth";
import { GET } from "@/app/api/ratios/current/route";

const mockClient = vi.mocked(getServiceClient);
const mockProgramme = vi.mocked(readProgrammeMonth);

function sbWithRow(row: Record<string, unknown> | null) {
  const calls: Array<[string, unknown]> = [];
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { calls.push([c, v]); return b; },
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { sb: { from: () => b }, calls };
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/ratios/current", () => {
  it("reads the statement month (last complete month), never the current one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
    const { sb } = sbWithRow(null);
    mockClient.mockReturnValue(sb as never);
    mockProgramme.mockResolvedValue({
      status: "ok", periodState: "provisional", finalOn: "2026-10-08T00:00:00.000Z",
      periodMonth: "2026-09-01", cardDisputeRatio: 0.00149, vampRatioCalculated: 0.00149,
      ecmRatio: 0.00061, ecmIsLowerBound: true, visaChargebackCount: 2, mcChargebackCount: 2,
      vampSeverity: "healthy", ecmSeverity: "healthy", cardFramingApplies: true,
      ce30ExcludedCount: 1, fptExcludedCount: 0, revenueRecoveredUsd: 120, vampRatioWithoutDd: 0.00186,
    } as never);
    const res = await GET(new Request("https://x.test/api/ratios/current") as never);
    const body = await res.json();
    vi.useRealTimers();
    expect(mockProgramme.mock.calls[0]![2]).toBe("2026-09-01");
    expect(body.snapshot.vamp.ratio).toBe(0.00149);
    expect(body.snapshot.vamp.severity).toBe("healthy");
    expect(body.snapshot.mcEcm.lowerBound).toBe(true);
    expect(body.snapshot.impact).toEqual({
      ce30ExcludedCount: 1, fptExcludedCount: 0, estimatedFeesAvoidedUsd: 8, estimatedRevenueRecoveredUsd: 120,
    });
  });

  it("keeps NULL ratios as NULL", async () => {
    const { sb } = sbWithRow(null);
    mockClient.mockReturnValue(sb as never);
    mockProgramme.mockResolvedValue({
      status: "ok", periodState: "final", finalOn: "x", periodMonth: "2026-09-01",
      cardDisputeRatio: null, ecmRatio: null, ecmIsLowerBound: true,
      visaChargebackCount: 0, mcChargebackCount: 0, vampSeverity: null, ecmSeverity: null,
      cardFramingApplies: true, vampRatioWithoutDd: null,
      ce30ExcludedCount: 0, fptExcludedCount: 0, revenueRecoveredUsd: 0,
    } as never);
    const body = await (await GET(new Request("https://x.test/x") as never)).json();
    expect(body.snapshot.vamp.ratio).toBeNull();
    expect(body.snapshot.vamp.ratioWithoutDd).toBeNull();
    expect(body.snapshot.mcEcm.ratio).toBeNull();
  });

  it("a programme failure is a 200 with status 'error', not a vanished card", async () => {
    const { sb } = sbWithRow(null);
    mockClient.mockReturnValue(sb as never);
    mockProgramme.mockResolvedValue({ status: "error", periodMonth: "2026-09-01" });
    const res = await GET(new Request("https://x.test/x") as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ snapshot: null, status: "error", periodMonth: "2026-09-01" });
  });
});
