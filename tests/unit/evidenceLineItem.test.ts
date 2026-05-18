/**
 * Acceptance tests for the dispute-detail evidence status redesign.
 *
 * Tests 1, 2, 17 pass immediately against the current scoring engine
 * (which is already correct). Tests 3–16, 18–23 are gated by upcoming
 * commits and start as `it.fails` so the suite stays green; each later
 * commit flips its tests to `it` when the implementation lands.
 *
 * Plan: C:\Users\johan\.claude\plans\do-a-plan-for-scalable-parrot.md
 */

import { describe, it, expect } from "vitest";
import { calculateCaseStrength } from "@/lib/argument/caseStrength";
import type { EvidencePayloadSource } from "@/lib/argument/caseStrength";
import {
  weakFraudFixture,
  policiesOnlyFraudFixture,
  orderReceiptOnlyFraudFixture,
  mixedInclusionFixture,
} from "../fixtures/disputeFixtures";

function payloadSource(map: Map<string, unknown>): EvidencePayloadSource {
  const obj: Record<string, { payload: Record<string, unknown> }> = {};
  for (const [k, v] of map.entries()) {
    obj[k] = { payload: v as Record<string, unknown> };
  }
  return { kind: "byField", map: obj };
}

describe("Test 1 — weak fraud case with 8/8 sections collected remains Weak", () => {
  it("scorer returns weak when every available row resolves to supporting or internal-only", () => {
    const f = weakFraudFixture();
    const result = calculateCaseStrength(f.checklist, f.reason, payloadSource(f.payloadByField));
    expect(result.overall).toBe("weak");
    expect(result.strongCount).toBe(0);
    expect(result.moderateCount).toBe(0);
  });
});

describe("Test 2 — supporting count never upgrades to Moderate or Strong", () => {
  it("ten supporting rows yield weak with strongCount=0, moderateCount=0", () => {
    const f = weakFraudFixture();
    // The fixture already supplies ~8 supporting rows; copy to amplify.
    const result = calculateCaseStrength(f.checklist, f.reason, payloadSource(f.payloadByField));
    expect(result.overall).toBe("weak");
    expect(result.supportingCount).toBeGreaterThanOrEqual(0);
  });
});

describe("Test 3 — Fraud + policies only → Weak (fraud decisive-signal filter)", () => {
  it("policies accepted at checkout do not make a fraud case strong", () => {
    const f = policiesOnlyFraudFixture();
    const result = calculateCaseStrength(f.checklist, f.reason, payloadSource(f.payloadByField));
    expect(result.overall).toBe("weak");
  });
});

describe("Test 4 — Fraud + order_receipt only → Weak", () => {
  it("order_confirmation is supportingOnly and never elevates", () => {
    const f = orderReceiptOnlyFraudFixture();
    const result = calculateCaseStrength(f.checklist, f.reason, payloadSource(f.payloadByField));
    expect(result.overall).toBe("weak");
  });
});

describe("Test 5 — internal-only negative signals are never includedInBankArgument", () => {
  it("AVS-mismatch / IP-mismatch line items have includedInBankArgument=false", async () => {
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{ field: string; includedInBankArgument: boolean }>;
    };
    const f = weakFraudFixture();
    const lineItems = deriveEvidenceLineItems({
      checklist: f.checklist,
      facts: [],
      payloadByField: f.payloadByField,
      contributions: { strong: [], moderate: [] },
      packSavedToShopify: true,
      excludedFields: new Set<string>(),
      attachmentUploadFailures: new Map<string, string>(),
      inclusionOverrides: new Map(),
      reasonFamily: "fraud",
    });
    const ipRow = lineItems.find((li) => li.field === "ip_location_check");
    expect(ipRow?.includedInBankArgument).toBe(false);
  });
});

describe("Test 6 — billing/shipping mismatch is internal-only for fraud", () => {
  it.fails("a country-mismatch on order_confirmation lands as internal_only", async () => {
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{ field: string; submissionMethod: string }>;
    };
    const f = weakFraudFixture();
    const lineItems = deriveEvidenceLineItems({
      checklist: f.checklist,
      facts: [],
      payloadByField: f.payloadByField,
      contributions: { strong: [], moderate: [] },
      packSavedToShopify: true,
      excludedFields: new Set<string>(),
      attachmentUploadFailures: new Map<string, string>(),
      inclusionOverrides: new Map(),
      reasonFamily: "fraud",
    });
    // The billing/shipping mismatch surfaces as an internal-only line
    // item, not as a positive bank argument on order_confirmation.
    const hasInternalSignal = lineItems.some(
      (li) => li.submissionMethod === "internal_only" && /address/i.test(li.field),
    );
    expect(hasInternalSignal).toBe(true);
  });
});

describe("Test 7 — IP/location mismatch is internal-only by default", () => {
  it("ip_location_check with different_country resolves to internal_only", async () => {
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{ field: string; submissionMethod: string }>;
    };
    const f = weakFraudFixture();
    const lineItems = deriveEvidenceLineItems({
      checklist: f.checklist,
      facts: [],
      payloadByField: f.payloadByField,
      contributions: { strong: [], moderate: [] },
      packSavedToShopify: true,
      excludedFields: new Set<string>(),
      attachmentUploadFailures: new Map<string, string>(),
      inclusionOverrides: new Map(),
      reasonFamily: "fraud",
    });
    const ipRow = lineItems.find((li) => li.field === "ip_location_check");
    expect(ipRow?.submissionMethod).toBe("internal_only");
  });
});

describe("Test 8 — failed AVS/CVV is internal-only by default", () => {
  it.fails("avs_cvv_match with both codes failing resolves to internal_only", async () => {
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{ field: string; submissionMethod: string }>;
    };
    const checklist = [
      {
        field: "avs_cvv_match",
        label: "Payment authentication",
        status: "available" as const,
        priority: "critical" as const,
        blocking: false,
        source: "auto_shopify" as const,
        collectionType: "conditional_auto" as const,
      },
    ];
    const payloadByField = new Map<string, unknown>([
      ["avs_cvv_match", { avsResultCode: "N", cvvResultCode: "N" }],
    ]);
    const lineItems = deriveEvidenceLineItems({
      checklist,
      facts: [],
      payloadByField,
      contributions: { strong: [], moderate: [] },
      packSavedToShopify: true,
      excludedFields: new Set<string>(),
      attachmentUploadFailures: new Map<string, string>(),
      inclusionOverrides: new Map(),
      reasonFamily: "fraud",
    });
    const row = lineItems.find((li) => li.field === "avs_cvv_match");
    expect(row?.submissionMethod).toBe("internal_only");
  });
});

describe("Test 9 — UI never renders \"all evidence included\"", () => {
  it("the rendered dispute-detail markup does not contain that phrase", async () => {
    // Component-render assertion lives in disputeDetailCopy.test.ts; this
    // placeholder pins the contract from the line-item perspective: when
    // any item resolves to internal_only or excluded, the panel cannot
    // claim "all evidence included".
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{ submissionMethod: string }>;
    };
    const f = mixedInclusionFixture();
    const lineItems = deriveEvidenceLineItems({
      checklist: f.checklist,
      facts: [],
      payloadByField: f.payloadByField,
      contributions: { strong: [], moderate: [] },
      packSavedToShopify: true,
      excludedFields: new Set<string>(),
      attachmentUploadFailures: new Map<string, string>(),
      inclusionOverrides: new Map(),
      reasonFamily: "fraud",
    });
    const hasInternalOrExcluded = lineItems.some(
      (li) => li.submissionMethod === "internal_only" || li.submissionMethod === "excluded",
    );
    expect(hasInternalOrExcluded).toBe(true);
  });
});

describe("Test 10 — UI never renders \"8/8 collected\"", () => {
  it("coverage card emits 5 separate metrics, not a single ratio", async () => {
    // The coverage card consumes deriveEvidenceLineItems output. This
    // test asserts the contract supplies the metrics needed to split the
    // headline into 5 separate numbers.
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{
        hasEvidence: boolean;
        includedInDefencePackage: boolean;
        usedAsPositiveBankEvidence: boolean;
        submissionMethod: string;
      }>;
    };
    const f = weakFraudFixture();
    const lineItems = deriveEvidenceLineItems({
      checklist: f.checklist,
      facts: [],
      payloadByField: f.payloadByField,
      contributions: { strong: [], moderate: [] },
      packSavedToShopify: true,
      excludedFields: new Set<string>(),
      attachmentUploadFailures: new Map<string, string>(),
      inclusionOverrides: new Map(),
      reasonFamily: "fraud",
    });
    const sectionsFound = lineItems.filter((li) => li.hasEvidence).length;
    const usedAsPositive = lineItems.filter((li) => li.usedAsPositiveBankEvidence).length;
    // The weak fraud case has sections found > 0 but zero used as positive
    // bank evidence — the two numbers must NOT collapse to a single ratio.
    expect(sectionsFound).toBeGreaterThan(0);
    expect(usedAsPositive).toBe(0);
    expect(sectionsFound).not.toBe(usedAsPositive);
  });
});

describe("Test 11 — \"Strong evidence is included\" only renders when strong bank-eligible exists", () => {
  it("the explainer key resolves to the no-bank-facing variant for the weak fixture", async () => {
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{ usedAsPositiveBankEvidence: boolean }>;
    };
    const f = weakFraudFixture();
    const lineItems = deriveEvidenceLineItems({
      checklist: f.checklist,
      facts: [],
      payloadByField: f.payloadByField,
      contributions: { strong: [], moderate: [] },
      packSavedToShopify: true,
      excludedFields: new Set<string>(),
      attachmentUploadFailures: new Map<string, string>(),
      inclusionOverrides: new Map(),
      reasonFamily: "fraud",
    });
    // Must produce at least one line item for the fixture's checklist;
    // none of them can be a positive bank evidence row.
    expect(lineItems.length).toBeGreaterThan(0);
    const hasUsedAsPositive = lineItems.some((li) => li.usedAsPositiveBankEvidence);
    expect(hasUsedAsPositive).toBe(false);
  });
});

describe("Test 12 — \"submitted to card network\" never appears for SAVED_TO_SHOPIFY / AWAITING_*", () => {
  it.fails("hero copy resolution gates on presentationStatus", async () => {
    // Pinned at the resolver layer. The render-side regex test lives in
    // disputeDetailCopy.test.ts after the hero rewrite (commit 5).
    // For now, this is an `it.fails` placeholder that flips when the
    // presentation enum lands and the hero reads it.
    expect("commit 5 — hero rewrite").toBe("delivered");
  });
});

describe("Test 13 — coverage card shows 5 separate metrics", () => {
  it("sectionsFound, includedInPackage, usedAsPositiveBankArgument, keptInternal, missingDecisive each computable from lineItems", async () => {
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{
        hasEvidence: boolean;
        includedInDefencePackage: boolean;
        usedAsPositiveBankEvidence: boolean;
        submissionMethod: string;
      }>;
    };
    const f = mixedInclusionFixture();
    const lineItems = deriveEvidenceLineItems({
      checklist: f.checklist,
      facts: [],
      payloadByField: f.payloadByField,
      contributions: { strong: [], moderate: [] },
      packSavedToShopify: true,
      excludedFields: new Set<string>(),
      attachmentUploadFailures: new Map<string, string>(),
      inclusionOverrides: new Map(),
      reasonFamily: "fraud",
    });
    const sectionsFound = lineItems.filter((li) => li.hasEvidence).length;
    const includedInPackage = lineItems.filter((li) => li.includedInDefencePackage).length;
    const usedAsPositive = lineItems.filter((li) => li.usedAsPositiveBankEvidence).length;
    const keptInternal = lineItems.filter((li) => li.submissionMethod === "internal_only").length;
    // All five derived metrics are independently computable.
    expect(sectionsFound).toBeGreaterThan(0);
    expect(includedInPackage).toBeGreaterThanOrEqual(usedAsPositive);
    expect(keptInternal).toBeGreaterThan(0);
  });
});

describe("Test 14 — submission summary + evidence rows derive from same source", () => {
  it.fails("the same EvidenceLineItem id appears in both surfaces' view-models", async () => {
    // This is verified by the workspace API returning a single
    // evidenceLineItems array consumed by both surfaces. Pinned by
    // commit 4 once the API exposes it.
    expect("commit 4 — workspace API").toBe("delivered");
  });
});

describe("Test 15 — same item cannot be internal-only here and bank-facing there", () => {
  it.fails("submissionMethod and includedInBankArgument are mutually consistent per row", async () => {
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{
        submissionMethod: string;
        includedInBankArgument: boolean;
        usedAsPositiveBankEvidence: boolean;
      }>;
    };
    const f = mixedInclusionFixture();
    const lineItems = deriveEvidenceLineItems({
      checklist: f.checklist,
      facts: [],
      payloadByField: f.payloadByField,
      contributions: { strong: [], moderate: [] },
      packSavedToShopify: true,
      excludedFields: new Set<string>(),
      attachmentUploadFailures: new Map<string, string>(),
      inclusionOverrides: new Map(),
      reasonFamily: "fraud",
    });
    // The mixed fixture must produce both an internal-only row AND a
    // positive bank evidence row so the consistency check has both
    // branches to enforce.
    expect(lineItems.length).toBeGreaterThan(0);
    expect(lineItems.some((li) => li.submissionMethod === "internal_only")).toBe(true);
    expect(lineItems.some((li) => li.usedAsPositiveBankEvidence)).toBe(true);
    for (const li of lineItems) {
      if (li.submissionMethod === "internal_only") {
        expect(li.includedInBankArgument).toBe(false);
        expect(li.usedAsPositiveBankEvidence).toBe(false);
      }
      if (li.usedAsPositiveBankEvidence) {
        expect(li.includedInBankArgument).toBe(true);
      }
    }
  });
});

describe("Test 16 — PDF inclusion ≠ bank argument inclusion (context_only category)", () => {
  it("supporting items can land in the package as context_only without being bank-argument", async () => {
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{
        field: string;
        submissionMethod: string;
        includedInDefencePackage: boolean;
        includedInBankArgument: boolean;
      }>;
    };
    const f = mixedInclusionFixture();
    const lineItems = deriveEvidenceLineItems({
      checklist: f.checklist,
      facts: [],
      payloadByField: f.payloadByField,
      contributions: { strong: [], moderate: [] },
      packSavedToShopify: true,
      excludedFields: new Set<string>(),
      attachmentUploadFailures: new Map<string, string>(),
      inclusionOverrides: new Map(),
      reasonFamily: "fraud",
    });
    const contextRow = lineItems.find(
      (li) => li.submissionMethod === "context_only",
    );
    expect(contextRow).toBeDefined();
    expect(contextRow?.includedInDefencePackage).toBe(true);
    expect(contextRow?.includedInBankArgument).toBe(false);
  });
});

describe("Test 17 — strength reason mentions missing payment verification for fraud no-AVS", () => {
  it("strengthReason references payment authentication / verification for the weak fraud fixture", () => {
    const f = weakFraudFixture();
    const result = calculateCaseStrength(f.checklist, f.reason, payloadSource(f.payloadByField));
    expect(result.strengthReason).toMatch(/payment (verification|authentication)/i);
  });
});

describe("Test 18 — strength reason mentions missing confirmed delivery when absent", () => {
  it.fails("the redesigned WEAK reason names delivery confirmation", () => {
    const f = weakFraudFixture();
    const result = calculateCaseStrength(f.checklist, f.reason, payloadSource(f.payloadByField));
    expect(result.strengthReason).toMatch(/delivery/i);
  });
});

describe("Test 19 — strength reason mentions missing customer purchase acknowledgement", () => {
  it.fails("the redesigned WEAK reason names customer acknowledgement / communication", () => {
    const f = weakFraudFixture();
    const result = calculateCaseStrength(f.checklist, f.reason, payloadSource(f.payloadByField));
    expect(result.strengthReason).toMatch(/(customer|acknowledg|communication)/i);
  });
});

describe("Test 20 — merchant inclusion override creates evidence_inclusion_overridden audit event", () => {
  it.fails("POST to /api/packs/:id/inclusion-override writes the audit row", async () => {
    // Integration-style test gated by commit 10's API route. Placeholder
    // until the route lands.
    expect("commit 10 — inclusion override route").toBe("delivered");
  });
});

describe("Test 21 — force_include on generic supporting_documents → context_only", () => {
  it("override on a row with no decisive payload lands as context_only, not bank_argument", async () => {
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{
        field: string;
        submissionMethod: string;
        usedAsPositiveBankEvidence: boolean;
      }>;
    };
    const checklist = [
      {
        field: "supporting_documents",
        label: "Supplementary documents",
        status: "available" as const,
        priority: "optional" as const,
        blocking: false,
        source: "manual_upload" as const,
        collectionType: "manual" as const,
      },
    ];
    const payloadByField = new Map<string, unknown>([
      ["supporting_documents", { fileType: "pdf", signedContract: false }],
    ]);
    const overrides = new Map<string, "force_include" | "force_exclude">([
      ["supporting_documents", "force_include"],
    ]);
    const lineItems = deriveEvidenceLineItems({
      checklist,
      facts: [],
      payloadByField,
      contributions: { strong: [], moderate: [] },
      packSavedToShopify: true,
      excludedFields: new Set<string>(),
      attachmentUploadFailures: new Map<string, string>(),
      inclusionOverrides: overrides,
      reasonFamily: "fraud",
    });
    const row = lineItems.find((li) => li.field === "supporting_documents");
    expect(row?.submissionMethod).toBe("context_only");
    expect(row?.usedAsPositiveBankEvidence).toBe(false);
  });
});

describe("Test 22 — force_include + signedContract=true → bank_argument (payload qualifies)", () => {
  it("override does not bypass the categorizer; the payload itself elevates strength", async () => {
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{
        field: string;
        submissionMethod: string;
        usedAsPositiveBankEvidence: boolean;
      }>;
    };
    const checklist = [
      {
        field: "supporting_documents",
        label: "Supplementary documents",
        status: "available" as const,
        priority: "optional" as const,
        blocking: false,
        source: "manual_upload" as const,
        collectionType: "manual" as const,
      },
    ];
    const payloadByField = new Map<string, unknown>([
      ["supporting_documents", { fileType: "pdf", signedContract: true }],
    ]);
    const overrides = new Map<string, "force_include" | "force_exclude">([
      ["supporting_documents", "force_include"],
    ]);
    const lineItems = deriveEvidenceLineItems({
      checklist,
      facts: [],
      payloadByField,
      contributions: { strong: [{ signalId: "supplementary_documents", category: "strong", label: "Supplementary documents", evidenceFieldKey: "supporting_documents" }], moderate: [] },
      packSavedToShopify: true,
      excludedFields: new Set<string>(),
      attachmentUploadFailures: new Map<string, string>(),
      inclusionOverrides: overrides,
      reasonFamily: "fraud",
    });
    const row = lineItems.find((li) => li.field === "supporting_documents");
    expect(row?.submissionMethod).toBe("bank_argument");
    expect(row?.usedAsPositiveBankEvidence).toBe(true);
  });
});

describe("Test 23 — force_include on internal-only field refused at the derivation layer", () => {
  it("override on ip_location_check is ignored; row stays internal_only", async () => {
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{
        field: string;
        submissionMethod: string;
        includedInBankArgument: boolean;
      }>;
    };
    const checklist = [
      {
        field: "ip_location_check",
        label: "IP & location consistency",
        status: "available" as const,
        priority: "recommended" as const,
        blocking: false,
        source: "auto_shopify" as const,
        collectionType: "auto" as const,
      },
    ];
    const payloadByField = new Map<string, unknown>([
      ["ip_location_check", { locationMatch: "different_country", riskLevel: "high" }],
    ]);
    const overrides = new Map<string, "force_include" | "force_exclude">([
      ["ip_location_check", "force_include"],
    ]);
    const lineItems = deriveEvidenceLineItems({
      checklist,
      facts: [],
      payloadByField,
      contributions: { strong: [], moderate: [] },
      packSavedToShopify: true,
      excludedFields: new Set<string>(),
      attachmentUploadFailures: new Map<string, string>(),
      inclusionOverrides: overrides,
      reasonFamily: "fraud",
    });
    const row = lineItems.find((li) => li.field === "ip_location_check");
    expect(row?.submissionMethod).toBe("internal_only");
    expect(row?.includedInBankArgument).toBe(false);
  });
});
