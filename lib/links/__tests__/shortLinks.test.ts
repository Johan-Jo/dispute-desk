import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildShortAttachmentUrl,
  generateShortCode,
  SHORT_CODE_LENGTH,
  SHORT_CODE_RE,
} from "../shortLinks";

describe("shortLinks", () => {
  let prevAppUrl: string | undefined;

  beforeEach(() => {
    prevAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://disputedesk.app";
  });

  afterEach(() => {
    if (prevAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prevAppUrl;
  });

  it("generates codes of the expected length", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateShortCode()).toHaveLength(SHORT_CODE_LENGTH);
    }
  });

  it("generates only Crockford-safe characters", () => {
    const safe = /^[0-9A-HJKMNP-TV-Z]+$/;
    for (let i = 0; i < 200; i++) {
      const code = generateShortCode();
      expect(code).toMatch(safe);
      // explicitly excluded chars (Crockford excludes I/L/O/U; we also
      // exclude letters that don't appear in Crockford so transcription
      // is unambiguous)
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it("varies across calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(generateShortCode());
    // 100 random 50-bit codes — collisions effectively impossible
    expect(seen.size).toBe(100);
  });

  it("SHORT_CODE_RE accepts canonical codes", () => {
    expect(SHORT_CODE_RE.test("Q7K2HXRJ9P")).toBe(true);
    expect(SHORT_CODE_RE.test("0123456789")).toBe(true);
    expect(SHORT_CODE_RE.test("ZZZZZZZZZZ")).toBe(true);
  });

  it("SHORT_CODE_RE rejects invalid shape", () => {
    // wrong length
    expect(SHORT_CODE_RE.test("ABCDEFGHIJ")).toBe(false); // contains I
    expect(SHORT_CODE_RE.test("ABCDE")).toBe(false);
    expect(SHORT_CODE_RE.test("")).toBe(false);
    // contains excluded letters
    expect(SHORT_CODE_RE.test("IIIIIIIIII")).toBe(false);
    expect(SHORT_CODE_RE.test("LLLLLLLLLL")).toBe(false);
    expect(SHORT_CODE_RE.test("OOOOOOOOOO")).toBe(false);
    expect(SHORT_CODE_RE.test("UUUUUUUUUU")).toBe(false);
    // lowercase
    expect(SHORT_CODE_RE.test("abcdefghjk")).toBe(false);
    // dot and slash from old token format
    expect(SHORT_CODE_RE.test("eyJrIjoia.MQ7K2HXR9")).toBe(false);
  });

  it("SHORT_CODE_RE rejects long HMAC tokens (legacy fallback path)", () => {
    const legacy =
      "eyJrIjoiaXRlbSIsImlkIjoiYjE3ZWM0M2ItNmI0Yi00OWUwLWJjNGEtMDc1NGQ1ZjFiZjFlIiwicCI6IjQyNGJlZGZkLTRkMTItNDA3Zi1hMTM2LTNmMmI3ZmVjYjhiYSIsImV4cCI6MTc5MjY3MjQ1NX0.pbeQ8A55Mqo2zAbtIIRKWTbTRR9VyomifOQFdWmVgFg";
    expect(SHORT_CODE_RE.test(legacy)).toBe(false);
  });

  it("buildShortAttachmentUrl uses the public base URL", () => {
    expect(buildShortAttachmentUrl("Q7K2HXRJ9P")).toBe(
      "https://disputedesk.app/e/Q7K2HXRJ9P",
    );
  });

  it("buildShortAttachmentUrl strips trailing slash on base URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://disputedesk.app/";
    expect(buildShortAttachmentUrl("Q7K2HXRJ9P")).toBe(
      "https://disputedesk.app/e/Q7K2HXRJ9P",
    );
  });
});
