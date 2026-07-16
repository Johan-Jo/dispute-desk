/**
 * Safe tracking-URL parsing — plan §5.3.
 *
 * PARSE-ONLY. This module never makes an HTTP request to a
 * merchant-provided tracking URL; it extracts an identifier and nothing
 * else. The URL is untrusted data end-to-end: malformed input, malicious
 * hosts, and injection attempts must degrade to "no extraction", never
 * throw and never yield an identifier from a non-allowlisted host.
 */

/** Hostname must be dhl.<tld> or a subdomain of it (dhl.com, www.dhl.com,
 *  activetracing.dhl.com, dhl.de, dhl.se, dhl.co.uk, …). An arbitrary
 *  external host (notdhl.com, dhl.example.com) must never match —
 *  otherwise a crafted URL could inject a foreign identifier. */
const DHL_HOST_RE = /(^|\.)dhl\.(com|de|se|no|dk|fi|nl|fr|es|it|pt|pl|at|ch|be|co\.uk)$/i;

/** Query parameter names DHL uses for the real shipment id on Freight
 *  tracking links. Compared case-insensitively. */
const DHL_TRACKING_PARAMS = new Set(["tracking-id", "trackingid", "tracking_id"]);

export function isDhlHost(hostname: string): boolean {
  return DHL_HOST_RE.test(hostname);
}

/**
 * Extract DHL tracking-id candidates from a tracking URL.
 *
 * Returns the DISTINCT candidate ids (trimmed, decoded). Callers treat:
 *  - `[]`  → nothing extractable (unsupported host, malformed URL, no param)
 *  - `[x]` → the effective identifier
 *  - more  → conflicting repeated params — ambiguous, do NOT pick one.
 */
export function extractDhlTrackingIds(url: string | null | undefined): string[] {
  if (!url) return [];
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return [];
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return [];
  if (!isDhlHost(parsed.hostname)) return [];

  const ids = new Set<string>();
  // URLSearchParams handles percent-decoding, repeated params, and
  // fragments (excluded from search) for us.
  for (const [key, value] of parsed.searchParams.entries()) {
    if (!DHL_TRACKING_PARAMS.has(key.toLowerCase())) continue;
    const v = value.trim();
    // Identifier sanity: digits/letters/dashes only, bounded length —
    // rejects injection payloads and free text.
    if (v.length >= 4 && v.length <= 64 && /^[A-Za-z0-9-]+$/.test(v)) {
      ids.add(v);
    }
  }
  return [...ids];
}
