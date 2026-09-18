/**
 * Bank-facing tracking-link contract.
 *
 * Every URL literal in the "prod shapes" describe block was taken from
 * `shopify_fulfillment_trackings` on prod 2026-08-14 (see
 * scripts/sql/tracking-url-shapes.sql). They are the actual strings we were
 * printing into defence packages, so they are what the fix must handle.
 */

import { describe, expect, it } from "vitest";
import {
  identifyTrackingLinkCarrier,
  resolveTrackingLinkUrl,
  trackingLinkUrl,
  urlReferencesShipment,
} from "@/lib/carriers/trackingLinkUrl";

describe("resolveTrackingLinkUrl — canonical templates", () => {
  it("DHL prints the identifier under BOTH spellings so the results page opens directly", () => {
    // A genuine DHL Express waybill — the case the duplicated `trackingid=` /
    // `tracking-id=` spelling was reported working for.
    //
    // This case USED to be pinned with an IMpb number (`420115809261…`) taken
    // from a TechSHIP row, asserting it resolved to dhl.com. That assertion
    // was never verified against a live parcel: it pinned the URL SPELLING
    // and silently carried an unverified claim about the number's carrier.
    // It was wrong — a `420…` barcode is a USPS-network number and DHL
    // Express renders an empty page for it, which is exactly the failure the
    // maintainer reported on 2026-09-03. See the number-format describe block.
    const r = resolveTrackingLinkUrl({
      company: "DHL Express",
      number: "473325380010451152",
      url: "https://www.dhl.com/us-en/home/tracking.html?submit=1&tracking-id=473325380010451152",
    });
    // The reported working form: submit=1 + trackingid= + tracking-id=.
    expect(r.url).toBe(
      "https://www.dhl.com/us-en/home/tracking.html?submit=1" +
        "&trackingid=473325380010451152" +
        "&tracking-id=473325380010451152",
    );
    expect(r.source).toBe("canonical");
    expect(r.carrier).toBe("dhl");
  });

  it("a TechSHIP IMpb barcode goes to USPS, not the DHL page it used to open", () => {
    // The regression this file previously pinned the WRONG way round.
    const r = resolveTrackingLinkUrl({
      company: "TechSHIP",
      number: "420115809261290416102420734108",
      url: "https://www.dhl.com/us-en/home/tracking.html?submit=1&tracking-id=420115809261290416102420734108",
    });
    expect(r.carrier).toBe("usps");
    expect(r.url).toBe("https://tools.usps.com/tracking/9261290416102420734108");
  });

  it("UPS uses tracknum= on www.ups.com, never the retired wwwapps host", () => {
    const r = resolveTrackingLinkUrl({
      company: "UPS",
      number: "1Z12CG40YN23275168",
      url: "http://wwwapps.ups.com/WebTracking/track?track=yes&loc=en_us&trackNums=1Z12CG40YN23275168",
    });
    expect(r.url).toBe(
      "https://www.ups.com/track?loc=en_US&requester=ST&tracknum=1Z12CG40YN23275168",
    );
    expect(r.source).toBe("canonical");
  });

  it("USPS emits the short path form USPS's own UI produces", () => {
    // Browser-verified 2026-08-14: all of `/tracking/{n}`,
    // `TrackConfirmAction?qtc_tLabels1=`, `?tLabels=` and even
    // `TrackConfirmAction_input` resolve the SAME parcel — USPS
    // normalizes them. The path form is chosen as the shortest.
    const r = resolveTrackingLinkUrl({
      company: "USPS",
      number: "9434650899563194079164",
      url: "https://tools.usps.com/go/TrackConfirmAction_input?qtc_tLabels1=9434650899563194079164",
    });
    expect(r.url).toBe("https://tools.usps.com/tracking/9434650899563194079164");
  });

  it("DHL eCommerce keeps its own host — an eCommerce number on the Express page finds nothing", () => {
    const r = resolveTrackingLinkUrl({
      company: "DHL eCommerce",
      number: "9261290171048700685169",
      url: "http://webtrack.dhlglobalmail.com/?trackingnumber=9261290171048700685169",
    });
    expect(r.carrier).toBe("dhl_ecommerce");
    expect(r.url).toBe(
      "https://webtrack.dhlglobalmail.com/?trackingnumber=9261290171048700685169",
    );
  });

  it("sub-brands beat their parent: DHL eCommerce is not DHL Express", () => {
    expect(identifyTrackingLinkCarrier("DHL eCommerce", null)).toBe("dhl_ecommerce");
    expect(identifyTrackingLinkCarrier("Globalmail", null)).toBe("dhl_ecommerce");
    expect(identifyTrackingLinkCarrier("DHL", null)).toBe("dhl");
    expect(identifyTrackingLinkCarrier("DHL Express", null)).toBe("dhl");
  });

  it("UPS Mail Innovations routes to USPS, which is where its numbers resolve", () => {
    const r = resolveTrackingLinkUrl({
      company: "UPS Mail Innovations",
      number: "92612903033402543400560980",
      url: "http://wwwapps.ups.com/WebTracking/track?track=yes&trackNums=92612903033402543400560980",
    });
    expect(r.carrier).toBe("usps");
    expect(r.url).toContain("tools.usps.com");
  });

  it("FedEx and Purolator use their current single-parcel params", () => {
    expect(trackingLinkUrl({ company: "FedEx", number: "276987244218" })).toBe(
      "https://www.fedex.com/fedextrack/?trknbr=276987244218",
    );
    // `pin` singular; 310 prod rows carry the legacy `pins`.
    expect(trackingLinkUrl({ company: "Purolator", number: "520080815084" })).toBe(
      "https://www.purolator.com/en/shipping/tracker?pin=520080815084",
    );
  });

  it("uses the carrier-declared canonical hosts, not the retired ones", () => {
    // La Poste 301s the legacy colissimo.fr URL to this exact path.
    expect(trackingLinkUrl({ company: "La Poste Colissimo", number: "CW541676386FR" })).toBe(
      "https://www.laposte.fr/particulier/outils/suivre-vos-envois?code=CW541676386FR",
    );
    // Intelcom rebranded to Dragonfly; `track-my-package` 404s.
    const intelcom = trackingLinkUrl({ company: "Intelcom", number: "SE2505223Q75" });
    expect(intelcom).toBe(
      "https://dragonflyshipping.ca/en/track-your-package/?tracking-id=SE2505223Q75",
    );
    expect(intelcom).not.toContain("track-my-package");
    // PostNord: tracking.postnord.com is the real tracker — the
    // postnord.se page is a shell embedding that same widget, and
    // `shipmentId=` is an internal API field, not a URL parameter.
    expect(trackingLinkUrl({ company: "PostNord SE", number: "00573132901588003506" })).toBe(
      "https://tracking.postnord.com/se/?id=00573132901588003506",
    );
  });

  it("has no template for carriers whose page gates on recipient postcode", () => {
    // DPD DE forces a postcode page; DPD IE has no GET deep-link at all.
    // Both must fall back to the merchant URL rather than get a template
    // that promises a result page we cannot deliver.
    expect(identifyTrackingLinkCarrier("DPD", null)).toBeNull();
    const r = resolveTrackingLinkUrl({
      company: "DPD",
      number: "09988776655443",
      url: "https://www.dpdgroup.com/nl/mydpd/my-parcels/incoming",
    });
    expect(r.source).toBe("none");
  });

  it("identifies the carrier from the URL host when the company string is opaque", () => {
    // "cs27", "TechSHIP", "Other" are all real prod company strings.
    expect(
      identifyTrackingLinkCarrier("cs27", "http://webtrack.dhlglobalmail.com/?trackingnumber=GM605115988000100106"),
    ).toBe("dhl_ecommerce");
    expect(
      identifyTrackingLinkCarrier("TechSHIP", "https://www.ups.com/track?loc=en_US&tracknum=1Z31X14F0393928991"),
    ).toBe("ups");
  });

  it("percent-encodes the identifier so a hostile number cannot alter the URL", () => {
    const r = resolveTrackingLinkUrl({ company: "FedEx", number: "123456&evil=1" });
    // Not a plausible identifier (contains &) → no canonical link at all.
    expect(r.source).toBe("none");
    expect(r.url).toBeNull();
  });
});

describe("resolveTrackingLinkUrl — refuses to print a link that disproves the row", () => {
  it("drops a URL whose identifier param is EMPTY", () => {
    // 3,244 prod rows look exactly like this.
    const r = resolveTrackingLinkUrl({
      company: "Unknown Courier",
      number: null,
      url: "https://www.ups.com/track?loc=en_US&tracknum=",
    });
    expect(r.url).toBeNull();
    expect(r.source).toBe("none");
  });

  it("drops a bare search page carrying no identifier", () => {
    for (const url of [
      "https://gtagsm.com/tracking/",
      "http://ppxtrack.com",
      "https://webtrack.dhlglobalmail.com/",
      "https://tools.usps.com/tracking/",
      "https://www.dpdgroup.com/nl/mydpd/my-parcels/incoming",
    ]) {
      expect(urlReferencesShipment(url)).toBe(false);
      expect(trackingLinkUrl({ company: "Whatever", number: null, url })).toBeNull();
    }
  });

  it("a known carrier with no usable number falls back rather than fabricating one", () => {
    const r = resolveTrackingLinkUrl({
      company: "USPS",
      number: null,
      url: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400150899563470273413",
    });
    expect(r.source).toBe("merchant");
    // The number is recovered from the URL's own param and normalized onto
    // the path form, rather than a number being invented from nowhere.
    expect(r.url).toBe("https://tools.usps.com/tracking/9400150899563470273413");
  });

  it("rejects a truncated junk identifier like ?trackingid=c", () => {
    expect(urlReferencesShipment("https://gtagsm.com/tracking/?trackingid=c")).toBe(false);
  });
});

describe("resolveTrackingLinkUrl — merchant fallback repair", () => {
  it("upgrades http to https (35% of prod rows are plain http)", () => {
    const r = resolveTrackingLinkUrl({
      company: "Whistl",
      number: null,
      url: "https://trackmyitem.whistl.co.uk/tracking/RRD010855300014412",
    });
    expect(r.source).toBe("merchant");
    expect(r.url?.startsWith("https://")).toBe(true);
  });

  it("keeps an unknown carrier's working URL untouched apart from the scheme", () => {
    const r = resolveTrackingLinkUrl({
      company: "Whiz Delivery",
      number: "SW00438BA1AA",
      url: "https://tracking.whizdelivery.ca/t?q=SW00438BA1AA",
    });
    expect(r.carrier).toBeNull();
    expect(r.source).toBe("merchant");
    expect(r.url).toBe("https://tracking.whizdelivery.ca/t?q=SW00438BA1AA");
  });

  it("accepts a path-embedded identifier (Evri, Passport, Omniva)", () => {
    expect(
      urlReferencesShipment("https://www.evri.com/track/parcel/92001909901127513087001496/details"),
    ).toBe(true);
    expect(urlReferencesShipment("https://track.passportshipping.com/1029437013485739")).toBe(true);
    expect(urlReferencesShipment("https://mana.omniva.lv/track/LL004117115EE")).toBe(true);
  });

  it("accepts a hash-routed identifier (Canada Post)", () => {
    expect(
      urlReferencesShipment(
        "https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=4003818060229782",
      ),
    ).toBe(true);
  });

  it("never throws on malformed input", () => {
    for (const url of ["", "not a url", "javascript:alert(1)", "ftp://x/y", null, undefined]) {
      expect(() => resolveTrackingLinkUrl({ company: "X", number: "1", url })).not.toThrow();
      expect(urlReferencesShipment(url)).toBe(false);
    }
    // A javascript: URL must never survive to a PDF.
    expect(trackingLinkUrl({ company: null, number: null, url: "javascript:alert(1)" })).toBeNull();
  });
});

/**
 * Routing by the NUMBER's format, when the merchant's carrier string
 * disagrees with it.
 *
 * Reported by the maintainer 2026-09-03 against a live blume-box package:
 * "if I click it, I end up on a DHL page with no code posted." The parcel's
 * carrier read "TechSHIP", the number was the IMpb barcode
 * 420774699261290416102420744039, and we built a dhl.com link from it —
 * which DHL Express cannot resolve, because the number belongs to the USPS
 * network.
 *
 * Prod scale of the misroute at the time (shopify_fulfillment_trackings):
 *   company "DHL"      → 5,162 IMpb + 25,821 bare-22 USPS numbers
 *   company "TechSHIP" → 5,251 IMpb +    327 bare-22 USPS numbers
 * = 36,561 shipments whose bank-facing link could not resolve.
 */
describe("routes by number format when the carrier string disagrees", () => {
  // The exact parcel from the reported package (blume-box dispute 46caa8fe).
  const IMPB = "420774699261290416102420744039";
  const INNER = "9261290416102420744039";

  it("sends an IMpb barcode to USPS, tracking the INNER 22 digits", () => {
    const r = resolveTrackingLinkUrl({
      company: "TechSHIP",
      number: IMPB,
      url: "https://www.dhl.com/us-en/home/tracking.html?submit=1&trackingid=" + IMPB,
    });
    expect(r.carrier).toBe("usps");
    expect(r.source).toBe("canonical");
    // The 420 + destination-ZIP prefix is a routing header, not part of the
    // trackable identifier.
    expect(r.url).toBe(`https://tools.usps.com/tracking/${INNER}`);
    expect(r.url).not.toContain("dhl.com");
  });

  it("does the same when the carrier literally says DHL", () => {
    const r = resolveTrackingLinkUrl({ company: "DHL", number: IMPB, url: null });
    expect(r.url).toBe(`https://tools.usps.com/tracking/${INNER}`);
  });

  it("sends a bare 22-digit USPS number to USPS even when labelled DHL", () => {
    // 25,821 prod rows under company "DHL" are exactly this shape.
    const r = resolveTrackingLinkUrl({
      company: "DHL",
      number: "9274890990112751308700",
      url: null,
    });
    expect(r.carrier).toBe("usps");
    expect(r.url).toBe("https://tools.usps.com/tracking/9274890990112751308700");
  });

  it("leaves a genuine DHL Express number on DHL", () => {
    // The rule must be narrow: only the two unambiguous USPS-network
    // formats are rerouted. A real DHL waybill keeps its own template.
    const r = resolveTrackingLinkUrl({
      company: "DHL Express",
      number: "473325380010451152",
      url: null,
    });
    expect(r.carrier).toBe("dhl");
    expect(r.url).toContain("dhl.com");
  });

  it("leaves UPS, FedEx and PostNord untouched", () => {
    expect(resolveTrackingLinkUrl({ company: "UPS", number: "1Z8TM37L6827673944" }).carrier).toBe("ups");
    expect(resolveTrackingLinkUrl({ company: "FedEx", number: "876489753690" }).carrier).toBe("fedex");
    expect(
      resolveTrackingLinkUrl({ company: "PostNord SE", number: "00573132901873456413" }).carrier,
    ).toBe("postnord");
  });

  it("does NOT hijack DHL eCommerce, which resolves those numbers itself", () => {
    // DHL eCommerce injects into the USPS network — 65,360 prod rows carry a
    // bare-22 number — but tracks them on its own webtrack host, verified in
    // a real browser to render FULLER scan history than USPS does.
    //
    // This is the guard on the override's scope: the rule exists to fix a
    // template that cannot resolve the number, not to prefer USPS generally.
    const r = resolveTrackingLinkUrl({
      company: "DHL eCommerce",
      number: "9274890990112751308700",
      url: null,
    });
    expect(r.carrier).toBe("dhl_ecommerce");
    expect(r.url).toBe(
      "https://webtrack.dhlglobalmail.com/?trackingnumber=9274890990112751308700",
    );
  });
});
