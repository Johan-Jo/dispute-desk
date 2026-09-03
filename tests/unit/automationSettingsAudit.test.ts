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
vi.mock("@/lib/billing/replayBlockedBuilds", () => ({
  scheduleBlockedBuildReplay: vi.fn(),
}));
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
import { scheduleBlockedBuildReplay } from "@/lib/billing/replayBlockedBuilds";
import { PATCH } from "@/app/api/automation/settings/route";

const SHOP = "11111111-1111-1111-1111-111111111111";
const mockGet = vi.mocked(getShopSettings);
const mockUpdate = vi.mocked(updateShopSettings);
const mockAudit = vi.mocked(logAuditEvent);
const mockImp = vi.mocked(verifyImpersonation);
const mockReplay = vi.mocked(scheduleBlockedBuildReplay);

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

/**
 * Turning auto-build back ON must replay what it blocked.
 *
 * A dispute the pipeline exited on `auto_build_off` never retries by itself:
 * `disputeEffectsDispatcher` wraps the pipeline in `withEffectDedup`, which
 * burns its claim BEFORE running the effect, so the second attempt is
 * `already_applied`. Neither rebuild cron rescues it either.
 *
 * So this route saving the setting and stopping meant every dispute already
 * blocked stayed blocked — no pack, no queued job — until its deadline passed.
 * Found on `6a8848-dd` (2026-09-03): the merchant turned auto-build on, the
 * setting flipped, the audit row recorded false→true, and 11 live disputes did
 * not move. The pack for #99413 had to be built by hand.
 *
 * `replayBlockedBuilds` already solves exactly this for arriving CREDITS. It
 * was simply never wired to this trigger.
 */
describe("auto-build back on replays the disputes it blocked", () => {
  it("sweeps on the false→true edge", async () => {
    mockGet.mockResolvedValue({ ...BASE, auto_build_enabled: false } as never);
    mockUpdate.mockResolvedValue({ ...BASE, auto_build_enabled: true } as never);

    await PATCH(req({ shop_id: SHOP, auto_build_enabled: true }));

    expect(mockReplay).toHaveBeenCalledTimes(1);
    expect(mockReplay.mock.calls[0][0]).toMatchObject({ shopId: SHOP });
  });

  it("does NOT sweep when the value was already true", async () => {
    // The settings page PATCHes all three fields on every save. Sweeping on a
    // no-op would re-run the pipeline for every open dispute each time the
    // merchant touched an unrelated field.
    mockGet.mockResolvedValue({ ...BASE, auto_build_enabled: true } as never);
    mockUpdate.mockResolvedValue({ ...BASE, auto_build_enabled: true } as never);

    await PATCH(req({ shop_id: SHOP, auto_build_enabled: true }));

    expect(mockReplay).not.toHaveBeenCalled();
  });

  it("does NOT sweep when auto-build is being turned OFF", async () => {
    mockGet.mockResolvedValue({ ...BASE, auto_build_enabled: true } as never);
    mockUpdate.mockResolvedValue({ ...BASE, auto_build_enabled: false } as never);

    await PATCH(req({ shop_id: SHOP, auto_build_enabled: false }));

    expect(mockReplay).not.toHaveBeenCalled();
  });

  it("does NOT sweep when an unrelated field changes", async () => {
    mockGet.mockResolvedValue({ ...BASE, auto_save_min_score: 70 } as never);
    mockUpdate.mockResolvedValue({ ...BASE, auto_save_min_score: 90 } as never);

    await PATCH(req({ shop_id: SHOP, auto_save_min_score: 90 }));

    expect(mockReplay).not.toHaveBeenCalled();
  });

  it("still saves the setting when the sweep cannot be scheduled", async () => {
    // Fire-and-forget: a failed sweep must never roll back a saved setting.
    mockGet.mockResolvedValue({ ...BASE, auto_build_enabled: false } as never);
    mockUpdate.mockResolvedValue({ ...BASE, auto_build_enabled: true } as never);
    mockReplay.mockRejectedValueOnce(new Error("queue down"));

    const res = await PATCH(req({ shop_id: SHOP, auto_build_enabled: true }));

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
  });
});
