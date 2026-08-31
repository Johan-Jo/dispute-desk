/**
 * Automation settings changes must be attributable.
 *
 * `shop_settings` has no actor column and nothing logged these writes, so
 * when a merchant was found with `auto_build_enabled = false` — silently
 * halting pack generation, with two disputes a day from their deadline and
 * no pack built — there was no way to establish who turned it off, when, or
 * whether it was the merchant or an admin using "View as merchant".
 * `updated_at` covers the whole row, so it could not even confirm which
 * field had changed.
 *
 * Three properties are pinned here:
 *   1. A real transition is logged, with before AND after.
 *   2. A no-op write logs nothing — the settings page PATCHes all three
 *      fields on every save, so logging unconditionally would bury an
 *      auto-build-off event under noise.
 *   3. An audit failure never fails the save. logAuditEvent throws, and a
 *      merchant losing a settings change to an audit outage is worse than a
 *      missing log line.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/automation/settings", () => ({
  getShopSettings: vi.fn(),
  updateShopSettings: vi.fn(),
}));
vi.mock("@/lib/audit/logEvent", () => ({ logAuditEvent: vi.fn() }));
vi.mock("@/lib/admin/impersonation", () => ({
  verifyImpersonation: vi.fn(),
  IMPERSONATION_MODE_HEADER: "x-dd-impersonation-mode",
}));
vi.mock("@/lib/middleware/extractShopId", () => ({
  extractShopId: vi.fn(() => SHOP),
  extractShopIdFromBody: vi.fn(() => SHOP),
}));

import { getShopSettings, updateShopSettings } from "@/lib/automation/settings";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { verifyImpersonation } from "@/lib/admin/impersonation";
import { PATCH } from "@/app/api/automation/settings/route";

const SHOP = "11111111-1111-1111-1111-111111111111";
const mockGet = vi.mocked(getShopSettings);
const mockUpdate = vi.mocked(updateShopSettings);
const mockAudit = vi.mocked(logAuditEvent);
const mockImp = vi.mocked(verifyImpersonation);

function req(body: Record<string, unknown>) {
  return {
    json: async () => body,
    cookies: { get: () => undefined },
  } as unknown as Parameters<typeof PATCH>[0];
}

const BASE = {
  auto_build_enabled: true,
  auto_save_enabled: false,
  auto_save_min_score: 70,
  enforce_no_blockers: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockImp.mockResolvedValue(null);
  mockAudit.mockResolvedValue(undefined);
});

describe("automation settings audit", () => {
  it("records the before AND after of a real change", async () => {
    mockGet.mockResolvedValue({ ...BASE } as never);
    mockUpdate.mockResolvedValue({
      ...BASE,
      auto_build_enabled: false,
    } as never);

    await PATCH(req({ shop_id: SHOP, auto_build_enabled: false }));

    expect(mockAudit).toHaveBeenCalledTimes(1);
    const arg = mockAudit.mock.calls[0][0];
    expect(arg.eventType).toBe("automation_settings_changed");
    expect(arg.shopId).toBe(SHOP);
    // The transition is the point — "to: false" alone would not tell you
    // whether the switch was flipped or merely re-saved.
    expect(arg.eventPayload?.changes).toEqual({
      auto_build_enabled: { from: true, to: false },
    });
  });

  it("logs nothing when the value did not actually change", async () => {
    mockGet.mockResolvedValue({ ...BASE } as never);
    mockUpdate.mockResolvedValue({ ...BASE } as never);

    await PATCH(req({ shop_id: SHOP, auto_build_enabled: true }));

    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("attributes a merchant change to the merchant", async () => {
    mockGet.mockResolvedValue({ ...BASE } as never);
    mockUpdate.mockResolvedValue({
      ...BASE,
      auto_build_enabled: false,
    } as never);

    await PATCH(req({ shop_id: SHOP, auto_build_enabled: false }));

    const arg = mockAudit.mock.calls[0][0];
    expect(arg.actorType).toBe("merchant");
    expect(arg.actorId).toBeNull();
    expect(arg.eventPayload?.impersonated).toBe(false);
  });

  it("attributes an impersonated change to the admin who minted the session", async () => {
    // The distinguishing case. An admin using "View as merchant" arrives as
    // an ordinary embedded request; the impersonation cookie is the only
    // thing that separates them, and it carries adminUserId for exactly this.
    mockImp.mockResolvedValue({
      shopId: SHOP,
      shopDomain: "x.myshopify.com",
      mode: "write",
      adminUserId: "admin-abc",
      iat: 0,
    } as never);
    mockGet.mockResolvedValue({ ...BASE } as never);
    mockUpdate.mockResolvedValue({
      ...BASE,
      auto_build_enabled: false,
    } as never);

    await PATCH(req({ shop_id: SHOP, auto_build_enabled: false }));

    const arg = mockAudit.mock.calls[0][0];
    expect(arg.actorId).toBe("admin-abc");
    expect(arg.eventPayload?.impersonated).toBe(true);
  });

  it("still saves when the audit write fails", async () => {
    mockGet.mockResolvedValue({ ...BASE } as never);
    mockUpdate.mockResolvedValue({
      ...BASE,
      auto_build_enabled: false,
    } as never);
    mockAudit.mockRejectedValue(new Error("audit table down"));

    const res = await PATCH(req({ shop_id: SHOP, auto_build_enabled: false }));

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
  });
});
