import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { extractLeadgenChanges, verifyMetaSignature } from "@/lib/marketing/metaLeads/webhookAuth";

const SECRET = "app-secret";
const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;

describe("verifyMetaSignature", () => {
  const body = '{"object":"page"}';
  it("accepts a correctly signed body", () => {
    expect(verifyMetaSignature(body, sign(body), SECRET)).toBe(true);
  });
  it("rejects a tampered body, a wrong secret, and missing or garbled headers", () => {
    expect(verifyMetaSignature(body + " ", sign(body), SECRET)).toBe(false);
    expect(verifyMetaSignature(body, sign(body, "other"), SECRET)).toBe(false);
    expect(verifyMetaSignature(body, null, SECRET)).toBe(false);
    expect(verifyMetaSignature(body, "sha256=", SECRET)).toBe(false);
    expect(verifyMetaSignature(body, "md5=abcd", SECRET)).toBe(false);
    expect(verifyMetaSignature(body, sign(body), "")).toBe(false);
  });
});

describe("extractLeadgenChanges", () => {
  it("returns only leadgen changes, with ids as strings", () => {
    const out = extractLeadgenChanges({
      object: "page",
      entry: [
        {
          id: "P1",
          changes: [
            { field: "leadgen", value: { leadgen_id: 123, form_id: 456, page_id: "P1" } },
            { field: "feed", value: { leadgen_id: "ignored" } },
            { field: "leadgen", value: {} },
          ],
        },
      ],
    });
    expect(out).toEqual([{ leadgenId: "123", formId: "456", pageId: "P1" }]);
  });
  it("tolerates junk payloads", () => {
    expect(extractLeadgenChanges(null)).toEqual([]);
    expect(extractLeadgenChanges({ entry: "x" })).toEqual([]);
    expect(extractLeadgenChanges({ entry: [{}] })).toEqual([]);
  });
});
