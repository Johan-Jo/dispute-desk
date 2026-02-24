import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptedPayload {
  keyVersion: number;
  iv: string;
  tag: string;
  ciphertext: string;
}

function getKey(version: number): Buffer {
  const envName = `TOKEN_ENCRYPTION_KEY_V${version}`;
  const hex = process.env[envName];
  if (!hex) {
    throw new Error(`Missing encryption key env var: ${envName}`);
  }
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) {
    throw new Error(`${envName} must be 32 bytes (64 hex chars), got ${buf.length}`);
  }
  return buf;
}

function currentKeyVersion(): number {
  for (let v = 10; v >= 1; v--) {
    if (process.env[`TOKEN_ENCRYPTION_KEY_V${v}`]) return v;
  }
  if (process.env.TOKEN_ENCRYPTION_KEY) return 1;
  throw new Error("No TOKEN_ENCRYPTION_KEY_V* env var set");
}

export function encrypt(plaintext: string): EncryptedPayload {
  const version = currentKeyVersion();
  const key = getKey(version);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    keyVersion: version,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ciphertext: encrypted.toString("hex"),
  };
}

export function decrypt(payload: EncryptedPayload): string {
  const key = getKey(payload.keyVersion);
  const iv = Buffer.from(payload.iv, "hex");
  const tag = Buffer.from(payload.tag, "hex");
  const ciphertext = Buffer.from(payload.ciphertext, "hex");

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/**
 * Serialize EncryptedPayload to a single DB-storable string.
 * Format: v{keyVersion}:{iv}:{tag}:{ciphertext}
 */
export function serializeEncrypted(payload: EncryptedPayload): string {
  return `v${payload.keyVersion}:${payload.iv}:${payload.tag}:${payload.ciphertext}`;
}

export function deserializeEncrypted(raw: string): EncryptedPayload {
  const parts = raw.split(":");
  if (parts.length !== 4 || !parts[0].startsWith("v")) {
    throw new Error("Invalid encrypted payload format");
  }
  return {
    keyVersion: parseInt(parts[0].slice(1), 10),
    iv: parts[1],
    tag: parts[2],
    ciphertext: parts[3],
  };
}
