import { describe, it, expect, beforeAll, vi } from "vitest";
import {
  signImpersonation,
  verifyImpersonationValue,
  IMPERSONATION_TTL_SECONDS,
  type ImpersonationPayload,
} from "@/lib/admin/impersonation";

beforeAll(() => {
  process.env.CRON_SECRET = "test-signing-secret";
});

function payload(overrides: Partial<ImpersonationPayload> = {}): ImpersonationPayload {
  return {
    shopId: "shop-uuid-1",
    shopDomain: "example.myshopify.com",
    mode: "read",
    adminUserId: "admin-1",
    iat: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

describe("impersonation sign/verify", () => {
  it("round-trips a valid payload", async () => {
    const cookie = await signImpersonation(payload());
    const out = await verifyImpersonationValue(cookie);
    expect(out).not.toBeNull();
    expect(out?.shopId).toBe("shop-uuid-1");
    expect(out?.shopDomain).toBe("example.myshopify.com");
    expect(out?.mode).toBe("read");
    expect(out?.adminUserId).toBe("admin-1");
  });

  it("preserves write mode", async () => {
    const cookie = await signImpersonation(payload({ mode: "write" }));
    const out = await verifyImpersonationValue(cookie);
    expect(out?.mode).toBe("write");
  });

  it("rejects a tampered body", async () => {
    const cookie = await signImpersonation(payload());
    const [body, sig] = cookie.split(".");
    // Flip a character in the body — signature no longer matches.
    const tampered = `${body.slice(0, -1)}${body.slice(-1) === "A" ? "B" : "A"}.${sig}`;
    expect(await verifyImpersonationValue(tampered)).toBeNull();
  });

  it("rejects a tampered signature", async () => {
    const cookie = await signImpersonation(payload());
    const [body] = cookie.split(".");
    expect(await verifyImpersonationValue(`${body}.deadbeef`)).toBeNull();
  });

  it("rejects a cookie signed with a different secret", async () => {
    const cookie = await signImpersonation(payload());
    process.env.CRON_SECRET = "a-different-secret";
    expect(await verifyImpersonationValue(cookie)).toBeNull();
    process.env.CRON_SECRET = "test-signing-secret";
  });

  it("rejects an expired payload", async () => {
    const cookie = await signImpersonation(
      payload({ iat: Math.floor(Date.now() / 1000) - IMPERSONATION_TTL_SECONDS - 5 }),
    );
    expect(await verifyImpersonationValue(cookie)).toBeNull();
  });

  it("returns null for empty / malformed input", async () => {
    expect(await verifyImpersonationValue(undefined)).toBeNull();
    expect(await verifyImpersonationValue(null)).toBeNull();
    expect(await verifyImpersonationValue("")).toBeNull();
    expect(await verifyImpersonationValue("no-dot-here")).toBeNull();
    expect(await verifyImpersonationValue(".onlysig")).toBeNull();
  });

  it("rejects a payload with an invalid mode", async () => {
    // Hand-craft a body with mode outside the allow-list, correctly signed.
    const bad = { ...payload(), mode: "admin" } as unknown as ImpersonationPayload;
    const cookie = await signImpersonation(bad);
    expect(await verifyImpersonationValue(cookie)).toBeNull();
  });
});
