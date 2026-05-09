import type { SignalAnalysisOutput } from "./schema";

type Category = SignalAnalysisOutput["category"];

/**
 * Plain-English labels for the classifier's category enum. Surfaced
 * everywhere a category is shown to operators — instead of the raw
 * `transparency_frustration` ML label, the dashboard says "Lost trust in
 * their tool". This is a UI-only rename; the DB and classifier still use
 * the canonical enum.
 */
const LABELS: Record<Category, string> = {
  migration_intent: "Looking for new chargeback tools",
  transparency_frustration: "Lost trust in their tool",
  operational_overload: "Drowning in chargebacks",
  reserve_fear: "Reserve & payout pain",
  evidence_confusion: "Confused about evidence",
  support_failure: "Bad support experience",
  competitor_frustration: "Competitor frustration",
  general_discussion: "General discussion",
  spam: "Spam",
  trolling: "Trolling",
};

/** Categories filtered out of every user-facing surface (never useful). */
export const HIDDEN_CATEGORIES: Category[] = ["spam", "trolling"];

export function categoryLabel(category: string): string {
  if (category in LABELS) return LABELS[category as Category];
  return category;
}

export function isHiddenCategory(category: string): boolean {
  return HIDDEN_CATEGORIES.includes(category as Category);
}

/** Compact accent color per category; reused across stream UI. */
const ACCENTS: Partial<Record<Category, string>> = {
  migration_intent: "#7C3AED",
  transparency_frustration: "#DC2626",
  reserve_fear: "#EA580C",
  competitor_frustration: "#D97706",
  evidence_confusion: "#2563EB",
  operational_overload: "#0891B2",
  support_failure: "#0EA5E9",
};

export function categoryAccent(category: string): string {
  return ACCENTS[category as Category] ?? "#475569";
}
