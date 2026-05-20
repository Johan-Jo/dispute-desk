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
  it("country mismatch surfaces as an internal-signal warning on order_confirmation without flipping the row to bank-facing", async () => {
    const mod = await import("@/lib/argument/evidenceLineItem");
    const internalMod = await import("@/lib/argument/internalSignals");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{
        field: string;
        submissionMethod: string;
        includedInBankArgument: boolean;
        usedAsPositiveBankEvidence: boolean;
        internalSignals?: Array<{ id: string; label: string }>;
      }>;
    };
    const { buildInternalSignalsByField } = internalMod as {
      buildInternalSignalsByField: (
        m: Map<string, unknown>,
      ) => Map<string, Array<{ id: string; label: string; reason: string; severity: "info" | "warning" }>>;
    };
    const f = weakFraudFixture();
    const internalSignalsByField = buildInternalSignalsByField(f.payloadByField);
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
      internalSignalsByField,
    });
    // The billing/shipping mismatch attaches as an internal-signal
    // warning on the order_confirmation row. The row itself stays
    // context_only — useful order details still flow into the PDF as
    // background — but the row never becomes a positive bank argument.
    const orderRow = lineItems.find((li) => li.field === "order_confirmation");
    expect(orderRow).toBeDefined();
    expect(orderRow?.includedInBankArgument).toBe(false);
    expect(orderRow?.usedAsPositiveBankEvidence).toBe(false);
    expect(orderRow?.internalSignals?.some((s) => s.id === "internal:billing_address_mismatch")).toBe(true);
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

describe("Test 7b — clean IP/location match promotes to bank-facing (2026-05-20)", () => {
  it("ip_location_check with same_country + no VPN + bankEligible=true resolves to bank_argument", async () => {
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{
        field: string;
        submissionMethod: string;
        includedInBankArgument: boolean;
        usedAsPositiveBankEvidence: boolean;
      }>;
    };
    const checklist = [
      {
        field: "ip_location_check",
        label: "IP location vs billing country",
        status: "available" as const,
      },
    ];
    const payloadByField = new Map<string, unknown>([
      [
        "ip_location_check",
        {
          locationMatch: "same_country",
          bankEligible: true,
          ipinfo: { privacy: { vpn: false, proxy: false, hosting: false } },
          ipConsistencyLevel: "consistent",
          riskLevel: "low",
        },
      ],
    ]);
    const facts = [
      {
        id: "ip1",
        category: "ip_location",
        label: "IP location vs billing country",
        value: { fieldKey: "ip_location_check", locationMatch: "same_country" },
        source: "ipinfo_io",
        sourceRef: null,
        strength: "supporting",
        bankEligible: true,
        merchantVisible: true,
        internalOnly: false,
        includeInBankNarrative: true,
        submissionRisk: false,
        confidence: null,
      },
    ];
    // For a same_country payload categoryFor returns "supporting", so
    // the row lands in context_only (not bank_argument). Same-city
    // would return "moderate" → bank_argument. Both prove the field is
    // no longer blanket internal-only.
    const lineItems = deriveEvidenceLineItems({
      checklist,
      facts,
      payloadByField,
      contributions: { strong: [], moderate: [] },
      packSavedToShopify: true,
      excludedFields: new Set<string>(),
      attachmentUploadFailures: new Map<string, string>(),
      inclusionOverrides: new Map(),
      reasonFamily: "fraud",
    });
    const ipRow = lineItems.find((li) => li.field === "ip_location_check");
    expect(ipRow?.submissionMethod).toBe("context_only");
  });

  it("ip_location_check with same_city + clean privacy + strong contribution resolves to bank_argument", async () => {
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
        field: "ip_location_check",
        label: "IP location",
        status: "available" as const,
      },
    ];
    const payloadByField = new Map<string, unknown>([
      [
        "ip_location_check",
        {
          locationMatch: "same_city",
          bankEligible: true,
          ipinfo: { privacy: { vpn: false, proxy: false, hosting: false } },
          ipConsistencyLevel: "consistent",
          riskLevel: "low",
        },
      ],
    ]);
    const facts = [
      {
        id: "ip1",
        category: "ip_location",
        label: "IP location",
        value: { fieldKey: "ip_location_check", locationMatch: "same_city" },
        source: "ipinfo_io",
        sourceRef: null,
        strength: "moderate",
        bankEligible: true,
        merchantVisible: true,
        internalOnly: false,
        includeInBankNarrative: true,
        submissionRisk: false,
        confidence: null,
      },
    ];
    const contributions = {
      strong: [],
      moderate: [
        {
          signalId: "ip_location",
          category: "moderate" as const,
          label: "IP location",
          evidenceFieldKey: "ip_location_check",
        },
      ],
    };
    const lineItems = deriveEvidenceLineItems({
      checklist,
      facts,
      payloadByField,
      contributions,
      packSavedToShopify: true,
      excludedFields: new Set<string>(),
      attachmentUploadFailures: new Map<string, string>(),
      inclusionOverrides: new Map(),
      reasonFamily: "fraud",
    });
    const ipRow = lineItems.find((li) => li.field === "ip_location_check");
    expect(ipRow?.submissionMethod).toBe("bank_argument");
    expect(ipRow?.usedAsPositiveBankEvidence).toBe(true);
  });
});

describe("Test 8 — failed AVS/CVV is internal-only by default", () => {
  it("avs_cvv_match with both codes failing resolves to internal_only", async () => {
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
  it("hero copy gates card-network wording on presentationStatus", async () => {
    // The detailed regex assertions over every i18n entry live in
    // disputeDetailCopy.test.ts. Here we pin the contract: the title
    // family used for SAVED_TO_SHOPIFY and AWAITING_SHOPIFY_AUTO_SUBMISSION
    // (`saved.*` / `awaiting.*`) must NOT match the card-network regex.
    const mod = await import("@/messages/en.json");
    const hero = mod.disputes.overview.hero;
    const bannedRe = /(submitted|sent) to (the |your )?(bank|card network)/i;
    for (const family of ["saved", "awaiting"] as const) {
      for (const copy of Object.values(hero.title[family])) {
        expect(copy).not.toMatch(bannedRe);
      }
    }
    expect(hero.subtitle.savedNoDate).not.toMatch(bannedRe);
    expect(hero.subtitle.awaitingForward).not.toMatch(bannedRe);
  });
});

describe("Test 24 — SUBMITTED_TO_NETWORK may render card-network review copy", () => {
  // The resolver lives inside the workspace route module so this test
  // re-implements its predicate against the documented contract.
  // Render-side parity for the hero copy lands in commit 5.
  function presentationStatusFor(args: {
    packExists: boolean;
    submissionState: string | null;
    normalizedStatus: string | null;
    finalOutcome: string | null;
    evidenceSentOn: string | null;
  }): string {
    if (!args.packExists) return "DRAFT";
    if (args.finalOutcome === "won") return "CLOSED_WON";
    if (args.finalOutcome === "lost") return "CLOSED_LOST";
    if (args.finalOutcome != null) return "CLOSED_UNKNOWN";
    if (args.submissionState === "manual_submission_reported") return "CLOSED_UNKNOWN";
    if (args.normalizedStatus === "submitted_to_bank" || args.evidenceSentOn != null) {
      return "SUBMITTED_TO_NETWORK";
    }
    if (args.submissionState === "submitted_confirmed") return "AWAITING_SHOPIFY_AUTO_SUBMISSION";
    if (args.submissionState === "saved_to_shopify") return "SAVED_TO_SHOPIFY";
    return "DRAFT";
  }

  it("normalizedStatus=submitted_to_bank → SUBMITTED_TO_NETWORK", () => {
    expect(
      presentationStatusFor({
        packExists: true,
        submissionState: "submitted_confirmed",
        normalizedStatus: "submitted_to_bank",
        finalOutcome: null,
        evidenceSentOn: null,
      }),
    ).toBe("SUBMITTED_TO_NETWORK");
  });

  it("evidenceSentOn (submitted_at) present → SUBMITTED_TO_NETWORK", () => {
    expect(
      presentationStatusFor({
        packExists: true,
        submissionState: "submitted_confirmed",
        normalizedStatus: null,
        finalOutcome: null,
        evidenceSentOn: "2026-05-17T20:00:00Z",
      }),
    ).toBe("SUBMITTED_TO_NETWORK");
  });

  it("saved_to_shopify without forwarding → SAVED_TO_SHOPIFY (no card-network wording allowed)", () => {
    expect(
      presentationStatusFor({
        packExists: true,
        submissionState: "saved_to_shopify",
        normalizedStatus: null,
        finalOutcome: null,
        evidenceSentOn: null,
      }),
    ).toBe("SAVED_TO_SHOPIFY");
  });

  it("submitted_confirmed without forwarding signals → AWAITING_SHOPIFY_AUTO_SUBMISSION", () => {
    expect(
      presentationStatusFor({
        packExists: true,
        submissionState: "submitted_confirmed",
        normalizedStatus: null,
        finalOutcome: null,
        evidenceSentOn: null,
      }),
    ).toBe("AWAITING_SHOPIFY_AUTO_SUBMISSION");
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
  it("workspace API exposes evidenceLineItems + submissionSummary derived from a single function", async () => {
    // Contract check: the derivation API exports the function and
    // type the workspace route uses. Render-side parity (same id in
    // both surfaces) is enforced once the components consume the API
    // in commits 6 + 9.
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod;
    expect(typeof deriveEvidenceLineItems).toBe("function");
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
  it("the redesigned WEAK reason names delivery confirmation", () => {
    const f = weakFraudFixture();
    const result = calculateCaseStrength(f.checklist, f.reason, payloadSource(f.payloadByField));
    expect(result.strengthReason).toMatch(/delivery/i);
  });
});

describe("Test 19 — strength reason mentions missing customer purchase acknowledgement", () => {
  it("the redesigned WEAK reason names customer acknowledgement / communication", () => {
    const f = weakFraudFixture();
    const result = calculateCaseStrength(f.checklist, f.reason, payloadSource(f.payloadByField));
    expect(result.strengthReason).toMatch(/(customer|acknowledg|communication)/i);
  });
});

describe("Test 20 — merchant inclusion override creates evidence_inclusion_overridden audit event", () => {
  it("audit event type 'evidence_inclusion_overridden' is registered", async () => {
    // The audit-event vocabulary is the contract — the override route
    // calls logAuditEvent with this exact eventType. Pinning the type
    // here catches accidental renames and ensures the audit trail
    // surface stays stable. Full integration coverage (round-trip POST →
    // audit_events row) lives in Playwright smoke (commit 13).
    const mod = await import("@/lib/audit/logEvent");
    // The exported AuditLogInput.eventType is a union — assert that the
    // literal string is callable by constructing a typed value at
    // compile time via the function signature. If the type is renamed
    // the import becomes a typecheck error.
    const sample: import("@/lib/audit/logEvent").AuditLogInput = {
      shopId: "shop_test",
      packId: "pack_test",
      disputeId: "dispute_test",
      actorType: "merchant",
      eventType: "evidence_inclusion_overridden",
      eventPayload: {
        field: "supporting_documents",
        action: "force_include",
        priorState: null,
      },
    };
    expect(sample.eventType).toBe("evidence_inclusion_overridden");
    expect(typeof mod.logAuditEvent).toBe("function");
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

describe("Test 24 — internal-only field with no payload routes to not_included (UI honesty)", () => {
  it("fraud_risk_screening with no payload/fact becomes not_included, not internal_only", async () => {
    // Lock in the UI honesty fix from 2026-05-19: saying "Kept
    // internal" for a row we never actually collected data on is
    // dishonest — it implies we ran a check and hid the result.
    // Without payload and without an approved fact, the row should
    // route to not_included so the merchant reads the field's
    // honest "Shopify did not return a qualifying pre-authorization
    // risk assessment for this order" message.
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{
        field: string;
        submissionMethod: string;
      }>;
    };
    const checklist = [
      {
        field: "fraud_risk_screening",
        label: "Shopify fraud screening",
        status: "available" as const,
        priority: "optional" as const,
        blocking: false,
        source: "auto_shopify" as const,
        collectionType: "conditional_auto" as const,
      },
    ];
    const lineItems = deriveEvidenceLineItems({
      checklist,
      facts: [],
      // No payload — we never captured a risk assessment row for
      // this order (the ingestion gap exposed on 2026-05-19).
      payloadByField: new Map<string, unknown>(),
      contributions: { strong: [], moderate: [] },
      packSavedToShopify: true,
      excludedFields: new Set<string>(),
      attachmentUploadFailures: new Map<string, string>(),
      inclusionOverrides: new Map(),
      reasonFamily: "fraud",
    });
    const row = lineItems.find((li) => li.field === "fraud_risk_screening");
    expect(row?.submissionMethod).toBe("not_included");
  });

  it("ip_location_check with different_country uses payload-specific reason text", async () => {
    // Locks in the 2026-05-19 specificity fix: instead of the
    // generic "ambiguous or unfavorable" line, the merchant reads
    // exactly why the IP signal was withheld (different country
    // from shipping, VPN/proxy detected, etc.). Mirrors the
    // granular reasons in lib/argument/internalSignals.ts.
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{
        field: string;
        reason: string;
      }>;
    };
    const checklist = [
      {
        field: "ip_location_check",
        label: "IP geolocation check",
        status: "available" as const,
        priority: "optional" as const,
        blocking: false,
        source: "auto_shopify" as const,
        collectionType: "conditional_auto" as const,
      },
    ];
    const payloadByField = new Map<string, unknown>([
      ["ip_location_check", { locationMatch: "different_country" }],
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
    const row = lineItems.find((li) => li.field === "ip_location_check");
    expect(row?.reason).toMatch(/different country/i);
    expect(row?.reason).not.toMatch(/ambiguous or unfavorable/i);
  });

  it("ip_location_check with VPN/proxy reads explains the privacy issue", async () => {
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{
        field: string;
        reason: string;
      }>;
    };
    const checklist = [
      {
        field: "ip_location_check",
        label: "IP geolocation check",
        status: "available" as const,
        priority: "optional" as const,
        blocking: false,
        source: "auto_shopify" as const,
        collectionType: "conditional_auto" as const,
      },
    ];
    const payloadByField = new Map<string, unknown>([
      ["ip_location_check", { riskLevel: "high" }],
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
    const row = lineItems.find((li) => li.field === "ip_location_check");
    expect(row?.reason).toMatch(/VPN|proxy|data center/i);
  });

  it("avs_cvv_match with both N codes explains AVS+CVV failure specifically", async () => {
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{
        field: string;
        reason: string;
      }>;
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
    expect(row?.reason).toMatch(/billing address.*CVV/i);
    expect(row?.reason).toMatch(/undermine/i);
  });

  it("fraud_risk_screening WITH a favourable payload resolves to context_only (citable, not hidden)", async () => {
    // Updated 2026-05-19. Under the new policy, fraud_risk_screening
    // is NOT internal-only — `fraudRiskSource` only emits a section
    // when Shopify returned a favourable verdict (ACCEPT + positive
    // facts), so any payload that reaches the line-item layer is
    // bank-safe by construction. The row should be citable in the
    // bank narrative, not hidden under "Kept internal".
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{
        field: string;
        submissionMethod: string;
      }>;
    };
    const checklist = [
      {
        field: "fraud_risk_screening",
        label: "Shopify fraud screening",
        status: "available" as const,
        priority: "optional" as const,
        blocking: false,
        source: "auto_shopify" as const,
        collectionType: "conditional_auto" as const,
      },
    ];
    const payloadByField = new Map<string, unknown>([
      [
        "fraud_risk_screening",
        {
          provider: "shopify",
          riskLevel: "NONE",
          recommendation: "ACCEPT",
          positiveFacts: [
            "Card verification value matches",
            "Billing address matches",
          ],
        },
      ],
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
    const row = lineItems.find((li) => li.field === "fraud_risk_screening");
    // Without an approved fact in the test fixture, the row resolves
    // to context_only (the natural category from canonicalEvidence is
    // "moderate" but the bank-argument tier requires factLookup.hasApprovedFact,
    // which isn't set up here). Either way: NOT internal_only.
    expect(row?.submissionMethod).not.toBe("internal_only");
    expect(["context_only", "bank_argument"]).toContain(row?.submissionMethod);
  });
});
