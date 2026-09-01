/**
 * Snapshot builder tests (plan §19 "Snapshot tests" + "Evidence-comparison tests").
 *
 * Fixtures mirror the real prod shapes measured 2026-08-30: the 49 forwarded
 * packages, the 4 saved-but-never-forwarded, and the 2 disputes carrying
 * several submitted packages.
 */

import { describe, expect, it } from "vitest";
import {
  assembleSnapshot,
  evidenceSentOn,
  narrativeToAssertions,
  parseFacts,
  platformSaveVerified,
  providerFromGateway,
  resolveConfirmationSource,
  resolvePackageTie,
  resolveSubmissionInstant,
  type RawDisputeRow,
  type RawGorgiasRow,
  type RawPackageRow,
  type SnapshotInputs,
} from "../buildSnapshot";

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
    due_at: "2026-07-15T00:00:00.000Z",
    dispute_evidence_gid: "gid://shopify/DisputeEvidence/1",
    order_gid: "gid://shopify/Order/99",
    raw_snapshot: { evidenceSentOn: SUBMITTED_AT },
    ...overrides,
  };
}

function packageRow(overrides: Partial<RawPackageRow> = {}): RawPackageRow {
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
    prompt_version: "v6",
    validator_version: 4,
    reason_code_module: "FRAUDULENT",
    facts_json: [
      {
        id: "f1",
        category: "payment_authentication",
        source: "shopify_order",
        bankEligible: true,
        includeInBankNarrative: true,
        internalOnly: false,
      },
      {
        id: "f2",
        category: "prior_customer_history",
        source: "shopify_order",
        bankEligible: false,
        includeInBankNarrative: false,
        internalOnly: true,
      },
    ],
    narrative_json: {
      executiveSummary: { text: "AVS and CVV matched.", usedFactIds: ["f1"] },
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
    submittedPackages: [packageRow()],
    gorgias: [],
    events: [],
    paymentGateway: "shopify_payments",
    cardNetwork: "UNKNOWN",
    caseStrengthAtSubmission: "not_assessed",
    ...overrides,
  };
}

describe("provider resolution", () => {
  it("maps known gateways and refuses to guess", () => {
    expect(providerFromGateway("shopify_payments")).toBe("SHOPIFY_PAYMENTS");
    expect(providerFromGateway("klarna")).toBe("KLARNA");
    expect(providerFromGateway("paypal")).toBe("PAYPAL");
    expect(providerFromGateway("stripe")).toBe("OTHER");
    // An unresolved order must not inherit the platform's dominant provider.
    expect(providerFromGateway(null)).toBe("UNKNOWN");
  });
});

describe("forwarding vs saving", () => {
  it("reads evidenceSentOn as the forwarding signal", () => {
    expect(evidenceSentOn(disputeRow())).toBe(SUBMITTED_AT);
    expect(evidenceSentOn(disputeRow({ raw_snapshot: { evidenceSentOn: null } }))).toBeNull();
    expect(evidenceSentOn(disputeRow({ raw_snapshot: {} }))).toBeNull();
  });

  it("reports a verified save with no forwarding as PLATFORM_SAVE_ONLY", () => {
    // The exact 4-package prod shape: verified, status submitted, no sentOn.
    const dispute = disputeRow({
      submission_state: "saved_to_shopify",
      submitted_at: null,
      raw_snapshot: { evidenceSentOn: null },
    });
    expect(resolveConfirmationSource(dispute, packageRow())).toBe("PLATFORM_SAVE_ONLY");
    expect(platformSaveVerified(packageRow())).toBe(true);
  });

  it("reports a confirmed forward as SHOPIFY_EVIDENCE_SENT_ON", () => {
    expect(resolveConfirmationSource(disputeRow(), packageRow())).toBe(
      "SHOPIFY_EVIDENCE_SENT_ON",
    );
  });

  it("requires BOTH submitted_confirmed and a sentOn timestamp", () => {
    // State says confirmed but Shopify never gave a time: not forwarding proof.
    const dispute = disputeRow({ raw_snapshot: { evidenceSentOn: null } });
    expect(resolveConfirmationSource(dispute, packageRow())).toBe("PLATFORM_SAVE_ONLY");
  });

  it("keeps a merchant's own report distinct from provider confirmation", () => {
    const dispute = disputeRow({
      submission_state: "manual_submission_reported",
      raw_snapshot: {},
    });
    expect(resolveConfirmationSource(dispute, packageRow())).toBe(
      "MANUAL_MERCHANT_REPORT",
    );
  });
});

describe("package identity", () => {
  it("ties a single package by evidence GID", () => {
    const { tie, pkg } = resolvePackageTie(disputeRow(), [packageRow()]);
    expect(tie).toBe("EVIDENCE_GID_MATCH");
    expect(pkg?.id).toBe("p-1");
  });

  it("reads several verified saves as the last one winning", () => {
    // This used to return AMBIGUOUS on the grounds that picking "the newest"
    // would be a fabrication. That premise was wrong: Shopify keeps ONE
    // mutable evidence record per dispute and every save REPLACES its
    // uncategorizedFile, so the last verified save is what the record holds.
    // Confirmed on prod, where versions 2, 3 and 5 of one dispute all carried
    // the identical evidence GID — the GID names the dispute, not a version.
    // The inference is still labelled as one, and it does not reach full
    // analysis; see analysisLevel.ts.
    const { tie, pkg } = resolvePackageTie(disputeRow(), [
      packageRow({ id: "p-1", version: 1, submitted_at: "2026-07-01T00:00:00.000Z" }),
      packageRow({ id: "p-2", version: 2, submitted_at: "2026-07-02T00:00:00.000Z" }),
    ]);
    expect(tie).toBe("LATEST_VERIFIED_SAVE");
    expect(pkg?.id).toBe("p-2");
  });

  it("reports NONE when the GID does not match the dispute", () => {
    const { tie } = resolvePackageTie(
      disputeRow({ dispute_evidence_gid: "gid://shopify/DisputeEvidence/OTHER" }),
      [packageRow()],
    );
    expect(tie).toBe("NONE");
  });
});

describe("submission instant", () => {
  it("prefers evidenceSentOn over the package's own submitted_at", () => {
    const dispute = disputeRow({ raw_snapshot: { evidenceSentOn: "2026-07-11T00:00:00.000Z" } });
    expect(resolveSubmissionInstant(dispute, packageRow())).toBe(
      "2026-07-11T00:00:00.000Z",
    );
  });

  it("falls back to the package submitted_at", () => {
    const dispute = disputeRow({ raw_snapshot: {} });
    expect(resolveSubmissionInstant(dispute, packageRow())).toBe(SUBMITTED_AT);
  });
});

describe("facts parsing", () => {
  it("parses well-formed facts and skips malformed entries", () => {
    const parsed = parseFacts([
      { id: "a", category: "x", source: "s", bankEligible: true },
      { id: 42 },
      null,
      "nope",
      { category: "no id" },
    ]);
    expect(parsed.map((f) => f.id)).toEqual(["a"]);
  });

  it("returns empty for a non-array", () => {
    expect(parseFacts(null)).toEqual([]);
    expect(parseFacts({ facts: [] })).toEqual([]);
  });
});

describe("assembleSnapshot", () => {
  it("builds a FULL_POST_OUTCOME snapshot for a forwarded case", () => {
    const result = assembleSnapshot(inputs());
    expect(result.level.level).toBe("FULL_POST_OUTCOME");
    expect(result.contractErrors).toEqual([]);
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.snapshot.lifecycle.submittedAt).toBe(SUBMITTED_AT);
  });

  it("marks a saved-but-never-forwarded case PACKAGE_INTEGRITY_ONLY", () => {
    const result = assembleSnapshot(
      inputs({
        dispute: disputeRow({
          submission_state: "saved_to_shopify",
          submitted_at: null,
          final_outcome: "won",
          raw_snapshot: { evidenceSentOn: null },
        }),
      }),
    );
    expect(result.level.level).toBe("PACKAGE_INTEGRITY_ONLY");
    // submittedAt must stay null — a save is not a send.
    expect(result.snapshot.lifecycle.submittedAt).toBeNull();
    expect(result.snapshot.lifecycle.platformSaveVerified).toBe(true);
    expect(result.snapshot.provider.capabilities.submissionConfirmationAccess).toBe(false);
    expect(result.snapshot.provider.capabilities.platformSaveConfirmation).toBe(true);
    expect(result.snapshot.reconstructionGaps.join(" ")).toMatch(/never reported forwarding/i);
  });

  it("flags ambiguity when several packages were submitted", () => {
    // Genuinely ambiguous: no save was verified, so none of them replaced the
    // evidence record's file and save order says nothing. A dispute whose
    // saves DID verify resolves to the last one — see resolvePackageTie.
    const result = assembleSnapshot(
      inputs({
        submittedPackages: [
          packageRow({ id: "p-1", version: 1, shopify_response: { verified: false, finalStatus: "save_failed" } }),
          packageRow({ id: "p-2", version: 2, shopify_response: { verified: false, finalStatus: "save_failed" } }),
        ],
      }),
    );
    expect(result.level.dataIntegrityLimitation).toBe(true);
    expect(result.snapshot.submittedPackage).toBeNull();
    expect(result.snapshot.reconstructionGaps.join(" ")).toMatch(/not identifiable/i);
  });

  it("marks an internal-only fact ineligible rather than omitted", () => {
    // f2 is internalOnly: correctly withheld from bank-facing content. It must
    // never later be scored as evidence we failed to include.
    const result = assembleSnapshot(inputs());
    const f2 = result.snapshot.availableBeforeSubmission.find((e) => e.id === "fact:f2");
    expect(f2?.inclusionEligible).toBe(false);
    const f1 = result.snapshot.availableBeforeSubmission.find((e) => e.id === "fact:f1");
    expect(f1?.inclusionEligible).toBe(true);
  });
});

describe("Gorgias availability split", () => {
  function gorgiasRow(overrides: Partial<RawGorgiasRow> = {}): RawGorgiasRow {
    return {
      id: "g-1",
      dispute_id: "d-1",
      evidence_category: "customer_communication",
      review_status: "approved",
      approved_at: "2026-07-05T00:00:00.000Z",
      created_at: "2026-07-04T00:00:00.000Z",
      sent_at: "2026-07-04T00:00:00.000Z",
      approved_excerpt: "Customer confirmed receipt.",
      ...overrides,
    };
  }

  it("counts a pre-submission approval as available", () => {
    const result = assembleSnapshot(inputs({ gorgias: [gorgiasRow()] }));
    expect(result.snapshot.availableBeforeSubmission.some((e) => e.id === "gorgias:g-1")).toBe(true);
    expect(result.snapshot.arrivedAfterSubmission).toHaveLength(0);
  });

  it("counts a post-submission approval as arrived-after, never an omission", () => {
    // The false positive that would blame the pipeline for a time-travel failure.
    const result = assembleSnapshot(
      inputs({ gorgias: [gorgiasRow({ approved_at: "2026-07-20T00:00:00.000Z" })] }),
    );
    expect(result.snapshot.arrivedAfterSubmission.some((e) => e.id === "gorgias:g-1")).toBe(true);
    expect(result.snapshot.availableBeforeSubmission.some((e) => e.id === "gorgias:g-1")).toBe(false);
  });

  it("marks a pending passage ineligible so its absence is correct, not a gap", () => {
    const result = assembleSnapshot(
      inputs({ gorgias: [gorgiasRow({ review_status: "pending", approved_at: null })] }),
    );
    const item = result.snapshot.availableBeforeSubmission.find((e) => e.id === "gorgias:g-1");
    expect(item?.inclusionEligible).toBe(false);
  });

  it("routes to availabilityUnknown when no instant can be resolved", () => {
    const result = assembleSnapshot(
      inputs({
        dispute: disputeRow({ submitted_at: null, raw_snapshot: {} }),
        submittedPackages: [packageRow({ submitted_at: null })],
        gorgias: [gorgiasRow()],
      }),
    );
    expect(result.snapshot.availabilityUnknown.some((e) => e.id === "gorgias:g-1")).toBe(true);
  });

  it("keeps every evidence item in exactly one bucket", () => {
    const result = assembleSnapshot(
      inputs({
        gorgias: [
          gorgiasRow({ id: "g-early" }),
          gorgiasRow({ id: "g-late", approved_at: "2026-07-30T00:00:00.000Z" }),
        ],
      }),
    );
    expect(result.contractErrors).toEqual([]);
  });
});

describe("narrative to assertions", () => {
  it("carries declared fact references and drops dangling ones", () => {
    const assertions = narrativeToAssertions(
      {
        executiveSummary: { text: "Claim.", usedFactIds: ["f1", "ghost"] },
        warnings: [],
        omittedSections: [],
      },
      new Set(["fact:f1"]),
    );
    expect(assertions).toHaveLength(1);
    expect(assertions[0].supportingEvidenceIds).toEqual(["fact:f1"]);
  });

  it("skips non-section keys and empty text", () => {
    const assertions = narrativeToAssertions(
      {
        warnings: [],
        omittedSections: [],
        conclusion: { text: "   ", usedFactIds: [] },
        policyArgument: { text: "Real.", usedFactIds: [] },
      },
      new Set(),
    );
    expect(assertions.map((a) => a.id)).toEqual(["section:policyArgument"]);
  });
});

describe("hash stability", () => {
  it("produces the same hash for the same inputs", () => {
    expect(assembleSnapshot(inputs()).hash).toBe(assembleSnapshot(inputs()).hash);
  });

  it("moves when the confirmation source changes", () => {
    const forwarded = assembleSnapshot(inputs()).hash;
    const savedOnly = assembleSnapshot(
      inputs({
        dispute: disputeRow({
          submission_state: "saved_to_shopify",
          raw_snapshot: { evidenceSentOn: null },
        }),
      }),
    ).hash;
    expect(forwarded).not.toBe(savedOnly);
  });
});

describe("ambiguous-package regressions (found in prod shadow run)", () => {
  it("keeps a true forwarding timestamp when the package is ambiguous", () => {
    // Shopify forwarded evidence on this dispute; we cannot say which of
    // several packages went. That is a real state, not a contradiction — the
    // forwarding fact is about the dispute, the ambiguity about the package.
    const result = assembleSnapshot(
      inputs({
        submittedPackages: [
          packageRow({ id: "p-1", version: 1, shopify_response: { verified: false, finalStatus: "save_failed" } }),
          packageRow({ id: "p-2", version: 2, shopify_response: { verified: false, finalStatus: "save_failed" } }),
          packageRow({ id: "p-3", version: 3, shopify_response: { verified: false, finalStatus: "save_failed" } }),
        ],
      }),
    );
    expect(result.snapshot.submittedPackage).toBeNull();
    expect(result.snapshot.lifecycle.submittedAt).toBe(SUBMITTED_AT);
    expect(result.contractErrors).toEqual([]);
  });

  it("still dates evidence when the package is ambiguous", () => {
    // Before the dispute-level fallback, an ambiguous case lost its instant and
    // dumped every item into availabilityUnknown.
    const result = assembleSnapshot(
      inputs({
        dispute: disputeRow({ raw_snapshot: {} }),
        submittedPackages: [
          packageRow({ id: "p-1", version: 1 }),
          packageRow({ id: "p-2", version: 2 }),
        ],
        gorgias: [
          {
            id: "g-1",
            dispute_id: "d-1",
            evidence_category: "customer_communication",
            review_status: "approved",
            approved_at: "2026-07-05T00:00:00.000Z",
            created_at: "2026-07-04T00:00:00.000Z",
            sent_at: "2026-07-04T00:00:00.000Z",
            approved_excerpt: "x",
          },
        ],
      }),
    );
    expect(result.snapshot.availabilityUnknown).toHaveLength(0);
    expect(result.snapshot.availableBeforeSubmission.some((e) => e.id === "gorgias:g-1")).toBe(true);
  });

  it("still rejects a forwarding timestamp with genuinely no package", () => {
    const result = assembleSnapshot(inputs({ submittedPackages: [] }));
    expect(result.level.level).toBe("OUTCOME_METADATA_ONLY");
    expect(result.snapshot.lifecycle.submittedAt).toBeNull();
  });
});

describe("bank-inclusion routes through THE owner", () => {
  it("marks a submissionRisk fact ineligible", () => {
    // Regression: an earlier draft spelled the rule as
    // `bankEligible && !internalOnly`, which admitted risky facts. Caught by
    // tests/unit/bankInclusionSingleOwner.test.ts, which forbids any file
    // outside lib/defence/bankInclusion.ts combining the flags into a decision.
    const result = assembleSnapshot(
      inputs({
        submittedPackages: [
          packageRow({
            facts_json: [
              {
                id: "risky",
                category: "payment_authentication",
                source: "shopify_order",
                bankEligible: true,
                includeInBankNarrative: true,
                submissionRisk: true,
                internalOnly: false,
              },
            ],
          }),
        ],
      }),
    );
    const item = result.snapshot.availableBeforeSubmission.find(
      (e) => e.id === "fact:risky",
    );
    expect(item?.inclusionEligible).toBe(false);
  });

  it("requires includeInBankNarrative, not merely bankEligible", () => {
    const result = assembleSnapshot(
      inputs({
        submittedPackages: [
          packageRow({
            facts_json: [
              {
                id: "listed-only",
                category: "order_record",
                source: "shopify_order",
                bankEligible: true,
                includeInBankNarrative: false,
                submissionRisk: false,
                internalOnly: false,
              },
            ],
          }),
        ],
      }),
    );
    const item = result.snapshot.availableBeforeSubmission.find(
      (e) => e.id === "fact:listed-only",
    );
    expect(item?.inclusionEligible).toBe(false);
  });
});

/* ─────────────────── Which package did the issuer actually get? ──────────── */

describe("tying a package to the evidence Shopify holds", () => {
  function pkgWith(
    id: string,
    fileGid: string | null,
    submittedAt: string,
    verified = true,
  ): RawPackageRow {
    return {
      ...packageRow(),
      id,
      submitted_at: submittedAt,
      shopify_response: {
        verified,
        finalStatus: "saved_to_shopify_verified",
        evidenceGid: "gid://shopify/DisputeEvidence/1",
        ...(fileGid ? { fileGid } : {}),
      },
    };
  }

  function disputeWithFile(fileGid: string | null): RawDisputeRow {
    return disputeRow({
      raw_snapshot: {
        evidenceSentOn: SUBMITTED_AT,
        disputeEvidence: {
          id: "gid://shopify/DisputeEvidence/1",
          ...(fileGid ? { uncategorizedFile: { id: fileGid } } : {}),
        },
      },
    });
  }

  it("names the package whose file the evidence record holds", () => {
    // The only signal that discriminates between versions: the evidence GID is
    // identical on every package of a dispute (verified on prod).
    const result = resolvePackageTie(disputeWithFile("gid://shopify/GenericFile/B"), [
      pkgWith("p-a", "gid://shopify/GenericFile/A", "2026-07-01T00:00:00.000Z"),
      pkgWith("p-b", "gid://shopify/GenericFile/B", "2026-07-02T00:00:00.000Z"),
    ]);
    expect(result.tie).toBe("EVIDENCE_FILE_MATCH");
    expect(result.pkg?.id).toBe("p-b");
  });

  it("prefers the file match even when it is not the latest save", () => {
    const result = resolvePackageTie(disputeWithFile("gid://shopify/GenericFile/A"), [
      pkgWith("p-a", "gid://shopify/GenericFile/A", "2026-07-01T00:00:00.000Z"),
      pkgWith("p-b", "gid://shopify/GenericFile/B", "2026-07-02T00:00:00.000Z"),
    ]);
    expect(result.tie).toBe("EVIDENCE_FILE_MATCH");
    expect(result.pkg?.id).toBe("p-a");
  });

  it("falls back to the last VERIFIED save when no file GID was captured", () => {
    // Every snapshot before 2026-09-01. Shopify replaces the attached file on
    // each save, so the last verified one is what the record ended up holding.
    const result = resolvePackageTie(disputeWithFile(null), [
      pkgWith("p-a", null, "2026-07-01T00:00:00.000Z"),
      pkgWith("p-b", null, "2026-07-03T00:00:00.000Z"),
      pkgWith("p-c", null, "2026-07-02T00:00:00.000Z"),
    ]);
    expect(result.tie).toBe("LATEST_VERIFIED_SAVE");
    expect(result.pkg?.id).toBe("p-b");
  });

  it("ignores a later save that was never verified", () => {
    // An unverified attempt replaced nothing, so it is not what the issuer has.
    const result = resolvePackageTie(disputeWithFile(null), [
      pkgWith("p-a", null, "2026-07-01T00:00:00.000Z", true),
      pkgWith("p-b", null, "2026-07-03T00:00:00.000Z", false),
    ]);
    expect(result.tie).toBe("LATEST_VERIFIED_SAVE");
    expect(result.pkg?.id).toBe("p-a");
  });

  it("stays ambiguous when no save was ever verified", () => {
    const result = resolvePackageTie(disputeWithFile(null), [
      pkgWith("p-a", null, "2026-07-01T00:00:00.000Z", false),
      pkgWith("p-b", null, "2026-07-03T00:00:00.000Z", false),
    ]);
    expect(result.tie).toBe("AMBIGUOUS_MULTIPLE_PACKAGES");
    expect(result.pkg).toBeNull();
  });

  it("does not guess when a file GID matches more than one package", () => {
    const result = resolvePackageTie(disputeWithFile("gid://shopify/GenericFile/A"), [
      pkgWith("p-a", "gid://shopify/GenericFile/A", "2026-07-01T00:00:00.000Z"),
      pkgWith("p-b", "gid://shopify/GenericFile/A", "2026-07-02T00:00:00.000Z"),
    ]);
    expect(result.tie).toBe("LATEST_VERIFIED_SAVE");
  });

  it("leaves the single-package path alone", () => {
    const result = resolvePackageTie(disputeRow(), [packageRow()]);
    expect(result.tie).toBe("EVIDENCE_GID_MATCH");
  });
});
