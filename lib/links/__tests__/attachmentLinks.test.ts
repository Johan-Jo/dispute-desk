import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ATTACHMENT_LINK_TTL_DAYS,
  buildAttachmentUrl,
  requireEvidenceLinkSecret,
  signAttachmentToken,
  verifyAttachmentToken,
} from "../attachmentLinks";

const SECRET_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SECRET_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("attachmentLinks", () => {
  let prevSecret: string | undefined;
  let prevAppUrl: string | undefined;

  beforeEach(() => {
    prevSecret = process.env.EVIDENCE_LINK_SECRET;
    prevAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    process.env.EVIDENCE_LINK_SECRET = SECRET_A;
    process.env.NEXT_PUBLIC_APP_URL = "https://disputedesk.app";
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.EVIDENCE_LINK_SECRET;
    else process.env.EVIDENCE_LINK_SECRET = prevSecret;
    if (prevAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prevAppUrl;
  });

  it("exposes a 180-day default TTL constant", () => {
    expect(ATTACHMENT_LINK_TTL_DAYS).toBe(180);
  });

  it("roundtrips a valid token", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signAttachmentToken(
      { k: "item", id: "item-1", p: "pack-1", exp },
      SECRET_A,
    );
    const v = verifyAttachmentToken(token, SECRET_A);
    expect(v).not.toBeNull();
    expect(v?.k).toBe("item");
    expect(v?.id).toBe("item-1");
    expect(v?.p).toBe("pack-1");
    expect(v?.exp).toBe(exp);
  });

  it("rejects an expired token", () => {
    const exp = Math.floor(Date.now() / 1000) - 1;
    const token = signAttachmentToken(
      { k: "item", id: "item-1", p: "pack-1", exp },
      SECRET_A,
    );
    expect(verifyAttachmentToken(token, SECRET_A)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signAttachmentToken(
      { k: "item", id: "item-1", p: "pack-1", exp },
      SECRET_A,
    );
    const [payload, sig] = token.split(".");
    const last = payload.slice(-1);
    const flipped = last === "A" ? "B" : "A";
    const tampered = `${payload.slice(0, -1)}${flipped}.${sig}`;
    expect(verifyAttachmentToken(tampered, SECRET_A)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signAttachmentToken(
      { k: "pdf", id: "pack-1", p: "pack-1", exp },
      SECRET_A,
    );
    const [payload, sig] = token.split(".");
    // Flip a char in the middle of the signature, not the last char —
    // base64url's final char of an HMAC-SHA256 signature only encodes
    // 4 meaningful bits (the rest is padding-implicit zero bits), so
    // flipping it can leave the decoded MAC bytes unchanged. A
    // mid-signature flip always changes a full 6-bit byte boundary.
    const mid = Math.floor(sig.length / 2);
    const midChar = sig[mid];
    const flipped = midChar === "A" ? "B" : "A";
    const tampered = `${payload}.${sig.slice(0, mid)}${flipped}${sig.slice(mid + 1)}`;
    expect(verifyAttachmentToken(tampered, SECRET_A)).toBeNull();
  });

  it("rejects a token signed by a different secret", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signAttachmentToken(
      { k: "item", id: "item-1", p: "pack-1", exp },
      SECRET_A,
    );
    expect(verifyAttachmentToken(token, SECRET_B)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifyAttachmentToken("", SECRET_A)).toBeNull();
    expect(verifyAttachmentToken("onlyonepart", SECRET_A)).toBeNull();
    expect(verifyAttachmentToken("too.many.parts", SECRET_A)).toBeNull();
  });

  it("sign throws when secret is missing or too short", () => {
    expect(() =>
      signAttachmentToken(
        { k: "item", id: "x", p: "y", exp: 1 },
        "short",
      ),
    ).toThrow();
  });

  it("requireEvidenceLinkSecret throws when env var is missing", () => {
    delete process.env.EVIDENCE_LINK_SECRET;
    expect(() => requireEvidenceLinkSecret()).toThrow(/EVIDENCE_LINK_SECRET/);
  });

  it("requireEvidenceLinkSecret throws when env var is too short", () => {
    process.env.EVIDENCE_LINK_SECRET = "short";
    expect(() => requireEvidenceLinkSecret()).toThrow(/EVIDENCE_LINK_SECRET/);
  });

  it("buildAttachmentUrl appends /e/<token> under the public base", () => {
    expect(buildAttachmentUrl("abc.def")).toBe(
      "https://disputedesk.app/e/abc.def",
    );
  });

  it("buildAttachmentUrl trims a trailing slash from the base", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://disputedesk.app/";
    expect(buildAttachmentUrl("xyz")).toBe("https://disputedesk.app/e/xyz");
  });
});
