/**
 * Merchant-facing status taxonomy for the dispute evidence page.
 *
 * One source of truth for every badge/tone decision, so the Evidence and
 * Overview tabs stop disagreeing with each other (a strong case headline
 * followed by red "Needs evidence" rows).
 *
 * Strict rules:
 *   - Reasoning signals use only: Strong signal / Supporting signal / Not included.
 *   - Evidence inventory uses only: Included / Recommended / Not included / Critical gap.
 *   - Red is reserved for "Critical gap" — a genuinely blocking missing item.
 *   - No additional visible states may be introduced here.
 */

export type PolarisTone = "success" | "info" | "warning" | "critical" | undefined;

/** Mandatory helper sentence under the recommendation line. */
export const EVIDENCE_EVALUATION_HELPER =
  "This case is evaluated based on the strongest available evidence. Some additional evidence is not included but is not required for a successful outcome.";

/* ─── Reasoning signals (card: "Why this case is likely to win") ────── */

export type SignalLabel = "Strong signal" | "Supporting signal" | "Not included";

export function claimSignalLabel(
  strength: "strong" | "moderate" | "weak" | "insufficient" | string | null | undefined,
): { label: SignalLabel; tone: PolarisTone } {
  if (strength === "strong") return { label: "Strong signal", tone: "success" };
  if (strength === "moderate") return { label: "Supporting signal", tone: "info" };
  // weak / insufficient / unknown → neutral, never red.
  return { label: "Not included", tone: undefined };
}

/* ─── Evidence inventory (card: "Evidence inventory" + per-row badges) ─ */

export type InventoryLabel =
  | "Included"
  | "Recommended"
  | "Not included"
  | "Critical gap";

export interface InventoryInput {
  status: "available" | "missing" | "unavailable" | "waived" | string;
  priority: "critical" | "recommended" | "optional" | string;
  blocking?: boolean;
  collectionType?: "auto" | "conditional_auto" | "manual" | "unavailable" | string;
}

export function evidenceRowStatus(
  input: InventoryInput,
): { label: InventoryLabel; tone: PolarisTone } {
  const { status, priority, blocking, collectionType } = input;

  if (status === "available" || status === "waived") {
    return { label: "Included", tone: "success" };
  }

  // System-derived items (auto / conditional_auto) that couldn't be
  // collected are not merchant-actionable — treat as "Not included"
  // rather than pushing the merchant to upload something they can't.
  const systemDerived =
    collectionType === "auto" || collectionType === "conditional_auto";

  if (status === "unavailable") {
    return { label: "Not included", tone: undefined };
  }

  // missing →
  if (priority === "critical" && (blocking || !systemDerived)) {
    return { label: "Critical gap", tone: "critical" };
  }
  if (priority === "recommended" && !systemDerived) {
    return { label: "Recommended", tone: "info" };
  }
  return { label: "Not included", tone: undefined };
}

