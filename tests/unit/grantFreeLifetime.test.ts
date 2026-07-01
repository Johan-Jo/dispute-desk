/**
 * Tests for lib/billing/grantFreeLifetime.ts.
 *
 * Pins the core invariant of the Free-tier fix: a new shop is granted
 * exactly N=FREE_LIFETIME_PACKS once, and a second call (re-install /
 * re-OAuth) is a no-op because a free_lifetime ledger row already exists.
 * A double-grant would silently hand out extra free packs on every
 * reinstall.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { grantFreeLifetimeCredits } from "@/lib/billing/grantFreeLifetime";
import { FREE_LIFETIME_PACKS } from "@/lib/billing/plans";

const mockGetServiceClient = vi.mocked(getServiceClient);

const SHOP_ID = "shop-123";

/**
 * Mock a Supabase client whose `free_lifetime` existence check resolves to
 * `existingRow`. Returns the insert spy so tests can assert whether a grant
 * happened.
 */
function setupSupabase(existingRow: { id: string } | null): {
  insertSpy: ReturnType<typeof vi.fn>;
} {
  const insertSpy = vi.fn().mockResolvedValue({ error: null });

  const mockFrom = vi.fn().mockImplementation((table: string) => {
    if (table !== "pack_credits_ledger") {
      throw new Error(`unexpected table: ${table}`);
    }
    return {
      // existence check: .select().eq().eq().maybeSingle()
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: existingRow, error: null }),
      // grantCredits path
      insert: insertSpy,
    };
  });

  mockGetServiceClient.mockReturnValue({ from: mockFrom } as never);
  return { insertSpy };
}

describe("grantFreeLifetimeCredits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("grants N free_lifetime packs when no row exists", async () => {
    const { insertSpy } = setupSupabase(null);

    await grantFreeLifetimeCredits(SHOP_ID);

    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledWith({
      shop_id: SHOP_ID,
      source: "free_lifetime",
      packs: FREE_LIFETIME_PACKS,
      expires_at: null,
      reference: `free-lifetime:${SHOP_ID}`,
    });
  });

  it("is idempotent — no insert when a free_lifetime row already exists", async () => {
    const { insertSpy } = setupSupabase({ id: "existing-row" });

    await grantFreeLifetimeCredits(SHOP_ID);

    expect(insertSpy).not.toHaveBeenCalled();
  });
});
