/**
 * Tests for `verifyShopifyWebhook` (Phase 4.2 — webhook HMAC verification).
 *
 * Critical security primitive: a missing/wrong env var, a tampered body,
 * or a forged HMAC must NEVER be classified as valid. These cases are
 * cheap to verify and the function is small enough to exercise every
 * branch.
 */

import { createHmac } from "crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { verifyShopifyWebhook } from "../verify";

const SECRET = "test_secret_key_at_least_32_chars_long";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

describe("verifyShopifyWebhook", () => {
  let originalSecret: string | undefined;

  beforeEach(() => {
    originalSecret = process.env.SHOPIFY_API_SECRET;
    process.env.SHOPIFY_API_SECRET = SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.SHOPIFY_API_SECRET;
    else process.env.SHOPIFY_API_SECRET = originalSecret;
  });

  it("returns true for a body signed with the correct secret", () => {
    const body = JSON.stringify({ id: 123, status: "needs_response" });
    const hmac = sign(body, SECRET);
    expect(verifyShopifyWebhook(body, hmac)).toBe(true);
  });

  it("accepts Buffer bodies (Shopify webhook handlers receive raw bytes)", () => {
    const body = Buffer.from(
      JSON.stringify({ id: 456, evidence_due_by: "2026-06-01T00:00:00Z" }),
    );
    const hmac = sign(body.toString("utf8"), SECRET);
    expect(verifyShopifyWebhook(body, hmac)).toBe(true);
  });

  /* ── Failure paths ── */

  it("returns false when the body has been tampered with", () => {
    const body = JSON.stringify({ id: 123, status: "needs_response" });
    const hmac = sign(body, SECRET);
    const tampered = JSON.stringify({ id: 123, status: "won" });
    expect(verifyShopifyWebhook(tampered, hmac)).toBe(false);
  });

  it("returns false when the HMAC was signed with a different secret", () => {
    const body = JSON.stringify({ id: 123 });
    const wrongHmac = sign(body, "some_other_attacker_secret");
    expect(verifyShopifyWebhook(body, wrongHmac)).toBe(false);
  });

  it("returns false when no secret is configured (defense-in-depth)", () => {
    delete process.env.SHOPIFY_API_SECRET;
    const body = JSON.stringify({ id: 123 });
    // Even a "correctly-signed" body must reject when no secret exists,
    // so an attacker can't bypass verification by stripping the header
    // and racing against a misconfigured worker.
    expect(verifyShopifyWebhook(body, "anything")).toBe(false);
  });

  it("returns false rather than throwing when the HMAC header has unexpected length", () => {
    const body = JSON.stringify({ id: 123 });
    // timingSafeEqual throws if the buffers differ in length; the
    // wrapper must trap that and return false (not crash the worker).
    expect(verifyShopifyWebhook(body, "tooShort")).toBe(false);
    expect(verifyShopifyWebhook(body, "")).toBe(false);
  });
});
