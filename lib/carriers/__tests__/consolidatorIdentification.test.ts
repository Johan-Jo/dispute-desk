/**
 * Cross-border consolidator + regional carrier identification.
 *
 * Plan: docs/plans/tracking-app-delivery-signals.plan.md §5 (Phase 1).
 *
 * ── What this buys, and what it does not ─────────────────────────────
 *
 * These carriers have NO adapter. Registering them does not make any case
 * winnable — it moves them from `unknown_carrier` (metrics only, silent) to
 * `unsupported_carrier`, which emits the demand-signal email. That is the
 * entire point: a prod census on 2026-09-16 found 39.2% of 508,858 tracking
 * rows unidentifiable, and we only discovered it by querying. The next such
 * gap should announce itself.
 *
 * The `company_raw` strings below are the real ones from prod, with their
 * row counts, so a future reader can see what was actually being missed.
 */

import { describe, it, expect } from "vitest";
import { detectCarrier, identifyCarrier } from "../registry";

const entry = (company: string | null, url: string | null = null) => ({
  company,
  number: "TRACK123",
  url,
});

describe("consolidator identification (prod company_raw strings)", () => {
  it.each([
    ["YunExpress", "yunexpress", 104_262],
    ["SUNYOU", "sunyou", 4_082],
    ["Canada Post", "canada_post", 5_414],
    ["Intelcom", "intelcom", 3_916],
    ["Stallion Express", "stallion_express", 3_726],
    ["Purolator", "purolator", 310],
    ["CNE Express", "cne_express", 28],
  ])("identifies %s (prod: %s rows) as %s", (company, slug) => {
    expect(identifyCarrier(entry(company))).toMatchObject({
      slug,
      identifiedFrom: "company",
    });
  });

  it("identifies 4PX despite the leading digit", () => {
    // `\b` does not match between start-of-string and "4", so the usual
    // `(^|\b)…` shape silently fails here. Pinned because it would fail
    // quietly rather than loudly.
    expect(identifyCarrier(entry("4PX"))).toMatchObject({ slug: "fourpx" });
    expect(identifyCarrier(entry("4PX Express"))).toMatchObject({ slug: "fourpx" });
  });

  it("identifies common spelling variants", () => {
    expect(identifyCarrier(entry("Yun Express"))).toMatchObject({ slug: "yunexpress" });
    expect(identifyCarrier(entry("yunexpress"))).toMatchObject({ slug: "yunexpress" });
    expect(identifyCarrier(entry("Postes Canada"))).toMatchObject({ slug: "canada_post" });
    expect(identifyCarrier(entry("Cainiao"))).toMatchObject({ slug: "cainiao" });
    expect(identifyCarrier(entry("Yanwen"))).toMatchObject({ slug: "yanwen" });
  });

  it("identifies from the tracking-URL host when the company string is absent", () => {
    expect(identifyCarrier(entry(null, "https://www.yuntrack.com/track?n=X"))).toMatchObject({
      slug: "yunexpress",
      identifiedFrom: "url",
    });
    expect(identifyCarrier(entry(null, "https://www.canadapost-postescanada.ca/track"))).toMatchObject({
      slug: "canada_post",
    });
  });

  it("resolves to unsupported_carrier, not matched — no adapter exists", () => {
    // The demand-signal path. If this ever becomes "matched" without an
    // adapter being deliberately added, something registered by accident.
    const d = detectCarrier(entry("YunExpress"));
    expect(d.outcome).toBe("unsupported_carrier");
    if (d.outcome === "unsupported_carrier") expect(d.carrier).toBe("yunexpress");
  });

  it("leaves genuinely ambiguous strings unidentified", () => {
    // From the same prod census. These are NOT carriers: `Other` (28,822) is
    // a placeholder, `UPS2`/`FEDEXAPI` are fulfilment-service artefacts whose
    // tracking-number format was never verified against the real carrier, and
    // an empty string (16,609) says nothing at all. A wrong identification is
    // worse than none — it would send a lookup to the wrong carrier's API.
    expect(identifyCarrier(entry("Other"))).toBeNull();
    expect(identifyCarrier(entry(""))).toBeNull();
    expect(identifyCarrier(entry(null))).toBeNull();
    expect(identifyCarrier(entry("cs27"))).toBeNull();
    expect(identifyCarrier(entry("Ship Outside System"))).toBeNull();
  });

  it("does not disturb the pre-existing carriers", () => {
    expect(identifyCarrier(entry("DHL"))).toMatchObject({ slug: "dhl" });
    expect(identifyCarrier(entry("UPS"))).toMatchObject({ slug: "ups" });
    expect(identifyCarrier(entry("USPS"))).toMatchObject({ slug: "usps" });
    expect(identifyCarrier(entry("PostNord SE"))).toMatchObject({ slug: "postnord" });
    // DHL still has the only adapter, so it still matches rather than
    // falling through to the unsupported path.
    expect(detectCarrier(entry("DHL")).outcome).toBe("matched");
  });

  it("does not mistake 'Purolator' for 'UPS' or similar substrings", () => {
    expect(identifyCarrier(entry("Purolator"))).toMatchObject({ slug: "purolator" });
    expect(identifyCarrier(entry("Intelcom Dragonfly"))).toMatchObject({ slug: "intelcom" });
  });
});
