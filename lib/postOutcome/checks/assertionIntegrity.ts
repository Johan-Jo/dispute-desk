/**
 * Stage 4 — assertion and rule integrity (plan §7 Stage 4).
 *
 * Checks the submitted narrative's declared support against the package's own
 * facts. Pure; reads only the snapshot.
 *
 * ── What is and is not machine-verifiable here ──
 *
 * Each narrative section declares `usedFactIds` — the model's own statement of
 * what supports it. That declaration is checkable. The PROSE is not: deciding
 * whether a sentence overstates its evidence needs reading, not joins. So an
 * assertion is only ever classified `UNSUPPORTED` when a cited fact is absent
 * from the package, and `NOT_MACHINE_VERIFIABLE` otherwise. Plan §7 Stage 4 is
 * explicit that inability to verify is not evidence of falsehood.
 *
 * ── Measured on the 53 submitted packages of decided prod disputes ──
 *
 *   narrative sections ....................... 308
 *   sections with no declared support .......... 0
 *   citations to a fact not in the package ..... 0
 *   citations to an internal-only fact .......... 0
 *
 * The build-time validator's `unknown_fact_id` and `internal_only_fact_referenced`
 * rules are holding. Those checks are kept anyway — they are cheap, and a rule
 * that currently never fires is exactly the one that stops being enforced.
 *
 * ── The one thing that does fire ──
 *
 *   citations to a fact the Evidence Basis suppresses ... 370, across 53/53 packages
 *   sections whose support is ENTIRELY suppressed ....... 63
 *
 * That first number is C-1, the known divergence documented in
 * `lib/defence/bankInclusion.ts`: the LLM payload filter
 * (`reachesLlmPayloadLegacy`) admits facts that `isBankIncludedFact` refuses, so
 * the generator can argue from a fact the appendix will not list. Convergence is
 * deliberately deferred there and needs "its own measured delta" — so this stage
 * records the divergence as an OBSERVATION rather than re-reporting a known,
 * owned decision as 53 defects.
 *
 * The second number is the sharper subset and DOES get a finding: a section
 * whose entire declared support is suppressed argues to the issuer from nothing
 * the Evidence Basis will show. 26 of those are `paymentAuthenticationArgument`
 * and 25 `transactionOverviewArgument`. Confidence is MODERATE, because what the
 * record proves is the absence of listed support, not that the prose overstates.
 */

import type { DraftFinding, LifecycleObservation } from "../findings";
import type { PostOutcomeSourceSnapshot } from "../snapshotContract";
import type { AssertionClassification } from "../taxonomy";

export interface ClassifiedAssertion {
  id: string;
  classification: AssertionClassification;
  rationale: string;
  /** Cited facts that reached the issuer-facing package. */
  supportedByIssuerFacing: string[];
  /** Cited facts the package recorded but withheld from the issuer. */
  supportedBySuppressed: string[];
  /** Cited facts the package does not contain at all. */
  unresolved: string[];
}

export interface AssertionIntegrityResult {
  assertions: ClassifiedAssertion[];
  findings: DraftFinding[];
  observations: LifecycleObservation[];
}

export function runAssertionIntegrity(
  snapshot: PostOutcomeSourceSnapshot,
): AssertionIntegrityResult {
  const findings: DraftFinding[] = [];
  const observations: LifecycleObservation[] = [];

  // Which evidence ids reached the issuer, and which the package withheld.
  const issuerFacing = new Set(
    snapshot.availableBeforeSubmission
      .filter((e) => e.presentInSubmittedPackage)
      .map((e) => e.id),
  );

  const assertions: ClassifiedAssertion[] = snapshot.assertions.map((a) => {
    const supported = a.supportingEvidenceIds.filter((id) => issuerFacing.has(id));
    const suppressed = a.supportingEvidenceIds.filter((id) => !issuerFacing.has(id));

    if (a.unresolvedEvidenceIds.length > 0) {
      return {
        id: a.id,
        classification: "UNSUPPORTED" as const,
        rationale: `Cites ${a.unresolvedEvidenceIds.length} fact id(s) the package does not contain.`,
        supportedByIssuerFacing: supported,
        supportedBySuppressed: suppressed,
        unresolved: a.unresolvedEvidenceIds,
      };
    }

    return {
      id: a.id,
      classification: "NOT_MACHINE_VERIFIABLE" as const,
      rationale:
        supported.length > 0
          ? "Declared support exists in the issuer-facing package; whether the prose overstates it is not machine-checkable."
          : "Declared support exists but none of it reached the issuer; whether the prose overstates it is not machine-checkable.",
      supportedByIssuerFacing: supported,
      supportedBySuppressed: suppressed,
      unresolved: [],
    };
  });

  /* ── A citation to a fact the package does not carry ──────────────────── */
  const dangling = assertions.filter((a) => a.unresolved.length > 0);
  if (dangling.length > 0) {
    findings.push({
      category: "UNSUPPORTED_OR_OVERSTATED_ASSERTION",
      confidence: "DEFINITE",
      severity: "HIGH",
      title: `${dangling.length} narrative section(s) cite a fact the package does not contain`,
      description:
        "A section of the submitted narrative declares support from a fact id that is absent from the package's own evidence record.",
      observedFact: dangling
        .map((d) => `${d.id} cites ${d.unresolved.join(", ")}, absent from facts_json.`)
        .join(" "),
      counterfactualImprovement:
        "Reject a narrative that cites a fact the package does not carry, before it is filed.",
      actionClass: "RULE_ENGINE",
      evidenceRefs: dangling.map((d) => ({ id: d.id })),
      ruleRefs: [{ id: "assertion.unknown_fact_citation", version: 1 }],
    });
  }

  /* ── A section arguing from nothing the issuer will see ───────────────── */
  const fullySuppressed = assertions.filter(
    (a) =>
      a.unresolved.length === 0 &&
      a.supportedByIssuerFacing.length === 0 &&
      a.supportedBySuppressed.length > 0,
  );
  if (fullySuppressed.length > 0) {
    findings.push({
      category: "UNSUPPORTED_OR_OVERSTATED_ASSERTION",
      confidence: "MODERATE",
      severity: "MEDIUM",
      title: `${fullySuppressed.length} narrative section(s) rest entirely on facts the Evidence Basis does not list`,
      description:
        "Every fact these sections declare as support was recorded in the package but withheld from issuer-facing content, so the argument reaches the issuer with no listed evidence behind it.",
      observedFact: fullySuppressed
        .map(
          (f) =>
            `${f.id}: ${f.supportedBySuppressed.length} supporting fact(s), none of them issuer-facing.`,
        )
        .join(" "),
      counterfactualImprovement:
        "Align what the narrative may argue from with what the Evidence Basis lists, so a section cannot rest solely on withheld facts.",
      actionClass: "RULE_ENGINE",
      evidenceRefs: fullySuppressed.map((f) => ({ id: f.id })),
      ruleRefs: [{ id: "assertion.support_entirely_suppressed", version: 1 }],
    });
  }

  /* ── The known divergence, recorded rather than re-litigated ──────────── */
  const suppressedCitations = assertions.reduce(
    (n, a) => n + a.supportedBySuppressed.length,
    0,
  );
  if (suppressedCitations > 0) {
    observations.push({
      key: "cites_suppressed_facts",
      summary:
        "The narrative's declared support includes facts the Evidence Basis does not list",
      detail:
        `${suppressedCitations} citation(s) across ${assertions.length} section(s). ` +
        "This is the known C-1 divergence between the generator's input filter and the issuer-facing inclusion rule (lib/defence/bankInclusion.ts), whose convergence is deliberately deferred pending a measured delta.",
    });
  }

  return { assertions, findings, observations };
}
