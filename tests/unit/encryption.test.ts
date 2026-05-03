import { describe, it, expect, beforeEach } from "vitest";

describe("encryption roundtrip with key versioning", () => {
  beforeEach(() => {
    // Set test keys (32 bytes = 64 hex chars each)
    process.env.TOKEN_ENCRYPTION_KEY_V1 =
      "a".repeat(64);
    process.env.TOKEN_ENCRYPTION_KEY_V2 =
      "b".repeat(64);
  });

  it("encrypts and decrypts with current key version", async () => {
    const { encrypt, decrypt } = await import("@/lib/security/encryption");
    const plaintext = "shpat_test_token_12345";
    const encrypted = encrypt(plaintext);

    expect(encrypted.keyVersion).toBe(2);
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.tag).toBeTruthy();
    expect(encrypted.ciphertext).toBeTruthy();
    expect(encrypted.ciphertext).not.toBe(plaintext);

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("decrypts V1-encrypted data even when V2 is current", async () => {
    const { encrypt, decrypt } = await import("@/lib/security/encryption");

    // Temporarily remove V2 to force V1 encryption
    const v2 = process.env.TOKEN_ENCRYPTION_KEY_V2;
    delete process.env.TOKEN_ENCRYPTION_KEY_V2;

    const plaintext = "shpat_legacy_token";
    const encrypted = encrypt(plaintext);
    expect(encrypted.keyVersion).toBe(1);

    // Restore V2
    process.env.TOKEN_ENCRYPTION_KEY_V2 = v2;

    // V1-encrypted data should still decrypt
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("serializes and deserializes encrypted payload", async () => {
    const {
      encrypt,
      decrypt,
      serializeEncrypted,
      deserializeEncrypted,
    } = await import("@/lib/security/encryption");

    const plaintext = "shpat_serialize_test";
    const encrypted = encrypt(plaintext);
    const serialized = serializeEncrypted(encrypted);

    expect(serialized).toMatch(/^v\d+:[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/);

    const deserialized = deserializeEncrypted(serialized);
    const decrypted = decrypt(deserialized);
    expect(decrypted).toBe(plaintext);
  });

  /* ── Failure-path tests (Phase 4.2) ── */

  it("encrypt throws when no key version env var is set", async () => {
    const v1 = process.env.TOKEN_ENCRYPTION_KEY_V1;
    const v2 = process.env.TOKEN_ENCRYPTION_KEY_V2;
    const legacy = process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY_V1;
    delete process.env.TOKEN_ENCRYPTION_KEY_V2;
    delete process.env.TOKEN_ENCRYPTION_KEY;

    const { encrypt } = await import("@/lib/security/encryption");
    expect(() => encrypt("anything")).toThrow(/No TOKEN_ENCRYPTION_KEY/);

    if (v1) process.env.TOKEN_ENCRYPTION_KEY_V1 = v1;
    if (v2) process.env.TOKEN_ENCRYPTION_KEY_V2 = v2;
    if (legacy) process.env.TOKEN_ENCRYPTION_KEY = legacy;
  });

  it("getKey rejects keys that aren't exactly 32 bytes", async () => {
    const original = process.env.TOKEN_ENCRYPTION_KEY_V2;
    process.env.TOKEN_ENCRYPTION_KEY_V2 = "abcd"; // 2 bytes

    const { encrypt } = await import("@/lib/security/encryption");
    expect(() => encrypt("anything")).toThrow(
      /must be 32 bytes \(64 hex chars\), got 2/,
    );

    process.env.TOKEN_ENCRYPTION_KEY_V2 = original;
  });

  it("decrypt throws when the auth tag is tampered with", async () => {
    const { encrypt, decrypt } = await import("@/lib/security/encryption");
    const encrypted = encrypt("genuine_token");
    // Flip a byte in the auth tag → decryption must fail rather than
    // silently return garbage.
    const tampered = {
      ...encrypted,
      tag: encrypted.tag.slice(0, -2) + (encrypted.tag.slice(-2) === "00" ? "ff" : "00"),
    };
    expect(() => decrypt(tampered)).toThrow();
  });

  it("decrypt throws when the ciphertext is tampered with", async () => {
    const { encrypt, decrypt } = await import("@/lib/security/encryption");
    const encrypted = encrypt("genuine_token");
    const tampered = {
      ...encrypted,
      ciphertext: encrypted.ciphertext.slice(0, -2) +
        (encrypted.ciphertext.slice(-2) === "00" ? "ff" : "00"),
    };
    expect(() => decrypt(tampered)).toThrow();
  });

  it("deserializeEncrypted rejects malformed strings", async () => {
    const { deserializeEncrypted } = await import("@/lib/security/encryption");

    // Missing version prefix
    expect(() => deserializeEncrypted("aabb:cc:dd:ee")).toThrow(
      /Invalid encrypted payload format/,
    );
    // Wrong segment count
    expect(() => deserializeEncrypted("v1:aabb:ccdd")).toThrow(
      /Invalid encrypted payload format/,
    );
    // Empty string
    expect(() => deserializeEncrypted("")).toThrow(
      /Invalid encrypted payload format/,
    );
  });
});
