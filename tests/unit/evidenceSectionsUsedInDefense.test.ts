/**
 * Regression test for the "manual upload doesn't appear in Evidence
 * Used in Defense" bug.
 *
 * Repro: a manual upload that lands in `evidence_items` with
 * `payload.checklistField = "customer_communication"`. The checklist
 * row flips from `missing` → `available` (correctly) but
 * `deriveEvidenceWithStrength` upgrades it to `strength: "moderate"`
 * by default, while the canonical category is `supporting` (because
 * `customerConfirmsOrder !== true`). Pre-fix, the supporting-row
 * loop's `strength === "moderate"` gate dropped it AND it was never
 * in `derived.contributions.moderate` either — silently disappearing.
 */
import { describe, expect, it } from "vitest";
import { useEvidenceSections } from "@/app/(embedded)/app/disputes/[id]/tabs/useEvidenceSections";
import type { useDisputeWorkspace } from "@/app/(embedded)/app/disputes/[id]/hooks/useDisputeWorkspace";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

function workspaceFixture(overrides: {
  effectiveChecklistFields: Array<{
    field: string;
    label: string;
    status: "available" | "missing" | "waived" | "unavailable";
    strength?: "none" | "moderate" | "strong";
  }>;
  contributionsStrong?: Array<{ evidenceFieldKey: string; label: string }>;
  contributionsModerate?: Array<{ evidenceFieldKey: string; label: string }>;
}): Workspace {
  const effectiveChecklist = overrides.effectiveChecklistFields.map((f) => ({
    field: f.field,
    label: f.label,
    status: f.status,
    priority: "recommended" as const,
    blocking: false,
    source: "auto_shopify" as const,
    strength: f.strength ?? (f.status === "available" ? "moderate" : "none"),
    impact: "negligible" as const,
    content: null,
    payload: null,
  }));

  return {
    data: {
      dispute: {
        id: "test-dispute",
        reason: "FRAUDULENT",
        amount: 100,
        currency: "USD",
        orderName: "#1234",
        orderGid: null,
        customerName: null,
        shopDomain: "shop.myshopify.com",
        disputeGid: "gid://shopify/ShopifyPaymentsDispute/1",
        disputeEvidenceGid: null,
        dueAt: null,
        openedAt: null,
        normalizedStatus: null,
        submissionState: null,
        finalOutcome: null,
      },
      pack: null,
      argumentMap: null,
      rebuttalDraft: null,
      submissionFields: [],
      attachments: [],
      appliedRule: null,
      caseTypeInfo: { disputeType: "fraud", toWin: "", strongestEvidence: "", issuerClaim: "" },
    },
    clientState: {
      activeTab: 1,
      loading: false,
      uploadingField: null,
      uploadSuccessNotice: null,
      excludedFields: new Set(),
      completedFields: new Set(),
      failedFields: new Map(),
      expandedCategories: new Set(),
      focusField: null,
      justSubmitted: false,
    },
    derived: {
      effectiveChecklist,
      categories: [],
      missingItems: [],
      submitOverrideGaps: [],
      readiness: "ready",
      blockerCount: 0,
      warningCount: 0,
      caseStrength: {
        overall: "moderate",
        strongCount: 1,
        moderateCount: 0,
        supportingCount: 0,
        weightedScore: 3,
        coveragePercent: 100,
        improvementHint: null,
        strengthReason: "test",
        heroVariant: null,
      },
      whyWins: null,
      risk: null,
      improvement: null,
      nextAction: { kind: "submit_now" },
      recommendationText: null,
      recommendationHelperText: null,
      contributions: {
        strong: (overrides.contributionsStrong ?? []).map((c) => ({
          signalId: "payment_auth" as const,
          category: "strong" as const,
          ...c,
        })),
        moderate: (overrides.contributionsModerate ?? []).map((c) => ({
          signalId: "delivery" as const,
          category: "moderate" as const,
          ...c,
        })),
      },
      isReadOnly: false,
      isBuilding: false,
      isFailed: false,
      failureCode: null,
    },
    actions: {} as Workspace["actions"],
  } as unknown as Workspace;
}

describe("useEvidenceSections — supporting-row inclusion", () => {
  it("manual upload of customer_communication appears in Evidence Used in Defense (regression)", () => {
    // Reproduces the bug from screenshot 2026-05-03 21:49 on dispute
    // 75d2ee2b-…12602: customer_communication has status=available
    // (file uploaded), but derivedEvidenceWithStrength sets its
    // strength to "moderate", contributions doesn't include it
    // (canonical category is supporting), and the strength gate in
    // useEvidenceSections silently drops it.
    const ws = workspaceFixture({
      effectiveChecklistFields: [
        { field: "avs_cvv_match", label: "AVS/CVV verification", status: "available", strength: "strong" },
        { field: "customer_communication", label: "Customer correspondence", status: "available", strength: "moderate" },
        { field: "delivery_proof", label: "Delivery signature or photo", status: "available", strength: "moderate" },
      ],
      contributionsStrong: [
        { evidenceFieldKey: "avs_cvv_match", label: "AVS/CVV verification" },
      ],
      // customer_communication and delivery_proof intentionally NOT
      // in contributions — their canonical category from a manual
      // upload payload is "supporting" / depends on proofType.
      contributionsModerate: [],
    });

    const sections = useEvidenceSections(ws);

    const fields = sections.usedInDefense.map((r) => r.field).sort();
    expect(fields).toContain("customer_communication");
    expect(fields).toContain("delivery_proof");
    expect(fields).toContain("avs_cvv_match");
    expect(fields).toEqual([
      "avs_cvv_match",
      "customer_communication",
      "delivery_proof",
    ]);

    // Verify the manual-upload row classifies as "supporting" rather
    // than being silently swallowed.
    const customerComm = sections.usedInDefense.find(
      (r) => r.field === "customer_communication",
    );
    expect(customerComm?.strength).toBe("supporting");
  });

  it("contributions take priority — strong fields don't double-render as supporting", () => {
    // The dedup-by-field check (`usedInDefense.some(...)`) ensures a
    // field already pushed via contributions.strong is not also
    // pushed in the supporting loop.
    const ws = workspaceFixture({
      effectiveChecklistFields: [
        { field: "avs_cvv_match", label: "AVS/CVV verification", status: "available", strength: "strong" },
      ],
      contributionsStrong: [
        { evidenceFieldKey: "avs_cvv_match", label: "AVS/CVV verification" },
      ],
    });

    const sections = useEvidenceSections(ws);
    const matching = sections.usedInDefense.filter(
      (r) => r.field === "avs_cvv_match",
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]!.strength).toBe("strong");
  });

  it("missing items don't leak into Evidence Used in Defense", () => {
    const ws = workspaceFixture({
      effectiveChecklistFields: [
        { field: "billing_address_match", label: "Billing match", status: "missing", strength: "none" },
      ],
    });
    const sections = useEvidenceSections(ws);
    expect(sections.usedInDefense).toHaveLength(0);
  });
});
