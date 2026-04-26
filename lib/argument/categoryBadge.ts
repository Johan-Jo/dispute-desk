/**
 * Canonical category → UI badge mapping.
 *
 * The ONE allowed translator from `EvidenceCategory` to a merchant-facing
 * label + tone. Plan v3 §P2.6 / P2.7 — the dispute-detail UI must render
 * exactly four labels: `Strong | Moderate | Supporting | Invalid`.
 *
 * Hard rules:
 *   - `invalid` is its OWN label ("Invalid") — never collapsed into
 *     "Supporting". A row that resolved to `invalid` means the collected
 *     payload didn't meet the registry's bar; merchants must see that
 *     distinct from a context-only supporting row.
 *   - The `bg` / `color` hex pair is provided for the inline-styled pills
 *     used by the Overview "Evidence collected" block. Polaris-Badge
 *     consumers can ignore the hex pair and bind to `tone` directly.
 */

import type { EvidenceCategory } from "./canonicalEvidence";

export type { EvidenceCategory };

/** Polaris-Badge tones used by this surface. `undefined` is the neutral
 *  grey badge — used for `supporting` because Polaris does not expose a
 *  named "subdued" tone for Badge. */
export type CategoryBadgeTone = "success" | "warning" | "critical" | undefined;

export interface CategoryBadge {
  label: "Strong" | "Moderate" | "Supporting" | "Invalid";
  tone: CategoryBadgeTone;
  bg: string;
  color: string;
}

export function categoryBadge(category: EvidenceCategory): CategoryBadge {
  switch (category) {
    case "strong":
      return { label: "Strong", tone: "success", bg: "#D1FAE5", color: "#065F46" };
    case "moderate":
      return { label: "Moderate", tone: "warning", bg: "#FEF3C7", color: "#92400E" };
    case "supporting":
      return { label: "Supporting", tone: undefined, bg: "#E5E7EB", color: "#374151" };
    case "invalid":
      return { label: "Invalid", tone: "critical", bg: "#FEE2E2", color: "#991B1B" };
  }
}
