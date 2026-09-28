import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { previewPath, signPreviewToken, verifyPreviewToken } from "../previewLink";

const PKG = "b2daac97-9338-4a34-9bff-b4e2dcf0eff1";
const SHOP = "6648353c-422a-4ee5-8bba-d75fee284b09";

describe("signed defence-PDF preview links", () => {
  let saved: string | undefined;
  beforeAll(() => {
    saved = process.env.SHOPIFY_API_SECRET;
    process.env.SHOPIFY_API_SECRET = "test-secret-at-least-16-chars";
  });
  afterAll(() => {
    process.env.SHOPIFY_API_SECRET = saved;
  });

  it("a fresh token opens exactly its own package for its own shop", () => {
    const t = signPreviewToken(PKG, SHOP)!;
    expect(verifyPreviewToken(t, PKG, SHOP)).toBe(true);
    expect(verifyPreviewToken(t, "another-package", SHOP)).toBe(false);
    expect(verifyPreviewToken(t, PKG, "another-shop")).toBe(false);
  });

  it("expires", () => {
    const t = signPreviewToken(PKG, SHOP, { ttlSeconds: 60, now: Date.UTC(2026, 8, 24) })!;
    expect(verifyPreviewToken(t, PKG, SHOP, { now: Date.UTC(2026, 8, 24) + 30_000 })).toBe(true);
    expect(verifyPreviewToken(t, PKG, SHOP, { now: Date.UTC(2026, 8, 24) + 61_000 })).toBe(false);
  });

  it("rejects tampering and junk", () => {
    const t = signPreviewToken(PKG, SHOP)!;
    const [exp, sig] = t.split(".");
    expect(verifyPreviewToken(`${Number(exp) + 3600}.${sig}`, PKG, SHOP)).toBe(false);
    expect(verifyPreviewToken(`${exp}.${"0".repeat(64)}`, PKG, SHOP)).toBe(false);
    expect(verifyPreviewToken("nonsense", PKG, SHOP)).toBe(false);
    expect(verifyPreviewToken(null, PKG, SHOP)).toBe(false);
  });

  it("no secret → no token, and nothing verifies", () => {
    process.env.SHOPIFY_API_SECRET = "";
    expect(signPreviewToken(PKG, SHOP)).toBeNull();
    expect(verifyPreviewToken("1790000000." + "a".repeat(64), PKG, SHOP)).toBe(false);
    process.env.SHOPIFY_API_SECRET = "test-secret-at-least-16-chars";
  });

  it("builds the path with shop and token", () => {
    expect(previewPath(PKG, SHOP, "123.abc")).toBe(
      `/api/defence-packages/${PKG}/preview?shop_id=${SHOP}&t=123.abc`,
    );
  });
});
