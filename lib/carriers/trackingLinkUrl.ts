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
 *   -  19,931 + 1,798 use `wwwapps.ups.com/WebTracking/track`, retired.
 *
 * (A sixth class was suspected and DISPROVEN: 17,058 rows use USPS's
 * `TrackConfirmAction_input` endpoint, whose `_input` suffix reads like an
 * empty-form variant. Browser-checked 2026-08-14 — it resolves the parcel
 * exactly like the other three USPS forms. Left here so the next reader
 * does not "rediscover" it from the URL's name alone.)
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
 *   0. The NUMBER's own format, where it contradicts the matched carrier
 *      and that carrier cannot resolve it (`routeByNumberFormat` +
 *      `CANNOT_RESOLVE_USPS_NETWORK`). A `420…` IMpb barcode is a USPS
 *      parcel whoever's name is on the label.
 *   1. A canonical template for an identified carrier + a usable number.
 *   2. The merchant's URL, IF it already carries an identifier — upgraded
 *      to https and repaired where the repair is known-safe.
 *   3. Nothing. A row prints its number and carrier with NO link rather
 *      than a link that proves the merchant wrong.
 *
 * ── ON THE CARRIER STRING'S RELIABILITY ───────────────────────────────
 *
 * `company` is free text and, for last-mile-injection services, names the
 * CONSOLIDATOR rather than the network holding the scan record. Prod
 * 2026-09-03: 30,983 rows labelled "DHL" and 5,578 labelled "TechSHIP"
 * carry USPS-network numbers. Rule 0 exists because of that — a carrier
 * name is a hint, a barcode format is evidence.
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
 * HOW TO VERIFY (this works — do not skip it and guess):
 *
 *   curl and headless Chromium are both 403'd by Akamai/Imperva on
 *   usps.com, ups.com, fedex.com and dhl.com. A HEADED real-Chrome
 *   session is not:
 *
 *     chromium.launch({ channel: "chrome", headless: false,
 *       args: ["--disable-blink-features=AutomationControlled"] })
 *     + addInitScript stripping navigator.webdriver
 *     + waitForTimeout(~13s) for the SPA to fetch and render
 *
 *   Then assert on the rendered body text. Use a tracking number that is
 *   still within carrier retention (~90-120 days) — an old number returns
 *   "not found" from a perfectly good URL and proves nothing. Pull a fresh
 *   one from `shopify_fulfillment_trackings` where shipment_status =
 *   'Delivered' and updated_at > now() - interval '25 days'.
 *
 * VERIFIED 2026-08-14 by that method, each against a live Delivered parcel
 * from prod — all four render the shipment, not a form:
 *   - DHL      `?submit=1&tracking-id=` → "Tracking Results … DELIVERED"
 *   - DHL eCom webtrack → full scan history with origin/destination
 *   - USPS     `/tracking/{n}` → "Delivered, In/At Mailbox … June 26"
 *   - UPS      `?tracknum=` → "Delivered … Tuesday, July 07 at 6:18 P.M."
 *
 * NOT verified this way: PostNord (consent wall blocks the render),
 * Colissimo (same), Canada Post, Purolator, Dragonfly, Evri, Stallion,
 * Fleet Optics. Their host+path come from carrier-issued redirects,
 * carrier-owned route tables and official plugin source; treat them as
 * correct-endpoint-but-unproven-render, and verify before relying on one.
 *
 * A template that renders an empty form is worse than no template, because
 * rule 3 would at least have printed nothing.
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
  // VERIFIED in a headed real-Chrome session 2026-08-14 (see the
  // "verified how" note below). All four USPS forms — `/tracking/{n}`,
  // `TrackConfirmAction?qtc_tLabels1=`, `TrackConfirmAction_input?...`
  // and `TrackConfirmAction?tLabels=` — render the SAME resolved parcel
  // ("Delivered, Parcel Locker … July 27, 2026"). The `_input` endpoint
  // is NOT an empty-form trap; USPS normalizes all of them.
  //
  // So the USPS rewrite is not a correctness fix, and the "Tracking Not
  // Available" page a bad link produces comes from the NUMBER not
  // resolving, never from the endpoint. The path form is kept because it
  // is the shortest and the one USPS's own UI produces.
  usps: (id) => `https://tools.usps.com/tracking/${id}`,
  fedex: (id) => `https://www.fedex.com/fedextrack/?trknbr=${id}`,
  // VERIFIED 2026-08-14 in headed real Chrome, against the live parcel from
  // dispute 11051073729: `?submit=1&tracking-id={n}` ALONE already renders
  // "Tracking Results … DELIVERED". The duplicated un-hyphenated
  // `trackingid=` is NOT required — both forms resolve identically. The
  // duplicate is kept only because it is byte-identical in outcome and is
  // the form the maintainer reported working; it costs nothing and removes
  // a class of doubt. Do not add more spellings on that reasoning.
  dhl: (id) =>
    `https://www.dhl.com/us-en/home/tracking.html?submit=1&trackingid=${id}&tracking-id=${id}`,
  // DHL eCommerce keeps its own host. VERIFIED 2026-08-14 against a live
  // Delivered 420-prefixed parcel: webtrack renders the full scan history
  // ("10 July 2026 02:54 PM CT Delivered, From PLAINFIELD, IN → Princeton,
  // TX"), which is MORE detail than dhl.com gives for the same number
  // (dhl.com resolves it too, but only as "DELIVERED" with a link back out
  // to "DHL eCommerce Web track").
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
 * IMpb (Intelligent Mail package barcode): `420` + a 5-digit destination ZIP
 * followed by the 22-digit USPS tracking number. Shipping platforms print the
 * full 30-digit barcode, but only the INNER 22 digits are trackable — USPS
 * does resolve the full string, DHL Express does not resolve either.
 */
const IMPB_RE = /^420\d{5}(9\d{21})$/;

/** A bare 22-digit USPS number (`9` + 21 digits). */
const USPS_22_RE = /^9\d{21}$/;

/**
 * Route by the NUMBER's own format, before the merchant's carrier string.
 *
 * ── THE DEFECT THIS CLOSES ────────────────────────────────────────────
 *
 * The merchant's `company` is free text, and for last-mile-injection
 * services it names the CONSOLIDATOR, not the carrier that actually holds
 * the scan record. Measured on prod 2026-09-03:
 *
 *   company "DHL"      → 5,162 IMpb + 25,821 bare-22 USPS numbers
 *   company "TechSHIP" → 5,251 IMpb +    327 bare-22 USPS numbers
 *
 * That is 36,561 shipments whose link we built from the `dhl` template and
 * pointed at dhl.com, which cannot resolve a USPS number — the reviewer got
 * DHL's tracking page with nothing on it. Reported by the maintainer against
 * blume-box parcel 420774699261290416102420744039 ("I end up on a DHL page
 * with no code posted"), and it is the same failure the module header already
 * warns about: an issuer who clicks and sees an empty page reads "this
 * merchant has no delivery proof", the opposite of what the row asserts.
 *
 * A `420…` barcode is self-identifying — it is a USPS-network number no
 * matter whose name is on the label — so the format is STRONGER evidence
 * than the company string and is consulted first. Returns the carrier AND
 * the identifier to track with, because for IMpb those differ: the printed
 * 30-digit barcode is not what goes in the URL.
 *
 * Deliberately narrow: only the two USPS-network formats, which are
 * unambiguous. Everything else falls through to the company/host matching
 * below, unchanged.
 */
/**
 * Carriers whose template CANNOT resolve a USPS-network number, so a
 * format-based override is warranted. DHL Express is the measured case:
 * 36,561 prod shipments labelled "DHL"/"TechSHIP" carry a USPS-network
 * number and matched `dhl`, producing a tracking page with nothing on it.
 *
 * `dhl_ecommerce` is deliberately ABSENT — it injects into the USPS network
 * but tracks those same numbers on its own webtrack host, browser-verified
 * 2026-08-14 to render fuller scan history than USPS does.
 */
const CANNOT_RESOLVE_USPS_NETWORK = new Set<TrackingLinkCarrier>(["dhl"]);

function routeByNumberFormat(
  number: string,
): { carrier: TrackingLinkCarrier; id: string } | null {
  const impb = IMPB_RE.exec(number);
  if (impb) return { carrier: "usps", id: impb[1] };
  if (USPS_22_RE.test(number)) return { carrier: "usps", id: number };
  return null;
}

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
/** The first plausible shipment identifier carried in a URL's query or
 *  hash params, or null. One owner, so `urlReferencesShipment` and
 *  `repairMerchantUrl` can never disagree about what a URL contains. */
function firstIdentifierParam(parsed: URL): string | null {
  const paramSources = [
    parsed.searchParams,
    new URLSearchParams(parsed.hash.replace(/^#[^?]*\??/, "")),
  ];
  for (const params of paramSources) {
    for (const [key, value] of params) {
      if (!IDENTIFIER_PARAMS.has(key.toLowerCase())) continue;
      const first = (value.split(",")[0] ?? "").trim();
      if (isPlausibleIdentifier(first)) return first;
    }
  }
  return null;
}

export function urlReferencesShipment(raw: string | null | undefined): boolean {
  const parsed = parseHttpUrl(raw);
  if (!parsed) return false;

  if (firstIdentifierParam(parsed)) return true;

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
 * prod rows are http) and rewrite USPS's dead `TrackConfirmAction*` query
 * endpoints onto the path form that actually resolves. Conservative — it
 * changes the scheme and that one known-bad family, nothing else.
 *
 * The USPS rewrite needs a number to move, so it only fires when the URL
 * carries one; otherwise the URL is left alone for `urlReferencesShipment`
 * to reject.
 */
function repairMerchantUrl(parsed: URL): string {
  const u = new URL(parsed.toString());
  u.protocol = "https:";
  if (/(^|\.)usps\.com$/i.test(u.hostname) && /TrackConfirmAction/i.test(u.pathname)) {
    const num = firstIdentifierParam(u);
    if (num) return `https://tools.usps.com/tracking/${encodeURIComponent(num)}`;
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

  // Rule 0 — the number's own format OVERRIDES the carrier match, but only
  // where the matched carrier demonstrably cannot resolve that number.
  //
  // A `420…` IMpb or a bare 22-digit USPS number is a USPS-network parcel
  // whatever the label says. `dhl` (DHL Express) resolves neither, which is
  // the reported empty page. `dhl_ecommerce` DOES resolve them — browser-
  // verified on its own webtrack host, with richer scan history than USPS
  // gives — so it is deliberately NOT overridden here.
  //
  // Narrow on purpose: an override is only justified by a template that is
  // known-wrong for this number, never by a general preference for USPS.
  // See `routeByNumberFormat` for the measured prod scale.
  const byFormat = isPlausibleIdentifier(number) ? routeByNumberFormat(number) : null;
  if (byFormat && (carrier === null || CANNOT_RESOLVE_USPS_NETWORK.has(carrier))) {
    return {
      url: TEMPLATES[byFormat.carrier](encodeURIComponent(byFormat.id)),
      source: "canonical",
      carrier: byFormat.carrier,
    };
  }

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
