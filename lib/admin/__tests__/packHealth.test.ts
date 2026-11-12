import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { packHealth, isSavedStatus, isFailingStatus } from "../packHealth";

const rows = (status: string, n: number, saved = 0) =>
  Array.from({ length: n }, (_, i) => ({ status, saved_to_shopify_at: i < saved ? "2026-11-01" : null }));

describe("packHealth", () => {
  it("recognises every saved_to_shopify* status, not just the original name", () => {
    expect(isSavedStatus("saved_to_shopify")).toBe(true);
    expect(isSavedStatus("saved_to_shopify_verified")).toBe(true);
    expect(isSavedStatus("saved_to_shopify_unverified")).toBe(true);
    expect(isSavedStatus("ready")).toBe(false);
    expect(isFailingStatus("save_failed")).toBe(true);
    expect(isFailingStatus("draft")).toBe(false);
  });

  it("matches the status mix seen on prod (2026-11-12)", () => {
    const packs = [
      ...rows("ready", 352, 2),
      ...rows("saved_to_shopify_verified", 124, 114),
      ...rows("draft", 37),
      ...rows("archived", 31),
      ...rows("failed", 18, 1),
      ...rows("save_failed", 3),
      ...rows("saved_to_shopify", 1, 1),
      ...rows("saved_to_shopify_unverified", 1, 1),
    ];
    const { automationSuccessRate, saveSuccessRate } = packHealth(packs);
    // built = 352+124+18+3+1+1 = 499; ok = 478  -> 96%. draft/archived excluded.
    expect(automationSuccessRate).toBe(96);
    // True sends only: sent = 2+114+1+1+1 = 119, failed sends = 3 -> 119/122 = 98%.
    // The 352 packs merely sitting in `ready` (260 on already-closed disputes)
    // are neither sent nor failed; counting them gave a misleading 24%.
    expect(saveSuccessRate).toBe(98);
    const h = packHealth(packs);
    expect(h.saveSent).toBe(119);
    expect(h.saveFailed).toBe(3);
  });

  it("ignores packs that were never sent", () => {
    const h = packHealth([...rows("ready", 50), ...rows("draft", 5), ...rows("saved_to_shopify_verified", 3, 3)]);
    expect(h).toMatchObject({ saveSent: 3, saveFailed: 0, saveSuccessRate: 100 });
  });

  it("is 0 (not NaN) when there are no packs", () => {
    expect(packHealth([])).toEqual({ automationSuccessRate: 0, saveSuccessRate: 0, saveSent: 0, saveFailed: 0 });
  });
});

describe("metrics route", () => {
  it("never selects evidence_packs.dispute_type (the column does not exist)", () => {
    const src = fs.readFileSync("app/api/admin/metrics/route.ts", "utf-8");
    const m = src.match(/from\("evidence_packs"\)[\s\S]{0,200}?\.select\(([^)]*)\)/);
    expect(m, "evidence_packs select not found").toBeTruthy();
    expect(m![1]).not.toContain("dispute_type");
  });
});
