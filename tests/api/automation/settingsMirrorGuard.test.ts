/**
 * `auto_save_enabled` must not be writable through /api/automation/settings.
 *
 * It is a strict mirror of the store-wide handling switch, owned by
 * `writeStoreAutomation`. If this route accepted it, a client could set the
 * gate to false while the switch still said "auto" — the shop would show
 * Auto-pilot on /app/rules and silently save nothing. That drift is what the
 * store-wide redesign existed to remove; this test keeps the door shut.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/automation/settings", () => ({
  getShopSettings: vi.fn(),
  updateShopSettings: vi.fn(),
}));

import { updateShopSettings } from "@/lib/automation/settings";
import { PATCH } from "@/app/api/automation/settings/route";

const mockUpdate = vi.mocked(updateShopSettings);

function makeReq(body: Record<string, unknown>) {
  return {
    nextUrl: new URL("https://x.test/api/automation/settings"),
    headers: new Headers({ "x-shop-id": "shop-1" }),
    json: async () => body,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue({} as never);
});

describe("PATCH /api/automation/settings — mirror guard", () => {
  it("drops auto_save_enabled from the update", async () => {
    await PATCH(
      makeReq({ auto_save_enabled: false, auto_save_min_score: 90 }),
    );

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [, updates] = mockUpdate.mock.calls[0];
    expect(updates).not.toHaveProperty("auto_save_enabled");
  });

  it("still writes the fields this route legitimately owns", async () => {
    await PATCH(
      makeReq({
        auto_build_enabled: true,
        auto_save_min_score: 90,
        enforce_no_blockers: false,
        auto_save_enabled: true,
      }),
    );

    const [, updates] = mockUpdate.mock.calls[0];
    expect(updates).toEqual({
      auto_build_enabled: true,
      auto_save_min_score: 90,
      enforce_no_blockers: false,
    });
  });

  it("succeeds (does not 400) when an older client sends the full object", async () => {
    // A cached client PATCHing every field must still save the ones it owns.
    const res = await PATCH(makeReq({ auto_save_enabled: false }));
    expect(res.status).toBe(200);
  });
});
