import { describe, it, expect } from "vitest";
import enMessages from "@/messages/en.json";

describe("Setup coverage and activate i18n keys", () => {
  const setup = (enMessages as Record<string, unknown>).setup as Record<string, unknown>;

  describe("setup.coverage namespace", () => {
    const coverage = setup?.coverage as Record<string, string> | undefined;

    it("exists", () => {
      expect(coverage).toBeDefined();
    });

    const requiredKeys = [
      "title",
      "subtitle",
      "summaryTitle",
      "summarySubtitle",
      "statAutomated",
      "statReview",
      "statNotify",
      "colDisputeType",
      "colHandling",
      "colAutomation",
      "colConfidence",
      "modeAutomated",
      "modeReview",
      "modeNotify",
      "confidence_high",
      "confidence_medium",
      "confidence_low",
      "noteLabel",
      "noteText",
      "installingSaving",
      "loading",
      "family_fraud",
      "family_pnr",
      "family_not_as_described",
      "family_subscription",
      "family_refund",
      "family_duplicate",
      "family_digital",
      "family_general",
    ];

    it.each(requiredKeys)("has key: %s", (key) => {
      expect(coverage?.[key]).toBeDefined();
      expect(typeof coverage?.[key]).toBe("string");
    });
  });

  describe("setup.activate namespace", () => {
    const activate = setup?.activate as Record<string, string> | undefined;

    it("exists", () => {
      expect(activate).toBeDefined();
    });

    // Keys actually referenced by components/setup/steps/ActivateStep.tsx
    // in its current form. The flow was refactored from an
    // "evidenceSummary / coverageSummary / automationSummary" layout
    // to a "stat<Thing>Label / stat<Thing>Desc" grid, but this test
    // was never updated — causing the 6 pre-existing failures noted
    // in the codebase audit. Keys below mirror the actual t() calls.
    const requiredKeys = [
      "title",
      "subtitle",
      "statCoverageLabel",
      "statCoverageDesc",
      "statAutomatedLabel",
      "statAutomatedDesc",
      "statReviewLabel",
      "statReviewDesc",
      "statThresholdLabel",
      "statThresholdDesc",
      "nextTitle",
      "readyTitle",
      "readyDesc",
      "loading",
    ];

    it.each(requiredKeys)("has key: %s", (key) => {
      expect(activate?.[key]).toBeDefined();
      expect(typeof activate?.[key]).toBe("string");
    });
  });

  describe("setup.storeProfile namespace (slimmed)", () => {
    // Onboarding-step keys after the slim-down: store type + proof levels +
    // summary card. Per-source evidence dropdowns and the "Other evidence"
    // section were removed — defaults are derived silently via
    // `getDefaultEvidenceConfig()` on save.
    const profile = setup?.storeProfile as Record<string, string> | undefined;

    const requiredKeys = [
      "title",
      "subtitle",
      "whatDoYouSell",
      "sellHint",
      "physical",
      "digital",
      "services",
      "subscriptions",
      "deliveryProof",
      "deliveryAlways",
      "deliveryAlwaysDesc",
      "deliverySometimes",
      "deliverySometimesDesc",
      "deliveryRarely",
      "deliveryRarelyDesc",
      "deliveryHint",
      "digitalProof",
      "digitalYes",
      "digitalSometimes",
      "digitalNo",
      "digitalHint",
      "summaryTitle",
      "summaryStoreType",
      "summaryShipping",
      "summaryDigital",
      "summaryFooter",
      "coverageStrong",
      "coverageGood",
      "coverageBasic",
      "coverageEnhanced",
      "coverageStandard",
    ];

    it.each(requiredKeys)("has key: %s", (key) => {
      expect(profile?.[key]).toBeDefined();
      expect(typeof profile?.[key]).toBe("string");
    });

    it("no longer exposes the removed evidence-config or handling-style keys", () => {
      // These keys were intentionally removed when the onboarding step was
      // trimmed — guard against accidental reintroduction.
      const removed = [
        "evidenceTitle",
        "evidenceSubtitle",
        "evidence_orderDetails",
        "otherEvidenceTitle",
        "manualUploadOnly",
        "handlingStyle",
        "handlingAutomated",
        "handlingConservative",
        "reviewThreshold",
        "summaryAutomation",
        "summaryThreshold",
      ];
      for (const key of removed) {
        expect(profile?.[key]).toBeUndefined();
      }
    });
  });

  describe("setup.automation owns the threshold input", () => {
    const automation = setup?.automation as Record<string, string> | undefined;

    it("has thresholdLabel (moved from storeProfile)", () => {
      expect(automation?.thresholdLabel).toBeDefined();
      expect(typeof automation?.thresholdLabel).toBe("string");
    });
  });
});
