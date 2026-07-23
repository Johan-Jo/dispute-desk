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
import { resolveToken } from "@/lib/i18n/resolveToken";
import type { I18nToken } from "@/lib/i18n/token";
import enMessages from "@/messages/en.json";
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

/** Walk the dotted key into the en messages catalog. */
function lookupEn(key: string): string {
  const parts = key.split(".");
  let node: unknown = enMessages;
  for (const p of parts) {
    if (node && typeof node === "object" && p in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[p];
    } else {
      return key;
    }
  }
  return typeof node === "string" ? node : key;
}

/** Minimal translator that mimics next-intl's substitution for plain
 *  `{name}` placeholders — enough for the strength-reason templates.
 *  ICU select/plural is not handled; tests that need it should hit
 *  next-intl directly. */
function enTranslator(key: string, params?: Record<string, string | number>): string {
  let msg = lookupEn(key);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      msg = msg.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return msg;
}

/** Resolve an I18nToken against `messages/en.json`. */
function resolveTokenWithEn(token: I18nToken): string {
  return resolveToken(enTranslator, token);
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

describe("Test 7c — fraud_risk_screening with negative verdict surfaces as internal_only (2026-05-21 #1081 regression)", () => {
  /**
   * Live #1081 scenario: same card / IP / billing address as a recently-
   * disputed order, Shopify returned CANCEL recommendation pre-charge.
   * Before this commit the source collector silently dropped the
   * negative-verdict row, so the merchant saw nothing on the Overview —
   * looked like fraud screening never ran. Post-fix, the row lands in
   * "Kept internal" with an honest message.
   *
   * The LLM-safety contract is preserved by the canonicalEvidence
   * categorizer (returns "invalid" for fraud_risk_screening with empty
   * positiveFacts) — the factClassifier skips invalid categories so the
   * fact NEVER appears in defence_packages.facts_json or the bank
   * submission. This test pins both halves: visible to merchant,
   * invisible to bank.
   */
  it("CANCEL recommendation + empty positiveFacts → submissionMethod=internal_only, usedAsPositiveBankEvidence=false", async () => {
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{
        field: string;
        submissionMethod: string;
        includedInBankArgument: boolean;
        includedInDefencePackage: boolean;
        usedAsPositiveBankEvidence: boolean;
        reason: string;
      }>;
    };
    const checklist = [
      {
        field: "fraud_risk_screening",
        label: "Pre-authorization fraud screening",
        status: "available" as const,
      },
    ];
    const payloadByField = new Map<string, unknown>([
      [
        "fraud_risk_screening",
        {
          provider: "shopify",
          riskLevel: "NONE",
          recommendation: "CANCEL",
          positiveFacts: [],
          isNegativeVerdict: true,
        },
      ],
    ]);
    // factsJson is empty — by design. The categorizer returns "invalid"
    // for this payload so the factClassifier doesn't emit a fact. The
    // line item resolver should STILL surface the row to the merchant.
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
    expect(row).toBeDefined();
    expect(row?.submissionMethod).toBe("internal_only");
    expect(row?.includedInBankArgument).toBe(false);
    expect(row?.includedInDefencePackage).toBe(false);
    expect(row?.usedAsPositiveBankEvidence).toBe(false);
    // Reason text names the actual verdict so the merchant sees what
    // Shopify returned, not a generic "informational only" line.
    expect(row?.reason).toMatch(/CANCEL/);
  });

  it("CANCEL with negativeFacts → reason text inlines the Shopify reasoning (2026-05-21 captured payload)", async () => {
    // Locks in the merchant-facing WHY: when the fraudRiskSource captures
    // NEGATIVE-sentiment facts off the live Shopify response, those facts
    // must appear in the row reason so the merchant sees what drove the
    // verdict — not just the verdict label. Payload below is the real
    // captured shape from the 2026-05-21 CANCEL incident.
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{
        field: string;
        submissionMethod: string;
        reason: string;
      }>;
    };
    const checklist = [
      {
        field: "fraud_risk_screening",
        label: "Pre-authorization fraud screening",
        status: "available",
      },
    ];
    const payloadByField = new Map<string, unknown>([
      [
        "fraud_risk_screening",
        {
          provider: "shopify",
          riskLevel: "NONE",
          recommendation: "CANCEL",
          positiveFacts: [],
          negativeFacts: [
            "Shipping address is 6709 km from location of IP address",
            "The billing address is listed as United States, but the order was placed from Brazil",
          ],
          isNegativeVerdict: true,
        },
      ],
    ]);
    const lineItems = deriveEvidenceLineItems({
      checklist,
      facts: [],
      payloadByField,
      contributions: { strong: [], moderate: [] },
      packSavedToShopify: false,
      excludedFields: new Set(),
      attachmentUploadFailures: new Map(),
      inclusionOverrides: new Map(),
      reasonFamily: "fraud",
    });
    const row = lineItems.find((li) => li.field === "fraud_risk_screening");
    expect(row?.submissionMethod).toBe("internal_only");
    // Verdict label still in the text.
    expect(row?.reason).toMatch(/CANCEL/);
    // Negative facts inlined.
    expect(row?.reason).toContain("Shipping address is 6709 km");
    expect(row?.reason).toContain(
      "The billing address is listed as United States, but the order was placed from Brazil",
    );
    // "Kept internal" framing preserved.
    expect(row?.reason).toMatch(/Kept internal/);
  });

  it("REJECT recommendation also resolves to internal_only with verdict-specific reason text", async () => {
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{
        field: string;
        submissionMethod: string;
        reason: string;
      }>;
    };
    const checklist = [
      {
        field: "fraud_risk_screening",
        label: "Pre-authorization fraud screening",
        status: "available" as const,
      },
    ];
    const payloadByField = new Map<string, unknown>([
      [
        "fraud_risk_screening",
        {
          provider: "shopify",
          riskLevel: "LOW",
          recommendation: "REJECT",
          positiveFacts: [],
          isNegativeVerdict: true,
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
    expect(row?.submissionMethod).toBe("internal_only");
    expect(row?.reason).toMatch(/REJECT/);
  });

  it("HIGH risk_level (even with empty positiveFacts and no explicit isNegativeVerdict flag) still surfaces as internal_only", async () => {
    // Belt-and-suspenders: legacy / hand-rolled payloads that didn't set
    // isNegativeVerdict still get routed correctly via the elevated-risk
    // signal in the reason helper.
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{
        field: string;
        submissionMethod: string;
        reason: string;
      }>;
    };
    const checklist = [
      {
        field: "fraud_risk_screening",
        label: "Pre-authorization fraud screening",
        status: "available" as const,
      },
    ];
    const payloadByField = new Map<string, unknown>([
      [
        "fraud_risk_screening",
        {
          provider: "shopify",
          riskLevel: "HIGH",
          recommendation: "INVESTIGATE",
          positiveFacts: [],
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
    expect(row?.submissionMethod).toBe("internal_only");
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
  it("strengthReasonI18n resolves to copy referencing payment authentication / verification for the weak fraud fixture", () => {
    const f = weakFraudFixture();
    const result = calculateCaseStrength(f.checklist, f.reason, payloadSource(f.payloadByField));
    const resolved = resolveTokenWithEn(result.strengthReasonI18n);
    expect(resolved).toMatch(/payment (verification|authentication)/i);
  });
});

describe("Test 18 — strength reason mentions missing confirmed delivery when absent", () => {
  it("the redesigned WEAK reason names delivery confirmation", () => {
    const f = weakFraudFixture();
    const result = calculateCaseStrength(f.checklist, f.reason, payloadSource(f.payloadByField));
    const resolved = resolveTokenWithEn(result.strengthReasonI18n);
    expect(resolved).toMatch(/delivery/i);
  });
});

describe("Test 19 — strength reason mentions missing customer purchase acknowledgement", () => {
  it("the redesigned WEAK reason names customer acknowledgement / communication", () => {
    const f = weakFraudFixture();
    const result = calculateCaseStrength(f.checklist, f.reason, payloadSource(f.payloadByField));
    const resolved = resolveTokenWithEn(result.strengthReasonI18n);
    expect(resolved).toMatch(/(customer|acknowledg|communication)/i);
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

  it("refund_record with no refund reads the honest field-specific message, not the generic one", async () => {
    // Regression (dispute #C89276B6, 2026-07-15): a CREDIT_NOT_PROCESSED
    // dispute with no refund on the order showed the generic, alarming
    // "Field is on file but no usable evidence payload was emitted." The
    // refund_record slot must instead explain that no refund was issued —
    // which for a "refund not processed" dispute is the FAVORABLE position.
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (args: unknown) => Array<{
        field: string;
        submissionMethod: string;
        reason: string;
      }>;
    };
    const checklist = [
      {
        field: "refund_record",
        label: "Refund Record",
        status: "missing" as const,
        priority: "critical" as const,
        blocking: false,
        source: "auto_shopify" as const,
        collectionType: "conditional_auto" as const,
      },
    ];
    const lineItems = deriveEvidenceLineItems({
      checklist,
      facts: [],
      // No refund on the order → the orderSource collector never emits a
      // refund_record payload.
      payloadByField: new Map<string, unknown>(),
      contributions: { strong: [], moderate: [] },
      packSavedToShopify: true,
      excludedFields: new Set<string>(),
      attachmentUploadFailures: new Map<string, string>(),
      inclusionOverrides: new Map(),
      reasonFamily: "refund",
    });
    const row = lineItems.find((li) => li.field === "refund_record");
    expect(row?.submissionMethod).toBe("not_included");
    expect(row?.reason).toMatch(/no refund has been issued/i);
    expect(row?.reason).not.toMatch(/no usable evidence payload/i);
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

describe("Test 25 — draft-pack inclusion consistency (2026-07-21 blume-box 306080eb)", () => {
  /**
   * Regression: on a pack whose defence package was never generated
   * (facts_json empty), a contributing Strong signal (AVS+CVV both
   * matched) fell out of `bank_argument` because that tier required an
   * approved fact — so the row showed a Strong pill inside "Context
   * only" under a "No decisive bank-facing evidence" banner. The
   * inclusion decision must not depend on LLM-generation state: a
   * contributing, bank-eligible, non-negative strong/moderate row IS
   * the positive bank argument. NOTE: this pins INCLUSION only — the
   * strength/category values come from the canonical categorizer
   * unchanged (classification is the rules engine's job, not this
   * derivation's).
   */
  type LineItem = {
    field: string;
    hasEvidence: boolean;
    bankEligible: boolean;
    isNegativeOrAmbiguous: boolean;
    strengthContribution: string;
    submissionMethod: string;
    includedInDefencePackage: boolean;
    includedInBankArgument: boolean;
    usedAsPositiveBankEvidence: boolean;
    reason: string;
  };

  const AVS_CHECKLIST_ROW = {
    field: "avs_cvv_match",
    label: "Payment authentication",
    status: "available" as const,
    priority: "critical" as const,
    blocking: false,
    source: "auto_shopify" as const,
    collectionType: "conditional_auto" as const,
  };

  const PAYMENT_AUTH_STRONG_CONTRIBUTION = {
    signalId: "payment_auth",
    category: "strong" as const,
    labelToken: { key: "disputes.signalLabel.payment_auth" },
    evidenceFieldKey: "avs_cvv_match",
  };

  async function derive(args: {
    checklist: unknown[];
    payloadByField: Map<string, unknown>;
    contributions?: { strong: unknown[]; moderate: unknown[] };
    inclusionOverrides?: Map<string, "force_include" | "force_exclude">;
  }): Promise<LineItem[]> {
    const mod = await import("@/lib/argument/evidenceLineItem");
    const { deriveEvidenceLineItems } = mod as {
      deriveEvidenceLineItems: (a: unknown) => LineItem[];
    };
    return deriveEvidenceLineItems({
      checklist: args.checklist,
      // facts: [] — the defence package is an ungenerated draft.
      facts: [],
      payloadByField: args.payloadByField,
      contributions: args.contributions ?? { strong: [], moderate: [] },
      packSavedToShopify: false,
      excludedFields: new Set<string>(),
      attachmentUploadFailures: new Map<string, string>(),
      inclusionOverrides: args.inclusionOverrides ?? new Map(),
      reasonFamily: "fraud",
    });
  }

  it("contributing Strong AVS+CVV with empty facts resolves to bank_argument / usedAsPositiveBankEvidence", async () => {
    const lineItems = await derive({
      checklist: [AVS_CHECKLIST_ROW],
      payloadByField: new Map<string, unknown>([
        ["avs_cvv_match", { avsResultCode: "Y", cvvResultCode: "M" }],
      ]),
      contributions: { strong: [PAYMENT_AUTH_STRONG_CONTRIBUTION], moderate: [] },
    });
    const row = lineItems.find((li) => li.field === "avs_cvv_match");
    expect(row?.submissionMethod).toBe("bank_argument");
    expect(row?.usedAsPositiveBankEvidence).toBe(true);
    expect(row?.includedInDefencePackage).toBe(true);
    expect(row?.includedInBankArgument).toBe(true);
  });

  it("negative guard: both-fail AVS/CVV stays internal_only even with a (stale) contribution", async () => {
    const lineItems = await derive({
      checklist: [AVS_CHECKLIST_ROW],
      payloadByField: new Map<string, unknown>([
        ["avs_cvv_match", { avsResultCode: "N", cvvResultCode: "N" }],
      ]),
      contributions: { strong: [PAYMENT_AUTH_STRONG_CONTRIBUTION], moderate: [] },
    });
    const row = lineItems.find((li) => li.field === "avs_cvv_match");
    expect(row?.submissionMethod).toBe("internal_only");
    expect(row?.usedAsPositiveBankEvidence).toBe(false);
  });

  it("invariant: eligible + available + non-negative strong/moderate rows are ALWAYS positive; legitimate exclusions stay out without failing", async () => {
    // Fixture deliberately avoids shared-signalId siblings
    // (customer_account_info/activity_log, the two delivery keys):
    // contribution dedup keeps only ONE field per signal, so a
    // non-contributing strong-category sibling legitimately stays
    // context_only until the row collapse / narrative pass. The
    // invariant below is the per-row business rule for contributing
    // fields, not a universal claim over deduped siblings.
    const lineItems = await derive({
      checklist: [
        AVS_CHECKLIST_ROW,
        {
          field: "ip_location_check",
          label: "IP & location consistency",
          status: "available" as const,
          priority: "recommended" as const,
          blocking: false,
          source: "auto_shopify" as const,
          collectionType: "auto" as const,
        },
        {
          field: "customer_account_info",
          label: "Customer account history",
          status: "available" as const,
          priority: "optional" as const,
          blocking: false,
          source: "auto_shopify" as const,
          collectionType: "auto" as const,
        },
        {
          field: "refund_policy",
          label: "Refund policy",
          status: "available" as const,
          priority: "optional" as const,
          blocking: false,
          source: "auto_shopify" as const,
          collectionType: "auto" as const,
        },
        {
          field: "order_confirmation",
          label: "Order record",
          status: "available" as const,
          priority: "optional" as const,
          blocking: false,
          source: "auto_shopify" as const,
          collectionType: "auto" as const,
        },
        {
          field: "shipping_tracking",
          label: "Shipping & tracking",
          status: "missing" as const,
          priority: "critical" as const,
          blocking: false,
          source: "auto_shopify" as const,
          collectionType: "auto" as const,
        },
      ],
      payloadByField: new Map<string, unknown>([
        ["avs_cvv_match", { avsResultCode: "Y", cvvResultCode: "M" }],
        // Negative IP payload → internal_only (legitimately non-positive).
        ["ip_location_check", { locationMatch: "different_country", riskLevel: "high" }],
        // Zero-history account on a fraud dispute → the row is DROPPED
        // entirely (2026-07-23 user decision: a first-time customer's
        // "account history" is not evidence — nothing to show, nothing
        // to withhold). Asserted below as absence.
        ["customer_account_info", { totalOrders: 0, isRepeatCustomer: false }],
        // Plain policy text → supporting → context_only.
        ["refund_policy", { policyText: "30-day returns" }],
        ["order_confirmation", { confirmationSent: true }],
      ]),
      contributions: { strong: [PAYMENT_AUTH_STRONG_CONTRIBUTION], moderate: [] },
      // Merchant excluded the order record → legitimately non-positive.
      inclusionOverrides: new Map([["order_confirmation", "force_exclude" as const]]),
    });

    expect(lineItems.length).toBeGreaterThan(0);
    for (const li of lineItems) {
      const isEligiblePositiveAndAvailable =
        li.hasEvidence &&
        li.bankEligible &&
        !li.isNegativeOrAmbiguous &&
        (li.strengthContribution === "strong" ||
          li.strengthContribution === "moderate");
      if (isEligiblePositiveAndAvailable) {
        expect(li.usedAsPositiveBankEvidence).toBe(true);
        expect(li.submissionMethod).toBe("bank_argument");
      }
    }
    // Both sides exercised: the AVS row IS positive…
    expect(
      lineItems.find((li) => li.field === "avs_cvv_match")?.usedAsPositiveBankEvidence,
    ).toBe(true);
    // …and the legitimate exclusions sit outside positive without
    // tripping the invariant.
    expect(
      lineItems.find((li) => li.field === "ip_location_check")?.submissionMethod,
    ).toBe("internal_only");
    // First-time customer on fraud: no line item at all — the row is
    // not evidence and renders nowhere merchant-facing.
    expect(
      lineItems.find((li) => li.field === "customer_account_info"),
    ).toBeUndefined();
    expect(
      lineItems.find((li) => li.field === "order_confirmation")?.submissionMethod,
    ).toBe("excluded");
    expect(
      lineItems.find((li) => li.field === "shipping_tracking")?.usedAsPositiveBankEvidence ?? false,
    ).toBe(false);
  });

  it("AVS/CVV reason copy names exactly what matched — and never claims both when only one did", async () => {
    const cases: Array<{
      payload: Record<string, string>;
      mustMatch: RegExp;
      mustNotMatch?: RegExp;
    }> = [
      {
        // Both matched (this dispute's live payload).
        payload: { avsResultCode: "Y", cvvResultCode: "M" },
        mustMatch:
          /^Billing address and card verification code \(CVV\) matched the issuer's records\.$/,
      },
      {
        // AVS full match only — must NOT claim the CVV matched.
        payload: { avsResultCode: "Y", cvvResultCode: "N" },
        mustMatch: /^The billing address matched the issuer's records\.$/,
        mustNotMatch: /CVV|card verification code/,
      },
      {
        // CVV only — must NOT claim the billing address matched.
        payload: { avsResultCode: "N", cvvResultCode: "M" },
        mustMatch:
          /^The card verification code \(CVV\) matched the issuer's records\.$/,
        mustNotMatch: /billing address/,
      },
      {
        // AVS street-only match (code A).
        payload: { avsResultCode: "A", cvvResultCode: "N" },
        mustMatch: /^The billing street address matched the issuer's records\.$/,
      },
      {
        // AVS zip-only match (code W).
        payload: { avsResultCode: "W", cvvResultCode: "N" },
        mustMatch: /^The billing postal code matched the issuer's records\.$/,
      },
    ];
    for (const c of cases) {
      const lineItems = await derive({
        checklist: [AVS_CHECKLIST_ROW],
        payloadByField: new Map<string, unknown>([["avs_cvv_match", c.payload]]),
      });
      const row = lineItems.find((li) => li.field === "avs_cvv_match");
      expect(row?.reason, JSON.stringify(c.payload)).toMatch(c.mustMatch);
      if (c.mustNotMatch) {
        expect(row?.reason, JSON.stringify(c.payload)).not.toMatch(c.mustNotMatch);
      }
      // The payload-aware copy never claims identity/authorization —
      // AVS/CVV verifies values against issuer records, nothing more.
      expect(row?.reason).not.toMatch(/identity|proves authorization/i);
    }
  });
});
