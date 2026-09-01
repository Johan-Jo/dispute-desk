/**
 * Human labels for the post-outcome taxonomy.
 *
 * ── Why this exists ──
 *
 * The admin surface rendered raw enum constants. A reviewer opening a dispute
 * saw the string `UNSUPPORTED_OR_OVERSTATED_ASSERTION` sitting in a metric box
 * labelled "Observed gap", with nothing telling them what it meant or whether
 * it mattered. Four render sites did this independently, so this module is the
 * single owner: every surface reads from here, and a new taxonomy member that
 * forgets its label is a TYPE ERROR rather than a screaming constant leaking
 * into the UI (the `Record<Category, …>` below is exhaustive on purpose).
 *
 * Each category carries three things, because a reviewer needs all three and
 * the enum name supplies none of them:
 *
 *   label   what to call it in a table cell
 *   meaning what the analyser actually observed, in one sentence
 *   soWhat  why it is worth a reviewer's attention — or explicitly why it is not
 *
 * These are admin-only strings. `lib/**` normally emits `I18nToken`s and never
 * English (CLAUDE.md §5), but that rule governs MERCHANT-facing copy: the
 * internal admin console is English-only and has no locale. Nothing here may be
 * rendered on a merchant surface.
 */

import type {
  ActionClass,
  ConfidenceLevel,
  FindingCategory,
  ReviewState,
  SeverityLevel,
} from "./taxonomy";

export interface CategoryLabel {
  label: string;
  meaning: string;
  soWhat: string;
}

export const CATEGORY_LABELS: Record<FindingCategory, CategoryLabel> = {
  EFFECTIVE_CONFIGURATION_CANDIDATE: {
    label: "Worked — worth copying",
    meaning: "This package won with a configuration that looks repeatable.",
    soWhat: "Candidate for turning into a default rather than a one-off.",
  },
  WIN_WITH_INTEGRITY_DEFECT: {
    label: "Won despite a defect",
    meaning: "The case was won, but the package had a flaw that could have cost it.",
    soWhat: "A win here is luck, not method. Fix the defect before it decides a case.",
  },
  UNWINNABLE_OR_ADVERSE_FACTS: {
    label: "Not winnable on the facts",
    meaning: "The underlying facts argued against the merchant whatever we filed.",
    soWhat: "No evidence change would have helped. Do not spend a pack here.",
  },
  MISSING_ACQUIRABLE_EVIDENCE: {
    label: "Evidence we could have got",
    meaning:
      "Evidence that a real process could have collected before the deadline was absent.",
    soWhat: "The gap is in acquisition, not argument. Fix the collector or the ask.",
  },
  AVAILABLE_EVIDENCE_OMITTED: {
    label: "Had it, didn't send it",
    meaning:
      "Evidence existed and was approved before submission, and still did not reach the issuer.",
    soWhat: "Pure loss. The evidence was paid for and then withheld by our own gating.",
  },
  INCORRECT_EVIDENCE_INTERPRETATION: {
    label: "Read the evidence wrong",
    meaning:
      "A signal supporting the merchant was classified in a way that kept it off the issuer-facing record.",
    soWhat:
      "The classifier, not the collector, is the blocker. Check the tier rule for that field.",
  },
  UNSUPPORTED_OR_OVERSTATED_ASSERTION: {
    label: "Argued without citing",
    meaning:
      "A section of the letter made an argument whose every supporting fact was withheld from the Evidence Basis, so the issuer read a claim with no listed evidence behind it.",
    soWhat:
      "An unbacked claim is worse than no claim — it invites the reviewer to discount the whole letter. Either cite the fact or drop the section.",
  },
  WRONG_NETWORK_OR_REASON_LOGIC: {
    label: "Wrong rules for this code",
    meaning: "The package applied logic that does not fit this network or reason code.",
    soWhat: "A mapping bug. It will repeat on every case with the same code.",
  },
  WEAK_OR_IRRELEVANT_PRESENTATION: {
    label: "Weak presentation",
    meaning: "The evidence was present but assembled in a way unlikely to persuade.",
    soWhat: "A template problem rather than an evidence problem.",
  },
  PROCEDURAL_OR_SUBMISSION_FAILURE: {
    label: "Never actually filed",
    meaning:
      "The package was built and saved, but nothing confirms it was forwarded to the issuer.",
    soWhat:
      "The most serious category. The case may have been decided with no submission at all.",
  },
  DATA_INTEGRITY_FAILURE: {
    label: "Can't trust the record",
    meaning:
      "Our own record of what was filed is incomplete or contradictory, so the case cannot be assessed.",
    soWhat:
      "Not a dispute defect — a bookkeeping defect. It blocks learning from every case it touches.",
  },
  NO_MATERIAL_GAP_OBSERVED: {
    label: "Nothing found",
    meaning: "The package was examined and no material gap was observed.",
    soWhat: "We looked and found nothing. This is not the same as not looking.",
  },
  INDETERMINATE: {
    label: "Couldn't assess",
    meaning: "There was not enough of a record to reach any conclusion.",
    soWhat: "Absence of a finding here means absence of evidence, not absence of a problem.",
  },
};

/** The short form, for a table cell. Falls back to the raw value, never blank. */
export function categoryLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return CATEGORY_LABELS[value as FindingCategory]?.label ?? value;
}

export function categoryMeaning(value: string | null | undefined): string | null {
  if (!value) return null;
  return CATEGORY_LABELS[value as FindingCategory]?.meaning ?? null;
}

export function categorySoWhat(value: string | null | undefined): string | null {
  if (!value) return null;
  return CATEGORY_LABELS[value as FindingCategory]?.soWhat ?? null;
}

/**
 * Confidence in sentence case. DEFINITE stays emphatic because it is the one
 * value that means "this is not a hypothesis".
 */
export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  DEFINITE: "Definite",
  HIGH: "High confidence",
  MODERATE: "Moderate confidence",
  LOW: "Low confidence",
};

export const SEVERITY_LABELS: Record<SeverityLevel, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

/** Where a fix would land, named as a team would name it. */
export const ACTION_CLASS_LABELS: Record<ActionClass, string> = {
  EVIDENCE_ACQUISITION: "Fix: evidence collection",
  PIPELINE_RELIABILITY: "Fix: pipeline reliability",
  RULE_ENGINE: "Fix: classification rules",
  EVIDENCE_MAPPING: "Fix: evidence mapping",
  NARRATIVE_TEMPLATE: "Fix: letter template",
  MERCHANT_OPERATIONS: "Fix: merchant operations",
  DATA_QUALITY: "Fix: data quality",
  NO_ACTION: "No action needed",
};

export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  PENDING_REVIEW: "Pending",
  CONFIRMED: "Confirmed",
  EDITED: "Edited",
  REJECTED: "Rejected",
  INDETERMINATE: "Indeterminate",
};

export function confidenceLabel(v: string | null | undefined): string {
  if (!v) return "—";
  return CONFIDENCE_LABELS[v as ConfidenceLevel] ?? v;
}

export function severityLabel(v: string | null | undefined): string {
  if (!v) return "—";
  return SEVERITY_LABELS[v as SeverityLevel] ?? v;
}

export function actionClassLabel(v: string | null | undefined): string {
  if (!v) return "—";
  return ACTION_CLASS_LABELS[v as ActionClass] ?? v;
}

export function reviewStateLabel(v: string | null | undefined): string {
  if (!v) return "—";
  return REVIEW_STATE_LABELS[v as ReviewState] ?? v;
}
