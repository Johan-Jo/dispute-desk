import { describe, it, expect } from "vitest";
import { validateNarrative } from "../validateNarrative";
import { resolveReasonCodeModule } from "../reasonCodes/registry";
import type {
  DefenceNarrativeOutput,
  EvidenceFact,
  NarrativeSection,
  NarrativeSectionKey,
  ValidationError,
} from "../types";

function emptySection(): NarrativeSection {
  return { text: "", usedFactIds: [] };
}

function narrative(overrides: Partial<Record<NarrativeSectionKey, NarrativeSection>> = {}): DefenceNarrativeOutput {
  const SECTION_KEYS: NarrativeSectionKey[] = [
    "executiveSummary",
    "transactionOverviewArgument",
    "chronologyArgument",
    "paymentAuthenticationArgument",
    "fulfillmentArgument",
    "communicationArgument",
    "policyArgument",
    "manualEvidenceArgument",
    "conclusion",
  ];
  const sections = Object.fromEntries(
    SECTION_KEYS.map((k) => [k, overrides[k] ?? emptySection()]),
  ) as Record<NarrativeSectionKey, NarrativeSection>;

  // Add omittedSections for every empty section so we don't trip
  // omitted_section_inconsistent in tests that aren't about that rule.
  const omittedSections = SECTION_KEYS.filter((k) => !sections[k].text)
    .map((sectionKey) => ({ sectionKey, reason: "test_empty" }));

  return { ...sections, omittedSections, warnings: [] };
}

function fact(overrides: Partial<EvidenceFact> = {}): EvidenceFact {
  return {
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
    ...overrides,
  };
}

const reasonCodeModule = resolveReasonCodeModule("10.4");

describe("validateNarrative", () => {
  it("passes on a clean narrative", () => {
    const result = validateNarrative({
      narrative: narrative({
        executiveSummary: {
          text: "The available records support that the transaction was authorised.",
          usedFactIds: ["f0"],
        },
      }),
      approvedFacts: [fact()],
      reasonCodeModule,
      packageMode: "full",
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it.each([
    "definitive proof",
    "this is irrefutable",
    "undeniable evidence",
    "provably authentic",
    "the fraudulent cardholder",
    "the customer is lying",
    // Absolute authorization conclusions (§2 refinement)
    "establishes that the transaction was authorized",
    "establishes that the transaction was authorised",
    "proves the transaction was authorized",
    "confirms the transaction was authorized",
    "definitively shows authorization",
    "this definitively proves the cardholder authorised it",
    // Physical-card-possession claims (§3 refinement)
    "possession of the physical card",
    "the cardholder had the physical card",
    "they held the card at the time of purchase",
    "the card was physically present",
  ])("rejects forbidden phrase %s", (text) => {
    const result = validateNarrative({
      narrative: narrative({
        executiveSummary: { text, usedFactIds: ["f0"] },
      }),
      approvedFacts: [fact()],
      reasonCodeModule,
      packageMode: "full",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: ValidationError) => e.rule === "forbidden_phrase")).toBe(true);
  });

  it.each([
    "strongly supports that the transaction was authorized by the cardholder",
    "is consistent with a cardholder-authorized transaction",
    "supports the conclusion that the transaction was authorized",
    "contradicts the claim of an unauthorized transaction",
    "had access to card verification credentials and billing details associated with the cardholder account",
    "provided verification details that matched issuer records",
  ])("permits softened phrasing %s", (text) => {
    const result = validateNarrative({
      narrative: narrative({
        executiveSummary: { text, usedFactIds: ["f0"] },
      }),
      approvedFacts: [fact()],
      reasonCodeModule,
      packageMode: "full",
    });
    expect(result.errors.some((e: ValidationError) => e.rule === "forbidden_phrase")).toBe(false);
  });

  it("rejects narrow-mode aggressive conclusions", () => {
    const result = validateNarrative({
      narrative: narrative({
        conclusion: { text: "The dispute is invalid based on the records.", usedFactIds: ["f0"] },
      }),
      approvedFacts: [fact()],
      reasonCodeModule,
      packageMode: "narrow",
    });
    expect(
      result.errors.some((e) => e.rule === "narrow_mode_aggressive_conclusion"),
    ).toBe(true);
  });

  it("rejects unknown fact ids in usedFactIds", () => {
    const result = validateNarrative({
      narrative: narrative({
        executiveSummary: {
          text: "Some text.",
          usedFactIds: ["f99"],
        },
      }),
      approvedFacts: [fact({ id: "f0" })],
      reasonCodeModule,
      packageMode: "full",
    });
    expect(result.errors.some((e) => e.rule === "unknown_fact_id")).toBe(true);
  });

  it("rejects citation of internal-only fact ids", () => {
    const result = validateNarrative({
      narrative: narrative({
        executiveSummary: { text: "Some text.", usedFactIds: ["ip0"] },
      }),
      approvedFacts: [fact()],
      reasonCodeModule,
      packageMode: "full",
      internalOnlyFactIds: ["ip0"],
    });
    expect(
      result.errors.some((e) => e.rule === "internal_only_fact_referenced"),
    ).toBe(true);
  });

  it("rejects unsupported delivery claim via claim guards", () => {
    const result = validateNarrative({
      narrative: narrative({
        fulfillmentArgument: { text: "The package was delivered to the customer.", usedFactIds: ["f0"] },
      }),
      approvedFacts: [fact()],
      reasonCodeModule,
      packageMode: "full",
    });
    expect(result.errors.some((e) => e.rule === "unsupported_claim")).toBe(true);
  });

  // ── PR-C1: structural claim authorization ──────────────────────────
  //
  // These run through the SAME validator the build job calls, so a failure
  // here inherits the existing behaviour: one bounded repair attempt with the
  // errors fed back, then `status: "failed"` and no filing.

  it("rejects an affirmative address-delivery claim — no case holds that capability", () => {
    const result = validateNarrative({
      narrative: narrative({
        fulfillmentArgument: {
          text: "The parcel was delivered to the cardholder's verified address on 12 May 2026.",
          usedFactIds: ["f0"],
        },
      }),
      approvedFacts: [
        fact({ id: "f0", category: "delivery_proof", value: { proofType: "signature_confirmed", signedByName: "R. P." } }),
      ],
      reasonCodeModule,
      packageMode: "full",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === "unauthorized_claim")).toBe(true);
  });

  it("rejects a paraphrase no historical regex covered", () => {
    const result = validateNarrative({
      narrative: narrative({
        fulfillmentArgument: {
          text: "The consignment reached the customer's residence, matching the billing details on record.",
          usedFactIds: ["f0"],
        },
      }),
      approvedFacts: [
        fact({ id: "f0", category: "delivery_proof", value: { proofType: "delivered_confirmed" } }),
      ],
      reasonCodeModule,
      packageMode: "full",
    });
    expect(result.errors.some((e) => e.rule === "unauthorized_claim")).toBe(true);
  });

  it("rejects ambiguous address-delivery language — fails closed", () => {
    const result = validateNarrative({
      narrative: narrative({
        fulfillmentArgument: { text: "Delivery to the customer's address.", usedFactIds: ["f0"] },
      }),
      approvedFacts: [
        fact({ id: "f0", category: "delivery_proof", value: { proofType: "delivered_confirmed" } }),
      ],
      reasonCodeModule,
      packageMode: "full",
    });
    expect(result.errors.some((e) => e.rule === "unauthorized_claim")).toBe(true);
  });

  it("ACCEPTS properly licensed delivery and signature wording", () => {
    const result = validateNarrative({
      narrative: narrative({
        fulfillmentArgument: {
          text:
            "The carrier confirmed delivery of the shipment on 12 May 2026 " +
            "(PostNord, tracking 1234567890). The carrier recorded a signature on delivery.",
          usedFactIds: ["f0"],
        },
      }),
      approvedFacts: [
        fact({
          id: "f0",
          category: "delivery_proof",
          value: { proofType: "signature_confirmed", signedByName: "R. P.", carrier: "PostNord" },
        }),
      ],
      reasonCodeModule,
      packageMode: "full",
    });
    expect(result.errors.some((e) => e.rule === "unauthorized_claim")).toBe(false);
  });

  it("does not fire on negated or prohibition language", () => {
    const result = validateNarrative({
      narrative: narrative({
        fulfillmentArgument: {
          text: "We do not claim the parcel was delivered to the cardholder's address.",
          usedFactIds: ["f0"],
        },
      }),
      approvedFacts: [
        fact({ id: "f0", category: "delivery_proof", value: { proofType: "delivered_confirmed" } }),
      ],
      reasonCodeModule,
      packageMode: "full",
    });
    expect(result.errors.some((e) => e.rule === "unauthorized_claim")).toBe(false);
  });

  it("rejects an empty section that's not in omittedSections", () => {
    const result = validateNarrative({
      narrative: {
        executiveSummary: { text: "", usedFactIds: [] },
        transactionOverviewArgument: { text: "Text.", usedFactIds: ["f0"] },
        chronologyArgument: { text: "Text.", usedFactIds: ["f0"] },
        paymentAuthenticationArgument: { text: "Text.", usedFactIds: ["f0"] },
        fulfillmentArgument: { text: "Text.", usedFactIds: ["f0"] },
        communicationArgument: { text: "Text.", usedFactIds: ["f0"] },
        policyArgument: { text: "Text.", usedFactIds: ["f0"] },
        manualEvidenceArgument: { text: "Text.", usedFactIds: ["f0"] },
        conclusion: { text: "Text.", usedFactIds: ["f0"] },
        omittedSections: [],
        warnings: [],
      },
      approvedFacts: [fact()],
      reasonCodeModule,
      packageMode: "full",
    });
    expect(
      result.errors.some((e) => e.rule === "omitted_section_inconsistent"),
    ).toBe(true);
  });

  it("rejects a non-empty section that IS in omittedSections", () => {
    const result = validateNarrative({
      narrative: {
        executiveSummary: { text: "Should not be here.", usedFactIds: ["f0"] },
        transactionOverviewArgument: { text: "Text.", usedFactIds: ["f0"] },
        chronologyArgument: { text: "Text.", usedFactIds: ["f0"] },
        paymentAuthenticationArgument: { text: "Text.", usedFactIds: ["f0"] },
        fulfillmentArgument: { text: "Text.", usedFactIds: ["f0"] },
        communicationArgument: { text: "Text.", usedFactIds: ["f0"] },
        policyArgument: { text: "Text.", usedFactIds: ["f0"] },
        manualEvidenceArgument: { text: "Text.", usedFactIds: ["f0"] },
        conclusion: { text: "Text.", usedFactIds: ["f0"] },
        omittedSections: [{ sectionKey: "executiveSummary", reason: "test" }],
        warnings: [],
      },
      approvedFacts: [fact()],
      reasonCodeModule,
      packageMode: "full",
    });
    expect(
      result.errors.some((e) => e.rule === "omitted_section_inconsistent"),
    ).toBe(true);
  });

  describe("v2.2 — family-level phrase lists", () => {
    const EXTRA_HARD = [/\bcard\s*absent\b/i];
    const GUARDED = [
      { pattern: /\bonline\s+transaction\b/i, requires: "transaction_channel_online_present" as const },
    ];
    function orderRecord(channel: string | null): EvidenceFact {
      return fact({
        id: "f1",
        category: "order_record",
        label: "Order record",
        value: { channel, fieldKey: "order_confirmation" },
      });
    }

    it("extraHardPhrases match → reports forbidden_phrase with the narrative layer tag", () => {
      const result = validateNarrative({
        narrative: narrative({
          transactionOverviewArgument: {
            text: "This was a card absent purchase.",
            usedFactIds: ["f0"],
          },
        }),
        approvedFacts: [fact()],
        reasonCodeModule,
        packageMode: "full",
        extraHardPhrases: EXTRA_HARD,
      });
      const hit = result.errors.find((e: ValidationError) => e.rule === "forbidden_phrase");
      expect(hit).toBeDefined();
      expect(hit?.evidenceText?.toLowerCase()).toContain("card absent");
      expect(hit?.layer).toBe("narrative");
    });

    it("extraHardPhrases absent → behaviour unchanged (no error)", () => {
      const result = validateNarrative({
        narrative: narrative({
          transactionOverviewArgument: {
            text: "This was a card absent purchase.",
            usedFactIds: ["f0"],
          },
        }),
        approvedFacts: [fact()],
        reasonCodeModule,
        packageMode: "full",
        // no extraHardPhrases
      });
      expect(result.errors.some((e: ValidationError) => e.evidenceText?.toLowerCase().includes("card absent"))).toBe(false);
    });

    it("guardedPhrases match AND predicate true (channel=web) → no error", () => {
      const result = validateNarrative({
        narrative: narrative({
          transactionOverviewArgument: {
            text: "The merchant processed this as an online transaction.",
            usedFactIds: ["f0"],
          },
        }),
        approvedFacts: [fact(), orderRecord("web")],
        reasonCodeModule,
        packageMode: "full",
        guardedPhrases: GUARDED,
      });
      expect(result.errors.some((e: ValidationError) => e.evidenceText?.toLowerCase().includes("online transaction"))).toBe(false);
    });

    it("guardedPhrases match AND predicate false (channel=pos) → forbidden_phrase with requiredFact set", () => {
      const result = validateNarrative({
        narrative: narrative({
          transactionOverviewArgument: {
            text: "The merchant processed this as an online transaction.",
            usedFactIds: ["f0"],
          },
        }),
        approvedFacts: [fact(), orderRecord("pos")],
        reasonCodeModule,
        packageMode: "full",
        guardedPhrases: GUARDED,
      });
      const hit = result.errors.find(
        (e: ValidationError) => e.evidenceText?.toLowerCase().includes("online transaction"),
      );
      expect(hit).toBeDefined();
      expect(hit?.rule).toBe("forbidden_phrase");
      expect(hit?.requiredFact).toBe("transaction_channel_online_present");
    });

    it("guardedPhrases does not match → no error regardless of predicate", () => {
      const result = validateNarrative({
        narrative: narrative({
          transactionOverviewArgument: {
            text: "The order was placed through the merchant's store.",
            usedFactIds: ["f0"],
          },
        }),
        approvedFacts: [fact()],
        reasonCodeModule,
        packageMode: "full",
        guardedPhrases: GUARDED,
      });
      expect(result.errors.length).toBe(0);
    });
  });
});
