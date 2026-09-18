/**
 * What the corpus says, as opposed to what is in it.
 *
 * ── Why this exists ──
 *
 * The Outcome Analysis page listed 50 rows and named a category on each. A
 * reader could see `UNSUPPORTED_OR_OVERSTATED_ASSERTION` fifty times and still
 * not know that 24 of those sections were the SAME template bug, that one fix
 * addressed half of them, or that the defect-free packages lost at the same
 * rate as the defective ones. Every one of those conclusions was in the data
 * and none was on the page. A tool that makes you run SQL to learn what it
 * found is a table, not an analysis.
 *
 * ── The rule this module exists to obey ──
 *
 * A conclusion here describes WHAT WE FILED. It never explains why an issuer
 * ruled as it did (plan §2). "24 sections argued from withheld facts" is a
 * statement about our own output and is checkable. "We lost because the letter
 * was unsupported" is a claim about an adjudicator's reasoning that no data
 * here can support, and it is exactly the sentence this file must never emit.
 *
 * Strength is therefore about SAMPLE, not about certainty of causation:
 *
 *   OBSERVED      a count of our own artefacts; needs no inference
 *   DIRECTIONAL   a comparison with enough cases to mention, not to act on
 *   INSUFFICIENT  the comparison cannot be made yet, and says so out loud
 *
 * An INSUFFICIENT conclusion is still rendered. "We cannot yet tell whether
 * package quality moves outcomes" is a real and useful thing for a reader to
 * know, and suppressing it would leave the impression that nobody looked.
 */

import { categoryLabel } from "./labels";

export type ConclusionStrength = "OBSERVED" | "DIRECTIONAL" | "INSUFFICIENT";

export interface Conclusion {
  /** Stable key, for tests and for a reader reporting which one is wrong. */
  key: string;
  /** The statement itself. A sentence, not a label. */
  headline: string;
  /** The numbers behind it. */
  detail: string;
  /** What a person could do about it, or null when there is nothing to do. */
  action: string | null;
  strength: ConclusionStrength;
}

export interface ConclusionAnalysis {
  outcome: "won" | "lost";
  effectiveCategory: string | null;
  analysisLevel: string;
  submissionConfirmationSource: string;
  reviewState: string;
}

export interface ConclusionFinding {
  analysisId: string;
  category: string;
  /** Free text; section names are parsed out of it where present. */
  observedFact: string | null;
}

const FORWARDED = new Set(["SHOPIFY_EVIDENCE_SENT_ON", "PROVIDER_LOG"]);

/**
 * Minimum cases per arm before a win-rate comparison may be called
 * DIRECTIONAL. Below this the arms are named and the comparison withheld.
 *
 * Deliberately low: this is the bar for "worth mentioning", not the bar for
 * "worth acting on". Nothing in this module ever reaches the second bar, and
 * `evaluationVerdict` in learningActions.ts is where that decision lives.
 */
const MIN_ARM = 5;

/** Pull `section:NAME` occurrences out of an observed-fact string. */
export function parseSections(observedFact: string | null): string[] {
  if (!observedFact) return [];
  const out: string[] = [];
  const re = /section:([A-Za-z][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(observedFact)) !== null) out.push(m[1]);
  return out;
}

/** `paymentAuthenticationArgument` → `payment authentication argument`. */
function humaniseSection(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
}

function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Derive the conclusions, most useful first.
 *
 * Pure: the page passes rows in and renders what comes back, so the reasoning
 * is testable without a database or a browser.
 */
export function deriveConclusions(
  analyses: readonly ConclusionAnalysis[],
  findings: readonly ConclusionFinding[],
): Conclusion[] {
  const out: Conclusion[] = [];
  if (analyses.length === 0) return out;

  /* ── 1. Does one template account for most of one defect? ─────────────── */

  const sectionCounts = new Map<string, number>();
  let sectionedFindings = 0;
  for (const f of findings) {
    const sections = parseSections(f.observedFact);
    if (sections.length > 0) sectionedFindings += 1;
    for (const s of sections) {
      sectionCounts.set(s, (sectionCounts.get(s) ?? 0) + 1);
    }
  }
  const totalSections = [...sectionCounts.values()].reduce((a, b) => a + b, 0);
  if (totalSections > 0) {
    const ranked = [...sectionCounts.entries()].sort((a, b) => b[1] - a[1]);
    const [topName, topCount] = ranked[0];
    out.push({
      key: "section_concentration",
      headline:
        ranked.length === 1
          ? `Every unsupported section is the same template: ${humaniseSection(topName)}.`
          : `${totalSections} unsupported ${plural(totalSections, "section", "sections")} come from ${ranked.length} ${plural(ranked.length, "template", "templates")}, and ${humaniseSection(topName)} accounts for ${pct(topCount, totalSections)} of them.`,
      detail: ranked
        .slice(0, 4)
        .map(([n, c]) => `${humaniseSection(n)} ${c}`)
        .join(" · "),
      action:
        `Fixing ${humaniseSection(topName)} alone addresses ${topCount} of ${totalSections} ` +
        `${plural(totalSections, "section", "sections")}, across ${sectionedFindings} ${plural(sectionedFindings, "case", "cases")}.`,
      strength: "OBSERVED",
    });
  }

  /* ── 2. Do clean packages fare any differently? ────────────────────────── */

  const clean = analyses.filter((a) => a.effectiveCategory === "NO_MATERIAL_GAP_OBSERVED");
  const defective = analyses.filter(
    (a) =>
      a.effectiveCategory !== null &&
      a.effectiveCategory !== "NO_MATERIAL_GAP_OBSERVED" &&
      a.effectiveCategory !== "INDETERMINATE",
  );
  const cleanWon = clean.filter((a) => a.outcome === "won").length;
  const defectiveWon = defective.filter((a) => a.outcome === "won").length;

  if (clean.length < MIN_ARM || defective.length < MIN_ARM) {
    out.push({
      key: "quality_vs_outcome",
      headline:
        "Whether package quality changes the outcome cannot be tested on this set.",
      detail:
        `${clean.length} ${plural(clean.length, "package was", "packages were")} defect-free and ` +
        `${defective.length} carried at least one finding. A comparison needs at least ${MIN_ARM} on each side.`,
      action:
        "Treat every fix here as a correctness fix. Nothing in this data shows it moves the win rate.",
      strength: "INSUFFICIENT",
    });
  } else {
    const cleanRate = cleanWon / clean.length;
    const defectiveRate = defectiveWon / defective.length;
    const gap = Math.abs(cleanRate - defectiveRate);
    out.push({
      key: "quality_vs_outcome",
      headline:
        gap < 0.05
          ? "Defect-free packages did not fare differently from defective ones."
          : cleanRate > defectiveRate
            ? "Defect-free packages fared better, on a sample too small to act on."
            : "Defect-free packages fared worse, which is a reason to check the classifier before the template.",
      detail:
        `defect-free ${cleanWon}/${clean.length} (${pct(cleanWon, clean.length)}) · ` +
        `with findings ${defectiveWon}/${defective.length} (${pct(defectiveWon, defective.length)})`,
      action:
        "A holdout is the only way to settle this: file on a random half of eligible cases and compare.",
      strength: "DIRECTIONAL",
    });
  }

  /* ── 3. Did anything never actually reach the issuer? ──────────────────── */

  const notForwarded = analyses.filter(
    (a) => !FORWARDED.has(a.submissionConfirmationSource),
  );
  if (notForwarded.length > 0) {
    out.push({
      key: "never_forwarded",
      headline: `${notForwarded.length} ${plural(notForwarded.length, "package was", "packages were")} saved but never confirmed forwarded.`,
      detail:
        `${pct(notForwarded.length, analyses.length)} of the set. These cases were decided without ` +
        "any record that the evidence reached the issuer at all.",
      action:
        "Detect a save with no forwarding confirmation and surface it while the deadline can still be met.",
      strength: "OBSERVED",
    });
  }

  /* ── 4. How much of the above is still only a hypothesis? ──────────────── */

  const pending = analyses.filter((a) => a.reviewState === "PENDING_REVIEW").length;
  if (pending > 0) {
    out.push({
      key: "unreviewed",
      headline: `${pending} of ${analyses.length} ${plural(analyses.length, "analysis is", "analyses are")} unreviewed.`,
      detail:
        "Automated findings are hypotheses until a person confirms them, and no change may be " +
        "approved on an unreviewed finding.",
      action: "Review the highest-confidence findings first; the table below is ordered for that.",
      strength: "OBSERVED",
    });
  }

  return out;
}

/**
 * The one-line answer to "what is the dominant problem here", for the page
 * header. Returns null rather than inventing a headline for an empty set.
 */
export function dominantCategory(
  analyses: readonly ConclusionAnalysis[],
): { category: string; label: string; count: number; share: string } | null {
  const counts = new Map<string, number>();
  for (const a of analyses) {
    if (!a.effectiveCategory || a.effectiveCategory === "NO_MATERIAL_GAP_OBSERVED") continue;
    counts.set(a.effectiveCategory, (counts.get(a.effectiveCategory) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const [category, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    category,
    label: categoryLabel(category),
    count,
    share: pct(count, analyses.length),
  };
}
