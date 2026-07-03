import { describe, it, expect, beforeAll } from "vitest";
import {
  signPasskeyVerified,
  verifyPasskeyValue,
  signChallenge,
  verifyChallengeValue,
  PASSKEY_TTL_SECONDS,
  CHALLENGE_TTL_SECONDS,
} from "@/lib/admin/passkeyCookie";

beforeAll(() => {
  process.env.CRON_SECRET = "test-signing-secret";
});

const now = () => Math.floor(Date.now() / 1000);

describe("passkey-verified cookie", () => {
  it("round-trips a valid payload", async () => {
    const c = await signPasskeyVerified({ userId: "u1", credentialId: "cred1", iat: now() });
    const out = await verifyPasskeyValue(c);
    expect(out).not.toBeNull();
    expect(out?.userId).toBe("u1");
    expect(out?.credentialId).toBe("cred1");
  });

  it("rejects a tampered signature", async () => {
    const c = await signPasskeyVerified({ userId: "u1", credentialId: "cred1", iat: now() });
    const [body] = c.split(".");
    expect(await verifyPasskeyValue(`${body}.deadbeef`)).toBeNull();
  });

  it("rejects a cookie signed with a different secret", async () => {
    const c = await signPasskeyVerified({ userId: "u1", credentialId: "cred1", iat: now() });
    process.env.CRON_SECRET = "other-secret";
    expect(await verifyPasskeyValue(c)).toBeNull();
    process.env.CRON_SECRET = "test-signing-secret";
  });

  it("rejects an expired payload", async () => {
    const c = await signPasskeyVerified({
      userId: "u1",
      credentialId: "cred1",
      iat: now() - PASSKEY_TTL_SECONDS - 5,
    });
    expect(await verifyPasskeyValue(c)).toBeNull();
  });

  it("returns null for malformed input", async () => {
    expect(await verifyPasskeyValue(undefined)).toBeNull();
    expect(await verifyPasskeyValue("")).toBeNull();
    expect(await verifyPasskeyValue("no-dot")).toBeNull();
  });
});

describe("webauthn challenge cookie", () => {
  it("round-trips with kind", async () => {
    const c = await signChallenge({ userId: "u1", challenge: "abc", kind: "auth", iat: now() });
    const out = await verifyChallengeValue(c);
    expect(out?.kind).toBe("auth");
    expect(out?.challenge).toBe("abc");
  });

  it("rejects an invalid kind", async () => {
    const bad = { userId: "u1", challenge: "abc", kind: "xyz", iat: now() } as never;
    const c = await signChallenge(bad);
    expect(await verifyChallengeValue(c)).toBeNull();
  });

  it("rejects an expired challenge", async () => {
    const c = await signChallenge({
      userId: "u1",
      challenge: "abc",
      kind: "reg",
      iat: now() - CHALLENGE_TTL_SECONDS - 2,
    });
    expect(await verifyChallengeValue(c)).toBeNull();
  });
});
