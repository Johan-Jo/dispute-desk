import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression pins for the 2026-08-30 Mein Maison outage (6a8848-dd).
 *
 * Two silent faults compounded, and nothing alerted for ~20 hours:
 *
 *   1. Expiring offline tokens live ONE HOUR. `syncDisputes` read
 *      `shop_sessions` directly and used whatever ciphertext it found,
 *      ignoring `expires_at`. On a shop with no other Shopify traffic to
 *      trigger a refresh, every sync after the first hour authenticated
 *      with a dead token.
 *   2. The job handler ignored `SyncResult.errors`, so those failed runs
 *      were recorded as `succeeded`.
 *
 * These tests fail if either regression is reintroduced.
 */

const ROOT = join(__dirname, "..", "..");

describe("syncDisputes — token freshness", () => {
  it("refreshes the session instead of reading shop_sessions raw", () => {
    const src = readFileSync(
      join(ROOT, "lib", "disputes", "syncDisputes.ts"),
      "utf8",
    );
    // Must go through the refresh-aware loader...
    expect(src).toContain("ensureFreshSession");
    expect(src).toContain("loadSession");
    // ...and must NOT hand-roll a shop_sessions read, which is what
    // bypassed expiry checking in the first place.
    expect(src).not.toContain('.from("shop_sessions")');
  });
});

describe("sync_disputes job — a sync that synced nothing is not a success", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("throws when syncDisputes reports errors", async () => {
    vi.doMock("@/lib/disputes/syncDisputes", () => ({
      syncDisputes: vi.fn().mockResolvedValue({
        synced: 0,
        created: 0,
        updated: 0,
        errors: ["GraphQL: Invalid API key or access token"],
      }),
    }));
    const { handleSyncDisputes } = await import(
      "@/lib/jobs/handlers/syncDisputesJob"
    );
    await expect(
      handleSyncDisputes({ id: "job-1", shopId: "shop-1" } as never),
    ).rejects.toThrow(/Invalid API key|error\(s\)/);
  });

  it("resolves normally on a clean sync", async () => {
    vi.doMock("@/lib/disputes/syncDisputes", () => ({
      syncDisputes: vi.fn().mockResolvedValue({
        synced: 522,
        created: 0,
        updated: 522,
        errors: [],
      }),
    }));
    const { handleSyncDisputes } = await import(
      "@/lib/jobs/handlers/syncDisputesJob"
    );
    await expect(
      handleSyncDisputes({ id: "job-2", shopId: "shop-1" } as never),
    ).resolves.toBeUndefined();
  });
});

describe("session-health watchdog route", () => {
  const src = () =>
    readFileSync(
      join(ROOT, "app", "api", "cron", "session-health", "route.ts"),
      "utf8",
    );

  it("is gated like every other cron route", () => {
    expect(src()).toContain("cronEnvGate");
  });

  it("proactively refreshes tokens", () => {
    // The whole point: refresh on a schedule, so a shop with zero
    // traffic never drifts past its 1-hour expiry unnoticed.
    expect(src()).toContain("ensureFreshSession");
  });

  it("verifies webhooks against Shopify rather than assuming", () => {
    const s = src();
    expect(s).toContain("webhookSubscriptions");
    expect(s).toContain("registerOrderWebhooks");
    expect(s).toContain("ORDERS_CREATE");
    expect(s).toContain("ORDERS_UPDATED");
  });

  it("alerts loudly on anything it could not repair", () => {
    const s = src();
    // Persisted AND emailed — the original outage produced neither.
    expect(s).toContain("session_health_alert");
    expect(s).toContain("sendAdminEmail");
  });

  it("is registered on an hourly schedule", () => {
    const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
    const entry = vercel.crons.find(
      (c: { path: string }) => c.path === "/api/cron/session-health",
    );
    expect(entry, "session-health must be scheduled").toBeTruthy();
    // Hourly — tokens expire in 60 min, so a daily sweep would be useless.
    expect(entry.schedule).toMatch(/^\d+ \* \* \* \*$/);
  });
});
