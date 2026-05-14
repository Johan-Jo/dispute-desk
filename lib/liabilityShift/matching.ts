/**
 * Field-level matching primitives for CE 3.0 qualification.
 *
 * Each matcher returns a strength signal so the orchestrator can tell
 * "exact match" from "normalized fallback" and surface the difference
 * in confidence_reasons. Per Visa CE 3.0 guidance + acquirer-side
 * enforcement patterns (cside.com 2025-12):
 *   - shipping: most acquirers want exact match; normalized is a
 *     lower-confidence fallback
 *   - IP: ISP/subnet-level match is acceptable to most issuers; exact
 *     IP is stronger
 *   - device: deterministic fingerprints only — opportunistic third-party
 *     fingerprints can be discounted by the issuer
 *   - account ID: clear text, single value, cardholder-recognizable
 */

import type {
  MatchPoint,
  ShippingAddressShape,
  QualificationOrder,
} from "./types";

export type MatchStrength = "exact" | "normalized" | "subnet" | "none";

export interface FieldMatch {
  matched: boolean;
  strength: MatchStrength;
  /** Machine code surfaced into confidence_reasons. */
  reasonCode: string | null;
}

/* ── IP ── */

/**
 * Normalize an IP. Strips zero-padding from IPv4 octets, lowercases IPv6.
 * Returns null when the input doesn't parse as an IP.
 */
export function normalizeIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // IPv4 — strict 4-octet, no leading zeros surviving normalization.
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(trimmed);
  if (ipv4) {
    const octets = ipv4.slice(1, 5).map(Number);
    if (octets.every((o) => o >= 0 && o <= 255)) {
      return octets.join(".");
    }
    return null;
  }

  // IPv6 — basic shape, lowercase. We're not collapsing :: forms; exact
  // and subnet matchers handle that.
  if (/^[0-9a-fA-F:]+$/.test(trimmed) && trimmed.includes(":")) {
    return trimmed.toLowerCase();
  }

  return null;
}

/** IPv4 /24 subnet — first three octets. */
function ipv4Subnet(ip: string): string | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  return parts.slice(0, 3).join(".");
}

export function matchIp(a: string | null | undefined, b: string | null | undefined): FieldMatch {
  const na = normalizeIp(a);
  const nb = normalizeIp(b);
  if (!na || !nb) {
    return { matched: false, strength: "none", reasonCode: null };
  }
  if (na === nb) {
    return { matched: true, strength: "exact", reasonCode: null };
  }
  // IPv4 /24 fallback — acceptable to most issuers per Visa guidance,
  // weaker than exact. Not applied to IPv6 (subnet semantics differ).
  const subA = ipv4Subnet(na);
  const subB = ipv4Subnet(nb);
  if (subA && subB && subA === subB) {
    return {
      matched: true,
      strength: "subnet",
      reasonCode: "ip_match:subnet_only",
    };
  }
  return { matched: false, strength: "none", reasonCode: null };
}

/* ── Device fingerprint ── */

/**
 * Device fingerprints come from LSE-4. v1 expects deterministic hashes —
 * any cleartext or empty value is rejected to avoid matching on
 * opportunistic browser-API readings.
 */
export function matchDevice(
  a: string | null | undefined,
  b: string | null | undefined,
): FieldMatch {
  const na = (a ?? "").trim().toLowerCase();
  const nb = (b ?? "").trim().toLowerCase();
  if (!na || !nb) return { matched: false, strength: "none", reasonCode: null };
  // Reject short / suspicious values — fingerprints from LSE-4 are
  // expected to be sha256 / 64-hex-char.
  if (na.length < 16 || nb.length < 16) {
    return {
      matched: false,
      strength: "none",
      reasonCode: "device_match:fingerprint_too_short",
    };
  }
  return na === nb
    ? { matched: true, strength: "exact", reasonCode: null }
    : { matched: false, strength: "none", reasonCode: null };
}

/* ── Shipping address ── */

const STREET_SUFFIX_MAP: Record<string, string> = {
  st: "street", street: "street",
  rd: "road", road: "road",
  ave: "avenue", av: "avenue", avenue: "avenue",
  blvd: "boulevard", boulevard: "boulevard",
  dr: "drive", drive: "drive",
  ln: "lane", lane: "lane",
  ct: "court", court: "court",
  pl: "place", place: "place",
  pkwy: "parkway", parkway: "parkway",
  hwy: "highway", highway: "highway",
  ter: "terrace", terrace: "terrace",
  way: "way",
};

const DIRECTIONAL_MAP: Record<string, string> = {
  n: "north", north: "north",
  s: "south", south: "south",
  e: "east", east: "east",
  w: "west", west: "west",
  ne: "northeast", northeast: "northeast",
  nw: "northwest", northwest: "northwest",
  se: "southeast", southeast: "southeast",
  sw: "southwest", southwest: "southwest",
};

function normalizeAddressLine(line: string | null | undefined): string {
  if (!line) return "";
  const tokens = line
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  return tokens
    .map((t) => DIRECTIONAL_MAP[t] ?? STREET_SUFFIX_MAP[t] ?? t)
    .join(" ");
}

function exactKey(addr: ShippingAddressShape): string {
  return [
    addr.address1?.trim().toLowerCase() ?? "",
    addr.address2?.trim().toLowerCase() ?? "",
    addr.city?.trim().toLowerCase() ?? "",
    (addr.provinceCode ?? addr.province ?? "").trim().toLowerCase(),
    addr.zip?.trim().toLowerCase() ?? "",
    (addr.countryCode ?? addr.country ?? "").trim().toLowerCase(),
  ].join("|");
}

function normalizedKey(addr: ShippingAddressShape): string {
  return [
    normalizeAddressLine(addr.address1),
    normalizeAddressLine(addr.address2),
    (addr.city ?? "").toLowerCase().trim(),
    (addr.provinceCode ?? addr.province ?? "").toLowerCase().trim(),
    // ZIP — strip everything after the first 5 digits for US (handle ZIP+4).
    (addr.zip ?? "").replace(/[^a-z0-9]/gi, "").slice(0, 5).toLowerCase(),
    (addr.countryCode ?? addr.country ?? "").toLowerCase().trim(),
  ].join("|");
}

export function matchShippingAddress(
  a: ShippingAddressShape | null,
  b: ShippingAddressShape | null,
): FieldMatch {
  if (!a || !b) return { matched: false, strength: "none", reasonCode: null };
  if (!a.address1 || !b.address1) {
    return { matched: false, strength: "none", reasonCode: null };
  }
  // Country mismatch — never a match regardless of normalization.
  const ca = (a.countryCode ?? a.country ?? "").toLowerCase().trim();
  const cb = (b.countryCode ?? b.country ?? "").toLowerCase().trim();
  if (ca && cb && ca !== cb) {
    return { matched: false, strength: "none", reasonCode: null };
  }
  if (exactKey(a) === exactKey(b)) {
    return { matched: true, strength: "exact", reasonCode: null };
  }
  if (normalizedKey(a) === normalizedKey(b)) {
    return {
      matched: true,
      strength: "normalized",
      reasonCode: "shipping_match:normalized_only",
    };
  }
  return { matched: false, strength: "none", reasonCode: null };
}

/* ── Account ID ── */

export function matchAccountId(
  a: string | null | undefined,
  b: string | null | undefined,
): FieldMatch {
  const na = (a ?? "").trim().toLowerCase();
  const nb = (b ?? "").trim().toLowerCase();
  if (!na || !nb) return { matched: false, strength: "none", reasonCode: null };
  return na === nb
    ? { matched: true, strength: "exact", reasonCode: null }
    : { matched: false, strength: "none", reasonCode: null };
}

/* ── Email (used in guest-checkout matching when no account ID exists) ── */

export function matchEmail(
  a: string | null | undefined,
  b: string | null | undefined,
): FieldMatch {
  const na = (a ?? "").trim().toLowerCase();
  const nb = (b ?? "").trim().toLowerCase();
  if (!na || !nb) return { matched: false, strength: "none", reasonCode: null };
  return na === nb
    ? { matched: true, strength: "exact", reasonCode: null }
    : { matched: false, strength: "none", reasonCode: null };
}

/* ── Aggregate matching ── */

export interface MatchResult {
  points: MatchPoint[];
  hasAnchor: boolean;
  /** Strength per matched point, surfaced in confidence_reasons. */
  reasonCodes: string[];
}

/**
 * Match disputed order against a set of priors. A point counts when
 * the disputed value equals the same point across at least N priors
 * (default N=1, since the standard branch already requires ≥2 priors
 * by construction — see qualifyCE30.ts).
 */
export function computeMatchPoints(
  disputed: QualificationOrder,
  priors: QualificationOrder[],
  opts?: { requireMatchesInPriors?: number },
): MatchResult {
  const required = opts?.requireMatchesInPriors ?? 1;
  const points: MatchPoint[] = [];
  const reasonCodes: string[] = [];

  const countMatchingPriors = (
    matcher: (p: QualificationOrder) => FieldMatch,
  ): { matches: number; bestReason: string | null } => {
    let matches = 0;
    let bestReason: string | null = null;
    for (const p of priors) {
      const m = matcher(p);
      if (m.matched) {
        matches += 1;
        if (m.reasonCode && !bestReason) {
          bestReason = m.reasonCode;
        }
      }
    }
    return { matches, bestReason };
  };

  // IP
  const ipResult = countMatchingPriors((p) => matchIp(disputed.ipAddress, p.ipAddress));
  if (ipResult.matches >= required) {
    points.push("ip");
    if (ipResult.bestReason) reasonCodes.push(ipResult.bestReason);
  }

  // Device
  const deviceResult = countMatchingPriors((p) =>
    matchDevice(disputed.deviceFingerprint, p.deviceFingerprint),
  );
  if (deviceResult.matches >= required) {
    points.push("device");
    if (deviceResult.bestReason) reasonCodes.push(deviceResult.bestReason);
  }

  // Shipping
  const shippingResult = countMatchingPriors((p) =>
    matchShippingAddress(disputed.shippingAddress, p.shippingAddress),
  );
  if (shippingResult.matches >= required) {
    points.push("shipping");
    if (shippingResult.bestReason) reasonCodes.push(shippingResult.bestReason);
  }

  // Account (or email fallback for guest checkout)
  const accountResult = countMatchingPriors((p) => {
    if (disputed.customerId && p.customerId) {
      return matchAccountId(disputed.customerId, p.customerId);
    }
    return matchEmail(disputed.customerEmail, p.customerEmail);
  });
  if (accountResult.matches >= required) {
    points.push("account");
    if (accountResult.bestReason) reasonCodes.push(accountResult.bestReason);
  }

  const hasAnchor = points.includes("ip") || points.includes("device");

  return { points, hasAnchor, reasonCodes };
}
