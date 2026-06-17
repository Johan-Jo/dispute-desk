/**
 * Competitor registry for the `/compare/<competitor>-alternative` SEO + paid-ad
 * landing pages (see `app/[locale]/compare`).
 *
 * This module holds only **language-neutral** data: competitor ids, URL slugs,
 * ordering, the pricing model, and the (USD) savings numbers shown in the
 * "bottom line" knockout and the cost-as-you-grow chart. All user-facing prose
 * (names, bullets, table values, FAQs) lives in the `compare` i18n namespace
 * (`messages/<locale>.json`) so it is translated across every locale.
 *
 * Source design: Claude Design "Competitor Alternative.dc.html" — the numbers
 * mirror that prototype's `priceMap` / `pctMap`. Figures are illustrative for a
 * ~$100K/mo store with ~$6,000/mo in chargebacks (footnoted on the page).
 */

export type CompareModel = "fee" | "prevention";

export interface Competitor {
  /** Stable id — also the i18n key under `compare.competitors.<id>`. */
  id: string;
  /** URL slug: `/compare/<slug>`. */
  slug: string;
  /** Pricing model — drives the knockout copy and chart framing. */
  model: CompareModel;
  /**
   * Fee share of recovered funds (e.g. 0.25 = 25%). For prevention tools this
   * is the share of recovered revenue refunded away (1 = full amount), used to
   * scale the chart bars.
   */
  feePct: number;
  /** Their monthly cost at the reference scenario, formatted (e.g. "$1,500"). */
  themCost: string;
  /** The hero savings figure (e.g. "$16,452" saved/yr, or "$6,000" kept/mo). */
  saveBig: string;
  /** Monthly saving for fee tools (e.g. "$1,371"); null for prevention tools. */
  perMo: string | null;
}

/** Reference scenario constants (kept in sync with the price footnote copy). */
export const COMPARE_SCENARIO = {
  /** DisputeDesk Growth plan price, flat at any volume. */
  usCost: "$129",
  /** Chart tiers: recovered revenue and the matching flat DisputeDesk price. */
  tiers: [
    { label: "$2K", recovered: 2000, us: 29 },
    { label: "$6K", recovered: 6000, us: 129 },
    { label: "$18K", recovered: 18000, us: 299 },
  ],
} as const;

/**
 * Ordered competitor list. Order also drives the hub grid and sitemap. The
 * first five are the original flagship pages; the rest are tier-2 vendors.
 */
export const COMPETITORS: readonly Competitor[] = [
  { id: "chargeflow", slug: "chargeflow-alternative", model: "fee", feePct: 0.25, themCost: "$1,500", saveBig: "$16,452", perMo: "$1,371" },
  { id: "disputifier", slug: "disputifier-alternative", model: "fee", feePct: 0.2, themCost: "$1,200", saveBig: "$12,852", perMo: "$1,071" },
  { id: "chargeback-io", slug: "chargeback-io-alternative", model: "prevention", feePct: 1, themCost: "~$6,000", saveBig: "$6,000", perMo: null },
  { id: "chargeback-dispute-specialist", slug: "chargeback-dispute-specialist-alternative", model: "fee", feePct: 0.3, themCost: "$1,800", saveBig: "$20,052", perMo: "$1,671" },
  { id: "disputer", slug: "disputer-by-safe-app-alternative", model: "fee", feePct: 0.25, themCost: "$1,500", saveBig: "$16,452", perMo: "$1,371" },
  { id: "justt", slug: "justt-alternative", model: "fee", feePct: 0.25, themCost: "$1,500", saveBig: "$16,452", perMo: "$1,371" },
  { id: "chargebacks911", slug: "chargebacks911-alternative", model: "fee", feePct: 0.25, themCost: "$1,500", saveBig: "$16,452", perMo: "$1,371" },
  { id: "chargeback-gurus", slug: "chargeback-gurus-alternative", model: "fee", feePct: 0.25, themCost: "$1,500", saveBig: "$16,452", perMo: "$1,371" },
  { id: "chargeblast", slug: "chargeblast-alternative", model: "prevention", feePct: 1, themCost: "~$6,000", saveBig: "$6,000", perMo: null },
  { id: "midigator", slug: "midigator-alternative", model: "fee", feePct: 0.2, themCost: "$1,200", saveBig: "$12,852", perMo: "$1,071" },
  { id: "riskified", slug: "riskified-alternative", model: "fee", feePct: 0.2, themCost: "$1,200", saveBig: "$12,852", perMo: "$1,071" },
];

const BY_SLUG = new Map(COMPETITORS.map((c) => [c.slug, c]));
const BY_ID = new Map(COMPETITORS.map((c) => [c.id, c]));

export function getCompetitorBySlug(slug: string): Competitor | undefined {
  return BY_SLUG.get(slug);
}

export function getCompetitorById(id: string): Competitor | undefined {
  return BY_ID.get(id);
}

export const COMPETITOR_SLUGS: readonly string[] = COMPETITORS.map((c) => c.slug);

/** Comparison-table row keys, in display order (labels live in i18n). */
export const COMPARE_TABLE_ROWS = [
  "shopify",
  "focus",
  "pricing",
  "best",
  "evidence",
  "alerts",
  "control",
  "free",
] as const;

export type CompareTableRow = (typeof COMPARE_TABLE_ROWS)[number];

/** Chart bar heights (px) for a competitor, derived from `feePct`. */
export function compareChartTiers(competitor: Competitor): Array<{
  label: string;
  them: string;
  us: string;
  themH: number;
  usH: number;
}> {
  const scaleMax = 18000 * competitor.feePct;
  return COMPARE_SCENARIO.tiers.map((tier) => {
    const them = Math.round(tier.recovered * competitor.feePct);
    return {
      label: tier.label,
      them: "$" + them.toLocaleString("en-US"),
      us: "$" + tier.us,
      themH: Math.max(10, Math.round((them / scaleMax) * 150)),
      usH: Math.max(8, Math.round((tier.us / scaleMax) * 150)),
    };
  });
}
