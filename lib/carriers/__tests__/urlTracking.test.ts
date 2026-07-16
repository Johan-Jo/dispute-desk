import { describe, it, expect } from "vitest";
import { extractDhlTrackingIds, isDhlHost } from "@/lib/carriers/urlTracking";

const FREIGHT_URL =
  "https://www.dhl.com/se-en/home/tracking.html?tracking-id=373325386394209542";

describe("extractDhlTrackingIds", () => {
  it("extracts the tracking-id from the real DHL Freight URL shape", () => {
    expect(extractDhlTrackingIds(FREIGHT_URL)).toEqual(["373325386394209542"]);
  });

  it("survives extra query parameters and fragments", () => {
    expect(
      extractDhlTrackingIds(
        "https://www.dhl.com/track?foo=1&tracking-id=ABC-123&bar=2#section",
      ),
    ).toEqual(["ABC-123"]);
  });

  it("handles URL-encoded values and surrounding whitespace", () => {
    expect(
      extractDhlTrackingIds("  https://www.dhl.com/t?tracking-id=373325%2D386394  "),
    ).toEqual(["373325-386394"]);
  });

  it("treats identical repeated params as one identifier", () => {
    expect(
      extractDhlTrackingIds("https://dhl.com/t?tracking-id=X1234&tracking-id=X1234"),
    ).toEqual(["X1234"]);
  });

  it("returns both candidates on CONFLICTING repeated params (caller must not pick)", () => {
    expect(
      extractDhlTrackingIds("https://dhl.com/t?tracking-id=X1234&tracking-id=Y5678"),
    ).toHaveLength(2);
  });

  it("is case-insensitive on the parameter name", () => {
    expect(extractDhlTrackingIds("https://dhl.de/t?Tracking-ID=Z9999")).toEqual(["Z9999"]);
  });

  it("rejects non-DHL and lookalike hosts (no identifier injection)", () => {
    expect(extractDhlTrackingIds("https://notdhl.com/t?tracking-id=X1234")).toEqual([]);
    expect(extractDhlTrackingIds("https://dhl.example.com/t?tracking-id=X1234")).toEqual([]);
    expect(extractDhlTrackingIds("https://evil.com/dhl.com/t?tracking-id=X1234")).toEqual([]);
  });

  it("accepts DHL subdomains and country TLDs", () => {
    expect(isDhlHost("activetracing.dhl.com")).toBe(true);
    expect(isDhlHost("www.dhl.de")).toBe(true);
    expect(isDhlHost("dhl.co.uk")).toBe(true);
    expect(isDhlHost("dhl.com.evil.net")).toBe(false);
  });

  it("never throws on malformed or malicious input", () => {
    expect(extractDhlTrackingIds("not a url")).toEqual([]);
    expect(extractDhlTrackingIds("javascript:alert(1)")).toEqual([]);
    expect(extractDhlTrackingIds("ftp://dhl.com/t?tracking-id=X1234")).toEqual([]);
    expect(extractDhlTrackingIds("")).toEqual([]);
    expect(extractDhlTrackingIds(null)).toEqual([]);
    expect(extractDhlTrackingIds(undefined)).toEqual([]);
  });

  it("rejects free-text / injection payloads as identifiers", () => {
    expect(
      extractDhlTrackingIds("https://dhl.com/t?tracking-id=%3Cscript%3Ealert(1)%3C/script%3E"),
    ).toEqual([]);
    expect(extractDhlTrackingIds("https://dhl.com/t?tracking-id=ab")).toEqual([]);
  });
});
