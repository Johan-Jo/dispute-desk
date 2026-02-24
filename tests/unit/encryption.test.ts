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
});
