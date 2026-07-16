/**
 * Carrier identification + adapter resolution — plan §5.1.
 *
 * TWO distinct layers, so "we know this carrier but have no adapter"
 * (unsupported_carrier → product-demand signal + support notification)
 * is distinguishable from "we cannot tell what this is"
 * (unknown_carrier → metrics only):
 *
 *   1. IDENTIFICATION — deterministic table mapping trackingInfo.company
 *      strings and tracking-URL hostnames to a normalized carrier slug.
 *   2. ADAPTER RESOLUTION — which identified carriers have a registered
 *      adapter.
 *
 * `unsupported_carrier` is NOT an API failure — no request was attempted.
 */

import { dhlAdapter } from "@/lib/carriers/dhl";
import type {
  CarrierAdapter,
  CarrierDetection,
  CarrierSlug,
  TrackingEntryInfo,
} from "@/lib/carriers/types";

/** Identification table. `companyRe` runs against the trimmed company
 *  string; `hostRe` against the tracking-URL hostname. Deterministic and
 *  conservative — a miss lands in unknown_carrier (metrics only), which
 *  is cheaper than a wrong identification. */
const KNOWN_CARRIERS: Array<{
  slug: CarrierSlug;
  companyRe: RegExp;
  hostRe?: RegExp;
}> = [
  { slug: "dhl", companyRe: /(^|\b)dhl(\b|$)/i, hostRe: /(^|\.)dhl\.[a-z.]{2,6}$/i },
  { slug: "postnord", companyRe: /postnord/i, hostRe: /(^|\.)postnord\.[a-z.]{2,6}$/i },
  { slug: "fedex", companyRe: /fedex/i, hostRe: /(^|\.)fedex\.com$/i },
  { slug: "ups", companyRe: /(^|\b)ups(\b|$)/i, hostRe: /(^|\.)ups\.com$/i },
  { slug: "usps", companyRe: /(^|\b)usps(\b|$)/i, hostRe: /(^|\.)usps\.com$/i },
  { slug: "gls", companyRe: /(^|\b)gls(\b|$)/i, hostRe: /(^|\.)gls-group\.(eu|com)$/i },
  { slug: "bring", companyRe: /(^|\b)bring(\b|$)/i, hostRe: /(^|\.)bring\.(com|no|se)$/i },
  { slug: "dpd", companyRe: /(^|\b)dpd(\b|$)/i, hostRe: /(^|\.)dpd(group)?\.[a-z.]{2,6}$/i },
  { slug: "postnl", companyRe: /postnl/i, hostRe: /(^|\.)postnl\.(nl|com)$/i },
  { slug: "colissimo", companyRe: /colissimo|la poste/i, hostRe: /(^|\.)laposte\.fr$/i },
  { slug: "correos", companyRe: /correos/i, hostRe: /(^|\.)correos\.es$/i },
  { slug: "ctt", companyRe: /(^|\b)ctt(\b|$)/i, hostRe: /(^|\.)ctt\.pt$/i },
];

/** Carriers deliberately excluded from unsupported-carrier notifications
 *  (plan §7.1 rule 4). Empty today; add slugs here to mute known-benign
 *  cases without touching detection. */
const IGNORED_CARRIERS: ReadonlySet<CarrierSlug> = new Set();

/** Production adapter registry. Conditional carriers join here when real
 *  merchant demand appears (plan §9) — never speculatively. */
const ADAPTERS = new Map<CarrierSlug, CarrierAdapter>([["dhl", dhlAdapter]]);

/** Test seam: register/unregister an adapter (e.g. the fake carrier-
 *  neutrality adapter). Returns an unregister function. */
export function registerCarrierAdapter(adapter: CarrierAdapter): () => void {
  ADAPTERS.set(adapter.slug, adapter);
  return () => {
    ADAPTERS.delete(adapter.slug);
  };
}

export function getCarrierAdapter(slug: CarrierSlug): CarrierAdapter | undefined {
  return ADAPTERS.get(slug);
}

/** Layer 1: identify the carrier from company string and/or URL host. */
export function identifyCarrier(
  info: TrackingEntryInfo,
): { slug: CarrierSlug; identifiedFrom: "company" | "url" } | null {
  const company = (info.company ?? "").trim();
  if (company) {
    for (const k of KNOWN_CARRIERS) {
      if (k.companyRe.test(company)) return { slug: k.slug, identifiedFrom: "company" };
    }
  }
  const url = (info.url ?? "").trim();
  if (url) {
    let hostname: string | null = null;
    try {
      hostname = new URL(url).hostname;
    } catch {
      hostname = null;
    }
    if (hostname) {
      for (const k of KNOWN_CARRIERS) {
        if (k.hostRe?.test(hostname)) return { slug: k.slug, identifiedFrom: "url" };
      }
    }
  }
  return null;
}

/**
 * Full detection for one tracking entry — plan §5.1 outcomes:
 * matched | identifier_unresolved | unsupported_carrier | unknown_carrier
 * | no_tracking.
 */
export function detectCarrier(info: TrackingEntryInfo): CarrierDetection {
  const hasTracking =
    !!(info.number ?? "").trim() || !!(info.url ?? "").trim() || !!(info.company ?? "").trim();
  if (!hasTracking) return { outcome: "no_tracking" };

  const identified = identifyCarrier(info);
  if (!identified) return { outcome: "unknown_carrier" };
  if (IGNORED_CARRIERS.has(identified.slug)) return { outcome: "unknown_carrier" };

  const adapter = ADAPTERS.get(identified.slug);
  if (!adapter) {
    return {
      outcome: "unsupported_carrier",
      carrier: identified.slug,
      identifiedFrom: identified.identifiedFrom,
    };
  }

  const match = adapter.match(info);
  if (!match) return { outcome: "identifier_unresolved", carrier: identified.slug };
  return { outcome: "matched", carrier: identified.slug, match, adapter };
}
