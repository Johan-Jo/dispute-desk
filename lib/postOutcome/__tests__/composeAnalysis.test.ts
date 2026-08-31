/**
 * Bounded-synthesis tests (plan §12, §23 step 8).
 *
 * Two properties carry this layer: a finding that cannot pass the gate is
 * DROPPED rather than softened, and "we found nothing" is told apart from "we
 * could not look".
 */

import { describe, expect, it } from "vitest";
import { composeAnalysis } from "../composeAnalysis";
import { assembleSnapshot, type SnapshotInputs, type RawDisputeRow, type RawPackageRow } from "../buildSnapshot";

const SUBMITTED_AT = "2026-07-10T12:00:00.000Z";

function disputeRow(overrides: Partial<RawDisputeRow> = {}): RawDisputeRow {
  return {
    id: "d-1",
    shop_id: "s-1",
    phase: "chargeback",
    reason: "FRAUDULENT",
    network_reason_code: "10.4",
    amount: "120.00",
    currency_code: "USD",
    initiated_at: "2026-07-01T00:00:00.000Z",
    closed_at: "2026-08-01T00:00:00.000Z",
    final_outcome: "lost",
    outcome_source: "shopify",
    submission_state: "submitted_confirmed",
    submitted_at: SUBMITTED_AT,
    evidence_saved_to_shopify_at: "2026-07-09T00:00:00.000Z",
    due_at: "2026-07-20T00:00:00.000Z",
    dispute_evidence_gid: "gid://shopify/DisputeEvidence/1",
    order_gid: "gid://shopify/Order/99",
    raw_snapshot: { evidenceSentOn: SUBMITTED_AT },
    ...overrides,
  };
}

/** A clean package: every fact issuer-facing, every element held, no defects. */
function cleanPackage(overrides: Partial<RawPackageRow> = {}): RawPackageRow {
  const strongFact = (id: string, category: string, value: Record<string, unknown>) => ({
    id,
    category,
    source: "shopify_order",
    value,
    bankEligible: true,
    includeInBankNarrative: true,
    submissionRisk: false,
    internalOnly: false,
  });
  return {
    id: "p-1",
    dispute_id: "d-1",
    version: 1,
    content_revision: 1,
    status: "submitted",
    submitted_at: SUBMITTED_AT,
    generated_at: "2026-07-08T00:00:00.000Z",
    pdf_path: "packs/p-1.pdf",
    evidence_hash: "hash",
    prompt_version: "15",
    validator_version: 4,
    reason_code_module: "FRAUDULENT",
    facts_json: [
      strongFact("f1", "payment_authentication", { avsResult: "Y", cvvResult: "M" }),
      strongFact("f2", "ip_location", { locationMatch: "same_city" }),
      strongFact("f3", "prior_customer_history", { priorOrderCount: 3 }),
      strongFact("f4", "delivery_proof", {}),
      strongFact("f5", "shipping_tracking", {}),
      strongFact("f6", "customer_communication", {}),
    ],
    narrative_json: {
      executiveSummary: { text: "Verification matched.", usedFactIds: ["f1"] },
      warnings: [],
      omittedSections: [],
    },
    shopify_response: {
      verified: true,
      finalStatus: "saved_to_shopify_verified",
      evidenceGid: "gid://shopify/DisputeEvidence/1",
      fileGid: "gid://shopify/GenericFile/1",
    },
    ...overrides,
  };
}

function inputs(overrides: Partial<SnapshotInputs> = {}): SnapshotInputs {
  return {
    dispute: disputeRow(),
    submittedPackages: [cleanPackage()],
    gorgias: [],
    events: [],
    paymentGateway: "shopify_payments",
    cardNetwork: "UNKNOWN",
    caseStrengthAtSubmission: "not_assessed",
    ...overrides,
  };
}

describe("a clean case produces a clean result", () => {
  it("reports NO_MATERIAL_GAP_OBSERVED with no findings", () => {
    const analysis = composeAnalysis(assembleSnapshot(inputs()));
    expect(analysis.findings).toEqual([]);
    expect(analysis.primaryCategory).toBe("NO_MATERIAL_GAP_OBSERVED");
    expect(analysis.actionable).toBe(false);
    expect(analysis.analysisStatus).toBe("COMPLETED");
    expect(analysis.reasonSpecificStatus).toBe("SUPPORTED");
  });

  it("records which stages ran, so empty is not confused with skipped", () => {
    const analysis = composeAnalysis(assembleSnapshot(inputs()));
    expect(analysis.summary.stagesRun).toEqual([
      "lifecycle",
      "evidence_comparison",
      "assertion_integrity",
      "reason:FRAUDULENT",
    ]);
  });
});

describe("found nothing vs could not look", () => {
  it("says INDETERMINATE when there was no package to read", () => {
    // ~888 decided prod disputes are historical imports with no package. A
    // silent result there means we could not look, not that all was well.
    const analysis = composeAnalysis(
      assembleSnapshot(inputs({ submittedPackages: [] })),
    );
    expect(analysis.analysisLevel).toBe("OUTCOME_METADATA_ONLY");
    expect(analysis.primaryCategory).toBe("INDETERMINATE");
  });

  it("does not run the reason module below FULL_POST_OUTCOME", () => {
    const analysis = composeAnalysis(
      assembleSnapshot(
        inputs({
          dispute: disputeRow({
            submission_state: "saved_to_shopify",
            submitted_at: null,
            raw_snapshot: { evidenceSentOn: null },
          }),
        }),
      ),
    );
    expect(analysis.analysisLevel).toBe("PACKAGE_INTEGRITY_ONLY");
    expect(analysis.reasonSpecificStatus).toBe("BLOCKED");
    expect(analysis.summary.stagesRun).not.toContain("reason:FRAUDULENT");
  });

  it("reports NOT_YET_SUPPORTED for a reason with no module", () => {
    const analysis = composeAnalysis(
      assembleSnapshot(
        inputs({ dispute: disputeRow({ reason: "PRODUCT_UNACCEPTABLE" }) }),
      ),
    );
    expect(analysis.reasonSpecificStatus).toBe("NOT_YET_SUPPORTED");
  });
});

describe("the gate drops what it cannot support", () => {
  it("blocks the whole analysis when the snapshot is malformed", () => {
    // A contract violation means findings would describe a record we already
    // know is wrong.
    const build = assembleSnapshot(inputs());
    const analysis = composeAnalysis({
      ...build,
      contractErrors: ["evidence e-1 appears in both buckets"],
    });
    expect(analysis.analysisStatus).toBe("DATA_INTEGRITY_BLOCKED");
    expect(analysis.primaryCategory).toBe("DATA_INTEGRITY_FAILURE");
    expect(analysis.reasonSpecificStatus).toBe("BLOCKED");
    expect(analysis.summary.stagesRun).toEqual([]);
  });

  it("stores no finding that fails validation", () => {
    // Every finding reaching `findings` has passed the causal-language and
    // provenance gate; anything else lands in rejectedFindings.
    const analysis = composeAnalysis(
      assembleSnapshot(
        inputs({
          submittedPackages: [
            cleanPackage({
              facts_json: [
                {
                  id: "f1",
                  category: "payment_authentication",
                  source: "shopify_order",
                  value: { avsResult: "N", cvvResult: "M" },
                  bankEligible: true,
                  includeInBankNarrative: true,
                  submissionRisk: false,
                  internalOnly: false,
                },
              ],
            }),
          ],
        }),
      ),
    );
    expect(analysis.rejectedFindings).toEqual([]);
    for (const f of analysis.findings) {
      expect(f.evidenceRefs.length + f.ruleRefs.length).toBeGreaterThan(0);
    }
  });
});

describe("primary selection", () => {
  it("prefers the most severe finding", () => {
    // Saved-but-never-forwarded is CRITICAL and must outrank everything else.
    const analysis = composeAnalysis(
      assembleSnapshot(
        inputs({
          dispute: disputeRow({
            submission_state: "saved_to_shopify",
            submitted_at: null,
            raw_snapshot: { evidenceSentOn: null },
          }),
        }),
      ),
    );
    expect(analysis.primaryCategory).toBe("PROCEDURAL_OR_SUBMISSION_FAILURE");
    expect(analysis.primaryConfidence).toBe("DEFINITE");
  });

  it("puts an adverse disclosure above a merely withheld signal", () => {
    // Adverse disclosure is exercised through order origin: a failed AVS is
    // never rendered to the issuer, so it cannot be a disclosure (see the
    // 14-case false positive corrected in reasons/fraudulent.ts).
    const analysis = composeAnalysis(
      assembleSnapshot(
        inputs({
          submittedPackages: [
            cleanPackage({
              facts_json: [
                {
                  id: "f1",
                  category: "ip_location",
                  source: "ipinfo_io",
                  value: { locationMatch: "different_country" },
                  bankEligible: true,
                  includeInBankNarrative: true,
                  submissionRisk: false,
                  internalOnly: false,
                },
                {
                  id: "f2",
                  category: "prior_customer_history",
                  source: "shopify_order",
                  value: { priorOrderCount: 3 },
                  bankEligible: false,
                  includeInBankNarrative: false,
                  submissionRisk: false,
                  internalOnly: false,
                },
              ],
            }),
          ],
        }),
      ),
    );
    expect(analysis.primaryCategory).toBe("INCORRECT_EVIDENCE_INTERPRETATION");
    expect(analysis.primaryConfidence).toBe("DEFINITE");
  });
});

describe("summary is structured, not prose", () => {
  it("carries counts and context the admin table needs", () => {
    const analysis = composeAnalysis(assembleSnapshot(inputs()));
    expect(analysis.summary.outcome).toBe("lost");
    expect(analysis.summary.paymentProvider).toBe("SHOPIFY_PAYMENTS");
    expect(analysis.summary.submissionConfirmationSource).toBe("SHOPIFY_EVIDENCE_SENT_ON");
    expect(analysis.summary.evidenceCounts.INCLUDED_ACCURATELY).toBe(6);
    expect(analysis.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
