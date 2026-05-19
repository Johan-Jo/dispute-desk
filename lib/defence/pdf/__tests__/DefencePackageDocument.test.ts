/**
 * Smoke test for the Defence Package document renderer.
 *
 * We don't snapshot the full PDF byte stream — that's noisy. Instead we:
 *   - render to Buffer
 *   - assert the buffer starts with the PDF magic header
 *   - assert the file is large enough to contain all rendered sections
 *
 * Phase 4: tests construct composedBlocks via composePdfBlocks() so the
 * renderer receives the same shape it gets in prod.
 */

import { describe, it, expect } from "vitest";
import { renderDefencePdf } from "../../renderDefencePdf";
import type {
  DefenceNarrativeOutput,
  EvidenceFact,
  ManualEvidenceRecord,
} from "../../types";
import type {
  DefencePackageDocumentData,
  DefencePackageMeta,
} from "../DefencePackageDocument";
import { composePdfBlocks } from "../composePdfBlocks";
import { THESIS_TEMPLATES } from "../thesisTemplates";
import {
  FORBIDDEN_PHRASES,
  NARROW_AGGRESSIVE_PHRASES,
} from "../../validateNarrative";

function defaultNarrative(): DefenceNarrativeOutput {
  return {
    executiveSummary: {
      text: "The available records support that the transaction was authorised by the cardholder.",
      usedFactIds: ["f0"],
    },
    transactionOverviewArgument: {
      text: "The transaction was processed on 2026-05-10 for the recorded amount.",
      usedFactIds: ["f0"],
    },
    chronologyArgument: { text: "", usedFactIds: [] },
    paymentAuthenticationArgument: {
      text: "AVS Y and CVV M results confirm the cardholder address and verification value at authorisation.",
      usedFactIds: ["f0"],
    },
    fulfillmentArgument: { text: "", usedFactIds: [] },
    communicationArgument: { text: "", usedFactIds: [] },
    policyArgument: { text: "", usedFactIds: [] },
    manualEvidenceArgument: { text: "", usedFactIds: [] },
    conclusion: {
      text: "The submitted evidence is consistent with an authorised transaction.",
      usedFactIds: ["f0"],
    },
    omittedSections: [
      { sectionKey: "chronologyArgument", reason: "no_chronology_facts" },
      { sectionKey: "fulfillmentArgument", reason: "no_delivery_facts" },
      { sectionKey: "communicationArgument", reason: "no_communication_facts" },
      { sectionKey: "policyArgument", reason: "no_policy_facts" },
      { sectionKey: "manualEvidenceArgument", reason: "no_manual_evidence" },
    ],
    warnings: [],
  };
}

function defaultMeta(): DefencePackageMeta {
  return {
    packageId: "pkg-1",
    disputeGid: "gid://shopify/Dispute/99",
    orderName: "#1042",
    reasonCode: "10.4",
    reasonCodeDisplay: "Visa 10.4 / Mastercard 4837",
    claimType: "Unauthorized transaction claim",
    shopName: "Acme Co",
    merchantName: "Acme Co LLC",
    amountDisplay: "USD 119.95",
    cardNetwork: "Visa",
    transactionDate: "2026-05-10T14:00:00Z",
    generatedAt: "2026-05-15T20:00:00Z",
    version: 1,
    packageMode: "full",
    promptVersion: 2,
    modelUsed: "claude-sonnet-4-6",
  };
}

function defaultApprovedFacts(): EvidenceFact[] {
  return [
    {
      id: "f0",
      category: "payment_authentication",
      label: "Payment authentication",
      value: { avsResult: "Y", cvvResult: "M" },
      source: "shopify_order",
      sourceRef: null,
      strength: "strong",
      bankEligible: true,
      merchantVisible: true,
      internalOnly: false,
      includeInBankNarrative: true,
      submissionRisk: false,
      confidence: null,
    },
  ];
}

interface SampleDataOverrides {
  meta?: Partial<DefencePackageMeta>;
  narrative?: DefenceNarrativeOutput;
  approvedFacts?: EvidenceFact[];
  manualEvidence?: ManualEvidenceRecord[];
}

function sampleData(overrides: SampleDataOverrides = {}): DefencePackageDocumentData {
  const meta = { ...defaultMeta(), ...(overrides.meta ?? {}) };
  const narrative = overrides.narrative ?? defaultNarrative();
  const approvedFacts = overrides.approvedFacts ?? defaultApprovedFacts();
  const manualEvidence = overrides.manualEvidence ?? [];
  const composedBlocks = composePdfBlocks({
    narrative,
    approvedFacts,
    packageMode: meta.packageMode,
    familyKey: "unauthorized_fraud",
    moduleKey: null,
    fulfillmentStatus: meta.fulfillmentStatus ?? null,
  });
  return { meta, composedBlocks, approvedFacts, manualEvidence };
}

describe("DefencePackageDocument", () => {
  it("renders to a valid PDF buffer", async () => {
    const result = await renderDefencePdf(sampleData());
    expect(result.contentType).toBe("application/pdf");
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.buffer.slice(0, 5).toString()).toBe("%PDF-");
  }, 30000);

  it("renders a non-trivial PDF in full packageMode", async () => {
    const result = await renderDefencePdf(sampleData());
    expect(result.buffer.length).toBeGreaterThan(2000);
    expect(result.buffer.slice(-10).toString()).toContain("%%EOF");
  }, 30000);

  it("renders in narrow packageMode without throwing", async () => {
    const result = await renderDefencePdf(
      sampleData({ meta: { packageMode: "narrow" } }),
    );
    expect(result.buffer.slice(0, 5).toString()).toBe("%PDF-");
  }, 30000);

  it("renders Package Metadata block when evidenceHash + generatedBy + promptFamily are present", async () => {
    const data = sampleData({
      meta: {
        reasonCodeModuleKey: "visa_10_4_fraud",
        promptFamily: "defence_package_narrative",
        evidenceHash: "deadbeefcafef00d0123456789abcdef",
        generatedBy: "system",
      },
    });
    const result = await renderDefencePdf(data);
    expect(result.buffer.slice(0, 5).toString()).toBe("%PDF-");
    expect(result.buffer.length).toBeGreaterThan(2000);
  }, 30000);

  it("renders SupportingEvidenceIndex empty-state when no manual evidence", async () => {
    const result = await renderDefencePdf(sampleData());
    expect(result.buffer.slice(0, 5).toString()).toBe("%PDF-");
  }, 30000);

  it("renders SupportingEvidenceIndex with manual evidence rows", async () => {
    const result = await renderDefencePdf(
      sampleData({
        manualEvidence: [
          {
            id: "m1",
            packageId: "pkg-1",
            evidenceItemId: "ei1",
            filename: "delivery-receipt.pdf",
            fileUrl: null,
            fileType: "application/pdf",
            uploadedBy: "merchant",
            uploadedAt: "2026-05-15T00:00:00Z",
            description: "Signed by customer at door",
            bankEligible: true,
            includeInPackage: true,
            includeInBankNarrative: true,
            evidenceCategory: "manual_evidence",
          },
        ],
      }),
    );
    expect(result.buffer.slice(0, 5).toString()).toBe("%PDF-");
    expect(result.buffer.length).toBeGreaterThan(2000);
  }, 30000);

  it("renders a Fulfillment minimal-fallback when the section is omitted + fulfillmentStatus=FULFILLED", async () => {
    const data = sampleData({
      meta: { fulfillmentStatus: "FULFILLED" },
    });
    // composePdfBlocks should have emitted a fulfillmentArgument block
    // with fallbackText set.
    const fulfillmentBlock = data.composedBlocks.find(
      (b) => b.sectionKey === "fulfillmentArgument",
    );
    expect(fulfillmentBlock).toBeDefined();
    expect(fulfillmentBlock?.fallbackText).toContain("fulfilled");
    const result = await renderDefencePdf(data);
    expect(result.buffer.slice(0, 5).toString()).toBe("%PDF-");
  }, 30000);

  // Phase-4 update of the P0 regression: every TEMPLATE body must pass
  // the same forbidden-phrase regex set the LLM output passes. The
  // composed-PDF validator catches drift at runtime; this static check
  // catches it at build time.
  describe("static thesis safety (P4 — template-level)", () => {
    const ALL_PATTERNS = [...FORBIDDEN_PHRASES, ...NARROW_AGGRESSIVE_PHRASES];

    it("THESIS_TEMPLATES entries contain no banned phrase", () => {
      for (const t of THESIS_TEMPLATES) {
        // Strip the templating grammar so we test the post-substitution
        // text shape. {{token}} and [[clause]] markers themselves aren't
        // banned phrases.
        const stripped = t.template.replace(/\{\{\w+\}\}/g, "TOKEN").replace(/\[\[|\]\]/g, "");
        for (const pattern of ALL_PATTERNS) {
          const match = stripped.match(pattern)?.[0];
          expect(
            match,
            `THESIS_TEMPLATES["${t.key}"] matched ${pattern}: "${match}"`,
          ).toBeUndefined();
        }
      }
    });

    it("THESIS_TEMPLATES entries contain no family-prohibited bank-framing phrase (v2.2+)", async () => {
      const { ALL_REASON_CODE_FAMILIES, getFamily } = await import(
        "../../reasonCodes/familyRegistry"
      );
      const familyKeys = new Set(ALL_REASON_CODE_FAMILIES.map((f) => f.key));
      for (const t of THESIS_TEMPLATES) {
        const stripped = t.template.replace(/\{\{\w+\}\}/g, "TOKEN").replace(/\[\[|\]\]/g, "");
        // A template tagged familyKey: "any" must satisfy every family's
        // hard list (it could be selected for any family). Templates
        // bound to a specific family only need to satisfy that family.
        const familiesToCheck = familyKeys.has(t.familyKey as never)
          ? [getFamily(t.familyKey as never)]
          : ALL_REASON_CODE_FAMILIES;
        for (const family of familiesToCheck) {
          for (const pattern of family.prohibitedBankPhrases) {
            const match = stripped.match(pattern)?.[0];
            expect(
              match,
              `THESIS_TEMPLATES["${t.key}"] (familyKey=${t.familyKey}) matched ${pattern} from family ${family.key}: "${match}"`,
            ).toBeUndefined();
          }
        }
      }
    });
  });

  describe("Case Details — v2.2 claim type", () => {
    it("renders without error when meta has both reasonCodeDisplay and claimType set", async () => {
      // PDF stream content is FlateDecode-compressed so we can't
      // substring-search the binary for labels. The structural
      // assertion below covers what we care about: the meta flows
      // through composePdfBlocks + renderer end-to-end and the PDF
      // signature is well-formed. The PDF unit tests upstream of this
      // file (CaseDetailsTable test would belong on a separate render
      // path that doesn't exist yet) cover the row-level shape.
      const result = await renderDefencePdf(
        sampleData({
          meta: {
            reasonCodeDisplay: "Visa 10.4 / Mastercard 4837",
            claimType: "Unauthorized transaction claim",
          },
        }),
      );
      expect(result.buffer.slice(0, 5).toString()).toBe("%PDF-");
      expect(result.buffer.length).toBeGreaterThan(2000);
    }, 30000);
  });

  it("renders with an empty omittedSections list (all sections present)", async () => {
    const narrative = defaultNarrative();
    const fullNarrative: DefenceNarrativeOutput = {
      ...narrative,
      chronologyArgument: { text: "Order placed, captured, fulfilled.", usedFactIds: ["f0"] },
      fulfillmentArgument: { text: "Delivery confirmed by carrier.", usedFactIds: ["f0"] },
      communicationArgument: { text: "Customer confirmed receipt by email.", usedFactIds: ["f0"] },
      policyArgument: { text: "Customer accepted policy at checkout.", usedFactIds: ["f0"] },
      manualEvidenceArgument: { text: "Merchant provided signed acknowledgement.", usedFactIds: ["f0"] },
      omittedSections: [],
    };
    const result = await renderDefencePdf(sampleData({ narrative: fullNarrative }));
    expect(result.buffer.slice(0, 5).toString()).toBe("%PDF-");
    expect(result.buffer.length).toBeGreaterThan(2000);
  }, 30000);
});
