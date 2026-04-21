/**
 * IP & Location Check collector.
 *
 * Replaces the old raw "Customer Purchase IP" section from paymentSource.ts.
 * Reads ctx.order.clientIp + ctx.order.shippingAddress, enriches the IP via
 * IPinfo, computes location match / IP consistency / risk level / field
 * score, and generates merchant-facing copy plus a BANK-GATED paragraph.
 *
 * Field key: `ip_location_check`. Section label: "IP & Location Check".
 * Renamed from `device_location_consistency` on 2026-04-21 — the data
 * shape is unchanged but the surfaced text is now bank-grade and split
 * cleanly from the future "Device & Session Consistency" row.
 *
 * The bank paragraph is populated ONLY when all three positive conditions
 * hold (same_city or same_country, no privacy flags, consistent or
 * first_seen). Non-positive or missing signals surface in the merchant UI
 * but never reach Shopify in detail — that gating plus the neutral
 * fallbacks live in lib/shopify/formatEvidenceForShopify.ts.
 */

import { getServiceClient } from "@/lib/supabase/server";
import type { EvidenceSection, BuildContext } from "../types";
import { fetchIpinfo, type IpinfoResponse, type IpinfoPrivacy } from "@/lib/enrichment/ipinfo";

export type LocationMatch = "same_city" | "same_country" | "different_country" | "unknown";
export type IpConsistencyLevel = "first_seen" | "consistent" | "variable";
export type RiskLevel = "low" | "medium" | "high";
export type DeviceLocationScore = "Strong" | "Moderate" | "Weak" | "Missing";

export interface DeviceLocationData {
  [key: string]: unknown;
  ip: string;
  source: "order_client_ip";
  ipinfo: IpinfoResponse | null;
  shippingAddress: { city: string | null; region: string | null; country: string | null } | null;
  locationMatch: LocationMatch;
  distanceKm: number | null;
  ipReuseCount: number;
  ipConsistencyLevel: IpConsistencyLevel;
  riskLevel: RiskLevel;
  score: DeviceLocationScore;
  summary: string;
  merchantGuidance: string | null;
  bankEligible: boolean;
  bankParagraph: string | null;
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  Pure helpers — exported for testing                                 */
/* ═══════════════════════════════════════════════════════════════════ */

function normalize(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

export function computeLocationMatch(
  ipinfo: IpinfoResponse | null,
  shipping: { city: string | null; countryCode: string | null } | null,
): LocationMatch {
  if (!ipinfo || !shipping) return "unknown";
  const ipCountry = normalize(ipinfo.country);
  const shipCountry = normalize(shipping.countryCode);
  if (!ipCountry || !shipCountry) return "unknown";

  if (ipCountry !== shipCountry) return "different_country";

  const ipCity = normalize(ipinfo.city);
  const shipCity = normalize(shipping.city);
  if (ipCity && shipCity && ipCity === shipCity) return "same_city";
  return "same_country";
}

export function computeRiskLevel(privacy: IpinfoPrivacy): RiskLevel {
  if (privacy.vpn || privacy.proxy) return "high";
  if (privacy.hosting) return "medium";
  return "low";
}

export function computeIpConsistencyLevel(matches: number, priorTotal: number): IpConsistencyLevel {
  if (priorTotal === 0) return "first_seen";
  if (matches === 0) return "first_seen";
  return matches / priorTotal >= 0.5 ? "consistent" : "variable";
}

export function computeScore(
  match: LocationMatch,
  privacy: IpinfoPrivacy,
  consistency: IpConsistencyLevel,
): DeviceLocationScore {
  const anyFlag = privacy.vpn || privacy.proxy || privacy.hosting;

  if (match === "unknown") return "Missing";

  // Mismatch cases
  if (match === "different_country") {
    if (anyFlag) return "Weak";
    return consistency === "consistent" ? "Moderate" : "Weak";
  }

  // Any privacy flag caps at Moderate (per user spec)
  if (anyFlag) return "Moderate";

  // same_city clean
  if (match === "same_city") {
    return consistency === "variable" ? "Moderate" : "Strong";
  }

  // same_country clean → Moderate regardless of consistency
  return "Moderate";
}

export function computeBankEligible(
  match: LocationMatch,
  privacy: IpinfoPrivacy,
  consistency: IpConsistencyLevel,
): boolean {
  if (match !== "same_city" && match !== "same_country") return false;
  if (privacy.vpn || privacy.proxy || privacy.hosting) return false;
  if (consistency === "variable") return false;
  return true;
}

/**
 * Build the merchant-facing line(s) for the IP & Location Check row.
 * Returns up to two lines: a primary verdict + an optional reliability note.
 *
 * Never includes raw IP, org/ASN, coordinates, or city-name specifics.
 * `consistency === "variable"` is intentionally NOT exposed here — that
 * downgrade lives on the separate "Customer History" row.
 */
export function generateSummary(
  ipinfo: IpinfoResponse | null,
  _shipping: { country: string | null } | null,
  match: LocationMatch,
  privacy: IpinfoPrivacy,
  consistency: IpConsistencyLevel,
): string {
  if (!ipinfo) return "";
  const anyFlag = privacy.vpn || privacy.proxy || privacy.hosting;

  // Primary verdict
  let primary: string;
  if (match === "different_country") {
    primary = "Purchase location differs from billing country.";
  } else if (match === "same_city" || match === "same_country") {
    primary =
      consistency === "consistent"
        ? "Location matches billing country and prior customer activity."
        : "Location matches billing country.";
  } else {
    return "";
  }

  // Optional second line for reliability concerns
  if (anyFlag) {
    return `${primary}\nVPN or proxy detected — location reliability reduced.`;
  }
  return primary;
}

export function generateMerchantGuidance(
  match: LocationMatch,
  privacy: IpinfoPrivacy,
  consistency: IpConsistencyLevel,
  ipinfo: IpinfoResponse | null,
): string | null {
  if (!ipinfo) {
    return "This is optional evidence — the case isn't weaker without it. Focus on billing match and AVS/CVV results instead.";
  }

  const lines: string[] = [];
  if (match === "different_country") {
    lines.push(
      "Location mismatch — IP origin differs from shipping address. This weakens fraud defense. Lean on billing-address match and customer tenure to anchor the case.",
    );
  }
  if (privacy.vpn || privacy.proxy || privacy.hosting) {
    lines.push(
      "The IP routes through a VPN, proxy, or data-center. Treat its geolocation as a weak signal. Other evidence (AVS/CVV, customer tenure) carries more weight here.",
    );
  }
  if (consistency === "variable") {
    lines.push(
      "The customer has used multiple IP addresses across orders, which reduces consistency of the activity pattern.",
    );
  }

  if (lines.length === 0) return null;
  return lines.join("\n\n");
}

/**
 * Bank-style sentence (rule 5G) submitted to Shopify when the signal is
 * positive. Caller gates on bankEligible; non-positive cases get one of
 * the two neutral fallback constants in formatEvidenceForShopify.ts and
 * never see this generator.
 *
 * Deliberately vague — no city, no country, no IP, no org/ASN, no
 * coordinates. Bank receives a single neutral-positive statement.
 */
export function generateBankParagraph(
  ipinfo: IpinfoResponse | null,
  _ipReuseCount: number,
  _consistency: IpConsistencyLevel,
  _match: LocationMatch,
  _shipping: { country: string | null } | null,
): string | null {
  if (!ipinfo) return null;
  return "The purchase originated from a location consistent with the customer's billing details and prior activity.";
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  DB: IP consistency lookup                                            */
/* ═══════════════════════════════════════════════════════════════════ */

interface ConsistencyResult {
  ipReuseCount: number;
  ipConsistencyLevel: IpConsistencyLevel;
}

async function fetchConsistency(
  shopId: string,
  customerKey: string | null,
  currentIp: string,
  currentPackId: string,
): Promise<ConsistencyResult> {
  // First order for a customer (no identifier) → first_seen by definition.
  if (!customerKey) {
    return { ipReuseCount: 0, ipConsistencyLevel: "first_seen" };
  }

  const sb = getServiceClient();

  // Query evidence_items joined to packs → disputes for the same customer.
  // Count prior packs (total) and prior packs with a matching IP.
  // We match on both the new label ("Device & Location Consistency") and the
  // historical one ("Customer Purchase IP") so prior rows still count.
  const { data: rows, error } = await sb
    .from("evidence_items")
    .select("payload, pack_id, evidence_packs!inner(id, disputes!inner(shop_id, customer_email, customer_display_name))")
    .in("label", ["IP & Location Check", "Device & Location Consistency", "Customer Purchase IP"])
    .eq("evidence_packs.disputes.shop_id", shopId)
    .neq("pack_id", currentPackId);

  if (error || !rows) {
    console.warn(
      `[deviceLocation] consistency query failed: ${error?.message ?? "no data"} — treating as first_seen`,
    );
    return { ipReuseCount: 0, ipConsistencyLevel: "first_seen" };
  }

  const key = customerKey.trim().toLowerCase();
  let priorTotal = 0;
  let matches = 0;
  const seenPackIds = new Set<string>();
  for (const r of rows) {
    const pid = (r as { pack_id: string }).pack_id;
    if (seenPackIds.has(pid)) continue; // dedupe in case a pack has both old+new labels
    seenPackIds.add(pid);

    const disputes = ((r as { evidence_packs?: { disputes?: { customer_email?: string | null; customer_display_name?: string | null } } }).evidence_packs?.disputes) ?? null;
    const rowKey = normalize(disputes?.customer_email ?? disputes?.customer_display_name ?? "");
    if (rowKey !== key) continue;

    priorTotal++;
    const ip = (r as { payload?: { ip?: string } | null }).payload?.ip;
    if (ip === currentIp) matches++;
  }

  return {
    ipReuseCount: matches,
    ipConsistencyLevel: computeIpConsistencyLevel(matches, priorTotal),
  };
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  Main collector                                                        */
/* ═══════════════════════════════════════════════════════════════════ */

export async function collectDeviceLocationEvidence(
  ctx: BuildContext,
): Promise<EvidenceSection[]> {
  const order = ctx.order;
  const ip = order?.clientIp ?? null;

  // No IP → return empty; "Missing" fallback in Shopify formatter handles it.
  if (!ip) return [];

  const ipinfo = await fetchIpinfo(ip, process.env.IPINFO_API_KEY);

  const shipping = order?.shippingAddress ?? null;
  const shippingForMatch = shipping
    ? { city: shipping.city, countryCode: shipping.countryCode }
    : null;

  const locationMatch = computeLocationMatch(ipinfo, shippingForMatch);
  const privacy = ipinfo?.privacy ?? { vpn: false, proxy: false, hosting: false };
  const riskLevel = computeRiskLevel(privacy);

  // Pull customer key + reuse count (dev read-only)
  let customerKey: string | null = null;
  try {
    const sb = getServiceClient();
    const { data: dispute } = await sb
      .from("disputes")
      .select("customer_email, customer_display_name")
      .eq("id", ctx.disputeId)
      .maybeSingle();
    customerKey = dispute?.customer_email ?? dispute?.customer_display_name ?? null;
  } catch (err) {
    console.warn(
      `[deviceLocation] dispute lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const { ipReuseCount, ipConsistencyLevel } = await fetchConsistency(
    ctx.shopId,
    customerKey,
    ip,
    ctx.packId,
  );

  const score: DeviceLocationScore = ipinfo
    ? computeScore(locationMatch, privacy, ipConsistencyLevel)
    : "Missing";

  const bankEligible = Boolean(ipinfo) && computeBankEligible(locationMatch, privacy, ipConsistencyLevel);

  const shippingForCopy = shipping
    ? { country: shipping.countryCode }
    : null;

  const summary = generateSummary(ipinfo, shippingForCopy, locationMatch, privacy, ipConsistencyLevel);
  const merchantGuidance = generateMerchantGuidance(locationMatch, privacy, ipConsistencyLevel, ipinfo);
  const bankParagraph = bankEligible
    ? generateBankParagraph(ipinfo, ipReuseCount, ipConsistencyLevel, locationMatch, shippingForCopy)
    : null;

  const data: DeviceLocationData = {
    ip,
    source: "order_client_ip",
    ipinfo,
    shippingAddress: shipping
      ? {
          city: shipping.city ?? null,
          region: shipping.provinceCode ?? null,
          country: shipping.countryCode ?? null,
        }
      : null,
    locationMatch,
    distanceKm: null, // no geocoding in this phase
    ipReuseCount,
    ipConsistencyLevel,
    riskLevel,
    score,
    summary,
    merchantGuidance,
    bankEligible,
    bankParagraph,
  };

  return [
    {
      type: "other",
      label: "IP & Location Check",
      source: ipinfo ? "ipinfo_io" : "order_client_ip",
      fieldsProvided: ["ip_location_check"],
      data,
    },
  ];
}
