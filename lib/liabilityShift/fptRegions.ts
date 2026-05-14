/**
 * Mastercard First-Party Trust regional availability.
 *
 * Source: Mastercard FPT announcements + LSE-3 epic.
 *   - US pilot: 2023
 *   - US full availability: 2024-10-01
 *   - Global (Canada, LATAM, Caribbean, APAC): 2025-06-01
 *   - EU: not yet (TBD)
 *
 * The "since" date below is the earliest dispute date for which FPT is
 * available in that region. Date is compared against the disputed
 * transaction's created_at, not the dispute's filed-at.
 */

import type { ISO3166CountryCode } from "./types";

interface RegionEntry {
  countryCode: ISO3166CountryCode;
  /** YYYY-MM-DD — the earliest disputed-transaction date for which FPT applies. */
  since: string;
}

const FPT_REGIONS: RegionEntry[] = [
  // US — full availability since 2024-10.
  { countryCode: "US", since: "2024-10-01" },
  // Global rollout 2025-06.
  { countryCode: "CA", since: "2025-06-01" }, // Canada
  { countryCode: "BR", since: "2025-06-01" }, // Brazil (LATAM)
  { countryCode: "MX", since: "2025-06-01" },
  { countryCode: "AR", since: "2025-06-01" },
  { countryCode: "CL", since: "2025-06-01" },
  { countryCode: "CO", since: "2025-06-01" },
  { countryCode: "PE", since: "2025-06-01" },
  { countryCode: "UY", since: "2025-06-01" },
  { countryCode: "EC", since: "2025-06-01" },
  // Caribbean (subset).
  { countryCode: "DO", since: "2025-06-01" }, // Dominican Republic
  { countryCode: "JM", since: "2025-06-01" },
  { countryCode: "TT", since: "2025-06-01" },
  { countryCode: "BB", since: "2025-06-01" },
  // APAC (subset).
  { countryCode: "AU", since: "2025-06-01" },
  { countryCode: "NZ", since: "2025-06-01" },
  { countryCode: "SG", since: "2025-06-01" },
  { countryCode: "HK", since: "2025-06-01" },
  { countryCode: "JP", since: "2025-06-01" },
  { countryCode: "KR", since: "2025-06-01" },
  { countryCode: "PH", since: "2025-06-01" },
  { countryCode: "MY", since: "2025-06-01" },
  { countryCode: "TH", since: "2025-06-01" },
  { countryCode: "ID", since: "2025-06-01" },
  { countryCode: "VN", since: "2025-06-01" },
  { countryCode: "IN", since: "2025-06-01" },
];

const BY_CODE: Map<ISO3166CountryCode, RegionEntry> = new Map(
  FPT_REGIONS.map((r) => [r.countryCode, r]),
);

export function isFPTRegion(
  countryCode: string | null | undefined,
  disputedTransactionAt: string,
): { eligible: boolean; reason: string } {
  if (!countryCode) {
    return { eligible: false, reason: "missing_region" };
  }
  const upper = countryCode.toUpperCase() as ISO3166CountryCode;
  const entry = BY_CODE.get(upper);
  if (!entry) {
    return { eligible: false, reason: `region_not_yet_available:${upper}` };
  }
  const disputed = new Date(disputedTransactionAt).getTime();
  const since = new Date(`${entry.since}T00:00:00Z`).getTime();
  if (!Number.isFinite(disputed) || !Number.isFinite(since)) {
    return { eligible: false, reason: "invalid_dates" };
  }
  if (disputed < since) {
    return {
      eligible: false,
      reason: `region_pre_launch:${upper}:before:${entry.since}`,
    };
  }
  return { eligible: true, reason: `region_eligible:${upper}` };
}

export function fptRegionList(): RegionEntry[] {
  return [...FPT_REGIONS];
}
