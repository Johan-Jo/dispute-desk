/**
 * Canonical bank-facing tracking LINK builder.
 *
 * ── THE DEFECT THIS CLOSES ────────────────────────────────────────────
 *
 * Every tracking URL printed into a defence package was passed through
 * VERBATIM from Shopify's `fulfillments[].tracking[].url` — a value the
 * merchant's shipping app writes, not one we control. Measured on prod
 * 2026-08-14 across 349,405 tracking rows:
 *
 *   - 121,851 (35%) are plain `http://` — a bank reviewer following one
 *     gets a browser interstitial or a silent upgrade, and on
 *     `wwwapps.ups.com` a dead legacy host.
 *   -   3,244 embed an EMPTY identifier (`?...&trackNums=`, `?tLabels=`)
 *     — the link opens a blank search form with nothing to search.
 *   -   2,303 carry no identifier at all (`https://gtagsm.com/tracking/`,
 *     `http://ppxtrack.com`, `https://webtrack.dhlglobalmail.com/`).
 *   -  17,058 use USPS's `TrackConfirmAction_input` endpoint, whose
 *     `_input` suffix is precisely the "render the empty form" variant.
 *   -  19,931 + 1,798 use `wwwapps.ups.com/WebTracking/track`, retired.
 *
 * So the merchant's own URL is not a reliable citation. An issuer who
 * clicks it and lands on an empty search box does not read "the link is
 * stale" — they read "this merchant has no delivery proof". That is the
 * opposite of what the row asserts, printed under our name.
 *
 * ── WHAT THIS MODULE DOES ─────────────────────────────────────────────
 *
 * Given (carrier company string, tracking number, merchant URL), REBUILD
 * the link from a per-carrier canonical template keyed on the tracking
 * number we hold. The merchant URL is then only ever a fallback, and an
 * identifier-less one is dropped rather than printed.
 *
 * Precedence, deliberately in this order:
 *   1. A canonical template for an identified carrier + a usable number.
 *   2. The merchant's URL, IF it already carries an identifier — upgraded
 *      to https and repaired where the repair is known-safe.
 *   3. Nothing. A row prints its number and carrier with NO link rather
 *      than a link that proves the merchant wrong.
 *
 * ── WHAT THIS MODULE REFUSES TO DO ────────────────────────────────────
 *
 * It never invents an identifier, never guesses a carrier from a number's
 * shape, and never emits a template for a carrier whose deep-link format
 * we have not pinned. `TEMPLATES` is an allowlist; an unknown carrier
 * falls to rule 2/3 and keeps whatever the merchant gave us.
 *
 * ── ON VERIFICATION (read before editing TEMPLATES) ───────────────────
 *
 * These templates were assembled from carrier documentation, carrier-
 * owned source (official plugins, SPA route tables), carrier-issued 301
 * redirects, and live merchant links (2026-08-14).
 *
 * WHAT IS ESTABLISHED — the HOST and PATH of each template, i.e. that the
 * URL is the carrier's current tracking endpoint and not a retired one.
 * Several were confirmed by the carrier redirecting its own legacy URL
 * here (Colissimo → laposte.fr) or by the carrier's own form markup
 * (Dragonfly's GET form posts exactly this shape).
 *
 * WHAT IS **NOT** ESTABLISHED — that any of them AUTO-SUBMITS rather than
 * rendering a pre-filled form. dhl.com, ups.com, tools.usps.com,
 * intelcom.ca and postnord.se all refuse automated requests, and every
 * one of these pages is a client-rendered SPA, so no fetch — ours or
 * anyone's — observes what a real browser renders. Auto-submit is
 * therefore a REPORTED behaviour here, not a verified one.
 *
 * Any change must be checked by opening the URL in a real browser against
 * a live shipment. A template that renders an empty form is worse than no
 * template, because rule 3 would at least have printed nothing.
 *
 * Known gates that no URL can bypass — for these, the link is a courtesy
 * and the carrier-confirmed timestamp we persist is the actual evidence:
 *   - DPD Germany forces a recipient-postcode entry page by design.
 *   - DPD Ireland has no GET deep-link at all (its form is POST-only).
 *   - Evri may prompt for a postcode before showing full detail.
 * None of the three has a template below; they fall to the merchant-URL
 * fallback deliberately.
 *
 * A tracking link is a CONVENIENCE for the reviewer, never the proof
 * itself: carriers purge tracking data after ~90-120 days, so a link in a
 * package read months later may legitimately show nothing. The durable
 * evidence is the carrier-confirmed delivery timestamp and POD we already
 * persist — the link only saves the reviewer a lookup.
 */

/** Carriers whose canonical deep-link format is pinned below. Keyed by
 *  our own slug vocabulary, extended with the sub-brands that have a
 *  genuinely DIFFERENT tracking host (DHL eCommerce is not DHL Express). */
export type TrackingLinkCarrier =
  | "ups"
  | "usps"
  | "fedex"
  | "dhl"
  | "dhl_ecommerce"
  | "canada_post"
  | "postnord"
  | "purolator"
  | "colissimo"
  | "intelcom"
  | "evri"
  | "stallion"
  | "fleet_optics";

/**
 * Canonical templates. `{id}` is replaced with the percent-encoded
 * tracking number.
 *
 * DHL keeps the duplicated identifier (`trackingid` AND `tracking-id`)
 * reported by the maintainer as the form that opens results directly
 * rather than an empty box. The un-hyphenated spelling is not documented
 * by DHL and could not be confirmed from here; it is retained because it
 * is inert if unnecessary (an unrecognized query param is ignored) and
 * load-bearing if the report is right. `submit=1` is kept for the same
 * reason. If DHL is ever confirmed to need only one, drop the duplicate.
 */
const TEMPLATES: Record<TrackingLinkCarrier, (id: string) => string> = {
  // `tracknum` (singular) is the current parameter; `trackNums` and the
  // `wwwapps.ups.com` host are the retired forms that 21,729 prod rows
  // still carry.
  ups: (id) => `https://www.ups.com/track?loc=en_US&requester=ST&tracknum=${id}`,
  // `TrackConfirmAction` lands on results. `TrackConfirmAction_input` —
  // 17,058 prod rows — is the empty-form endpoint. The `_input` suffix is
  // the entire difference.
  usps: (id) => `https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=${id}`,
  fedex: (id) => `https://www.fedex.com/fedextrack/?trknbr=${id}`,
  dhl: (id) =>
    `https://www.dhl.com/us-en/home/tracking.html?submit=1&trackingid=${id}&tracking-id=${id}`,
  // DHL eCommerce (GM/LX/94-prefixed US parcels) is a separate system;
  // an eCommerce number on the Express page returns nothing.
  dhl_ecommerce: (id) => `https://webtrack.dhlglobalmail.com/?trackingnumber=${id}`,
  canada_post: (id) =>
    `https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=${id}`,
  postnord: (id) => `https://tracking.postnord.com/se/?id=${id}`,
  // `pin` singular — the `pins` plural in 310 prod rows is the legacy form.
  purolator: (id) => `https://www.purolator.com/en/shipping/tracker?pin=${id}`,
  // La Poste declares this canonical itself: the legacy
  // `colissimo.fr/portail_colissimo/suivre.do?colispart=` 301-redirects
  // here, preserving the number in `code=`.
  colissimo: (id) => `https://www.laposte.fr/particulier/outils/suivre-vos-envois?code=${id}`,
  // Intelcom rebranded to Dragonfly. The path is `track-your-package`
  // WITH the trailing slash — `track-my-package` 404s. Safe to deep-link
  // because the page's own tracking form is a GET form posting to this
  // exact URL with a `tracking-id` input, so the link is byte-identical
  // to what a manual search produces.
  intelcom: (id) => `https://dragonflyshipping.ca/en/track-your-package/?tracking-id=${id}`,
  // Evri's route table registers this path, but the bundle also carries an
  // `EnterPostcodeModal` and the underlying API takes `&postcode=`, so the
  // reviewer may still be gated. Kept because it is at minimum the correct
  // modern host (hermes-europe.co.uk 301s here) and strictly better than
  // the legacy URL a merchant may have stored.
  evri: (id) => `https://www.evri.com/track/parcel/${id}/details`,
  stallion: (id) => `https://stallionexpress.ca/track/?tracking=${id}`,
  fleet_optics: (id) => `https://track.fleetopticsinc.com/?tracking_number=${id}`,
};

/**
 * Company-string → template carrier. Ordered: the FIRST match wins, so
 * the more specific sub-brand must precede its parent ("DHL eCommerce"
 * before "DHL", "UPS Mail Innovations" before "UPS").
 *
 * Matched against the merchant's raw `company` string, which in prod is
 * anything from "UPS" to "TechSHIP" to "cs27". A miss is not a failure —
 * it means no template applies and the merchant URL is used instead.
 */
const COMPANY_PATTERNS: Array<{ re: RegExp; carrier: TrackingLinkCarrier }> = [
  // ── sub-brands first ──
  // DHL eCommerce / Global Mail: injected into the USPS network in the US
  // but tracked on DHL's own webtrack host.
  { re: /dhl\s*(e-?commerce|global\s*mail)|globalmail/i, carrier: "dhl_ecommerce" },
  // UPS Mail Innovations hands off to USPS for final delivery and its
  // numbers are USPS-trackable; UPS's own page often has nothing.
  { re: /ups\s*mail\s*innovations/i, carrier: "usps" },
  // ── parents ──
  { re: /(^|\b)dhl(\b|$)/i, carrier: "dhl" },
  { re: /(^|\b)ups\d*(\b|$)/i, carrier: "ups" },
  { re: /(^|\b)usps(\b|$)|stamps/i, carrier: "usps" },
  { re: /(^|\b)fedex\d*(\b|$)/i, carrier: "fedex" },
  { re: /canada\s*post|postes\s*canada/i, carrier: "canada_post" },
  { re: /postnord/i, carrier: "postnord" },
  { re: /purolator/i, carrier: "purolator" },
  { re: /colissimo|la\s*poste/i, carrier: "colissimo" },
  { re: /intelcom|dragonfly/i, carrier: "intelcom" },
  { re: /evri|hermes/i, carrier: "evri" },
  { re: /stallion/i, carrier: "stallion" },
  { re: /fleet\s*optics/i, carrier: "fleet_optics" },
];

/**
 * Host → template carrier, for when the company string is unhelpful
 * ("TechSHIP", "cs27", "Other") but the URL names the carrier. Same
 * first-match-wins ordering rule.
 */
const HOST_PATTERNS: Array<{ re: RegExp; carrier: TrackingLinkCarrier }> = [
  { re: /(^|\.)dhlglobalmail\.com$/i, carrier: "dhl_ecommerce" },
  { re: /(^|\.)(dhl\.com|logistics\.dhl)$/i, carrier: "dhl" },
  { re: /(^|\.)ups\.com$/i, carrier: "ups" },
  { re: /(^|\.)usps\.com$/i, carrier: "usps" },
  { re: /(^|\.)fedex\.com$/i, carrier: "fedex" },
  { re: /(^|\.)canadapost(-postescanada)?\.ca$/i, carrier: "canada_post" },
  { re: /(^|\.)postnord\.(com|se|dk|no|fi)$/i, carrier: "postnord" },
  { re: /(^|\.)purolator\.com$/i, carrier: "purolator" },
  { re: /(^|\.)laposte\.fr$/i, carrier: "colissimo" },
  { re: /(^|\.)intelcom\.ca$/i, carrier: "intelcom" },
  { re: /(^|\.)evri\.com$/i, carrier: "evri" },
  { re: /(^|\.)stallionexpress\.ca$/i, carrier: "stallion" },
  { re: /(^|\.)(fleetopticsinc\.(ca|com))$/i, carrier: "fleet_optics" },
];

/**
 * Query/hash params that carry a shipment identifier, across every URL
 * shape observed in prod. Used to answer one question only: does this
 * merchant URL actually reference a shipment, or is it a bare search page?
 */
const IDENTIFIER_PARAMS = new Set([
  "tracknum",
  "tracknums",
  "tracking-id",
  "trackingid",
  "tracking_id",
  "trackingnumber",
  "trackingnumbers",
  "tracking_number",
  "tracking_numbers",
  "tracking",
  "tlabels",
  "qtc_tlabels1",
  "trknbr",
  "tracknumbers",
  "searchfor",
  "shipmentid",
  "pin",
  "pins",
  "code",
  "id",
  "nums",
  "num",
  "q",
]);

/**
 * A plausible shipment identifier. Deliberately permissive on charset
 * (carriers use letters, digits and dashes) but strict about emptiness
 * and length, which is what actually distinguishes a real reference from
 * `?trackNums=` or `?trackingid=c`.
 */
function isPlausibleIdentifier(value: string): boolean {
  const v = value.trim();
  return v.length >= 6 && v.length <= 64 && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v);
}

/** Parse a URL, tolerating the junk merchants store. Null on anything
 *  that is not an http(s) URL. */
function parseHttpUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed;
}

/**
 * Does this URL reference a specific shipment? True only when some
 * identifier-bearing param holds a plausible value, or the path itself
 * ends in one (Evri, Passport Shipping, Whistl and Omniva put the number
 * in the path).
 *
 * This is the test that removes the 5,547 prod URLs which open an empty
 * search form.
 */
export function urlReferencesShipment(raw: string | null | undefined): boolean {
  const parsed = parseHttpUrl(raw);
  if (!parsed) return false;

  const paramSources = [parsed.searchParams, new URLSearchParams(parsed.hash.replace(/^#[^?]*\??/, ""))];
  for (const params of paramSources) {
    for (const [key, value] of params) {
      if (!IDENTIFIER_PARAMS.has(key.toLowerCase())) continue;
      const first = value.split(",")[0] ?? "";
      if (isPlausibleIdentifier(first)) return true;
    }
  }

  // Path-embedded identifier: ANY segment that looks like a shipment
  // reference rather than a page name. Not just the last one — Evri ends
  // its URLs with `/details` and puts the number in the segment before it
  // (`/track/parcel/9200190…/details`).
  //
  // Requires a digit AND at least 8 characters so page names never
  // qualify: `/tracking/`, `/track/parcel/`, `/en-us/home` and the
  // locale-and-page segments carriers use all fail one test or the other.
  const segments = parsed.pathname.split("/").filter(Boolean);
  return segments.some(
    (seg) => seg.length >= 8 && /\d/.test(seg) && isPlausibleIdentifier(seg),
  );
}

/** Identify which canonical template applies, from the company string
 *  first and the URL host second. Null when nothing matches. */
export function identifyTrackingLinkCarrier(
  company: string | null | undefined,
  url: string | null | undefined,
): TrackingLinkCarrier | null {
  const c = (company ?? "").trim();
  if (c) {
    for (const p of COMPANY_PATTERNS) {
      if (p.re.test(c)) return p.carrier;
    }
  }
  const parsed = parseHttpUrl(url);
  if (parsed) {
    for (const p of HOST_PATTERNS) {
      if (p.re.test(parsed.hostname)) return p.carrier;
    }
  }
  return null;
}

/**
 * Repair a merchant URL we are going to fall back to: force https (35% of
 * prod rows are http) and drop USPS's empty-form `_input` endpoint in
 * favour of the results endpoint. Conservative — it changes the scheme and
 * that one known-bad path, nothing else.
 */
function repairMerchantUrl(parsed: URL): string {
  const u = new URL(parsed.toString());
  u.protocol = "https:";
  if (/(^|\.)usps\.com$/i.test(u.hostname)) {
    u.pathname = u.pathname.replace(/TrackConfirmAction_input$/i, "TrackConfirmAction");
  }
  return u.toString();
}

export interface TrackingLinkInput {
  /** Merchant's carrier string, e.g. "UPS", "DHL eCommerce", "TechSHIP". */
  company?: string | null;
  /** The tracking number we hold for this shipment. */
  number?: string | null;
  /** The tracking URL as Shopify gave it to us. */
  url?: string | null;
}

export interface TrackingLinkResult {
  /** The URL to print, or null when nothing citable exists. */
  url: string | null;
  /** Where it came from — for tests, logging and doc'd behaviour. */
  source: "canonical" | "merchant" | "none";
  /** Which template produced a `canonical` URL. */
  carrier: TrackingLinkCarrier | null;
}

/**
 * THE one place a bank-facing tracking link is decided.
 *
 * Rule 1 — canonical template for an identified carrier + usable number.
 * Rule 2 — the merchant's URL, https-repaired, if it references a shipment.
 * Rule 3 — null. Print the number without a link rather than a link that
 *          opens an empty search box in front of the issuer.
 */
export function resolveTrackingLinkUrl(input: TrackingLinkInput): TrackingLinkResult {
  const number = (input.number ?? "").trim();
  const carrier = identifyTrackingLinkCarrier(input.company, input.url);

  if (carrier && isPlausibleIdentifier(number)) {
    return {
      url: TEMPLATES[carrier](encodeURIComponent(number)),
      source: "canonical",
      carrier,
    };
  }

  const parsed = parseHttpUrl(input.url);
  if (parsed && urlReferencesShipment(input.url)) {
    return { url: repairMerchantUrl(parsed), source: "merchant", carrier };
  }

  return { url: null, source: "none", carrier };
}

/** Convenience for call sites that only want the string. */
export function trackingLinkUrl(input: TrackingLinkInput): string | null {
  return resolveTrackingLinkUrl(input).url;
}
