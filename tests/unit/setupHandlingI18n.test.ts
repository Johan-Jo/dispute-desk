import { describe, it, expect } from "vitest";
import enMessages from "@/messages/en.json";

describe("Setup handling and activate i18n keys", () => {
  const setup = (enMessages as Record<string, unknown>).setup as Record<string, unknown>;

  describe("setup.handling namespace", () => {
    // `coverage` + `automation` merged into `handling` (2026-07-27).
    const handling = setup?.handling as Record<string, string> | undefined;

    it("exists", () => {
      expect(handling).toBeDefined();
    });

    const requiredKeys = [
      "title",
      "subtitle",
      "safeguardTitle",
      "safeguardToggle",
      "thresholdLabel",
      "thresholdInvalid",
      "safeguardHint",
      "setupSummaryTitle",
      // The summary now states what was set up, in the merchant's terms:
      // which dispute types, how they're handled, inquiries, the threshold,
      // and where to fine-tune later.
      "setupSummaryReady",
      "setupSummaryModeAuto",
      "setupSummaryModeReview",
      "setupSummaryInquiry",
      "setupSummarySafeguard",
      "setupSummaryPointer",
    ];

    it.each(requiredKeys)("has key: %s", (key) => {
      expect(handling?.[key]).toBeDefined();
      expect(typeof handling?.[key]).toBe("string");
    });

    it("no longer counts playbooks", () => {
      // "{count} playbooks matched to what your store sells" meant nothing to
      // a merchant AND contradicted the next screen, which counts installed
      // packs including the silently-installed inquiry siblings.
      expect(handling?.setupSummaryPlaybooks).toBeUndefined();
    });

    it("names Shopify as the destination wherever it says submitted", () => {
      // "submit" is accurate for Shopify and false for the card network, which
      // is what an unqualified "submitted for you" implies. See CLAUDE.md.
      for (const key of ["setupSummaryModeAuto", "setupSummaryModeReview"]) {
        expect(handling?.[key]).toMatch(/Shopify/);
      }
    });
  });

  describe("removed namespaces stay removed", () => {
    // The merged step replaced both. Reintroducing either would resurrect the
    // per-dispute-type grid this redesign deleted.
    it("setup.coverage and setup.automation no longer exist", () => {
      expect(setup?.coverage).toBeUndefined();
      expect(setup?.automation).toBeUndefined();
    });

    it("setup.stepper no longer carries the merged step ids", () => {
      const stepper = setup?.stepper as Record<string, string> | undefined;
      expect(stepper?.coverage).toBeUndefined();
      expect(stepper?.automation).toBeUndefined();
      expect(stepper?.handling).toBeDefined();
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
      "statModeLabel",
      "statModeDesc",
      "statModeAuto",
      "statModeReview",
      "statPlaybooksLabel",
      "statPlaybooksDesc",
      "statThresholdLabel",
      "statThresholdDesc",
      "statThresholdOff",
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
        // Tracking-number question — removed because Shopify fulfillments
        // already expose trackingInfo; the merchant's self-report was
        // redundant and forced a wasted question on digital-only stores.
        "deliveryProof",
        "deliveryAlways",
        "deliveryAlwaysDesc",
        "deliverySometimes",
        "deliverySometimesDesc",
        "deliveryRarely",
        "deliveryRarelyDesc",
        "deliveryHint",
        "coverageGood",
        "coverageBasic",
      ];
      for (const key of removed) {
        expect(profile?.[key]).toBeUndefined();
      }
    });
  });

  describe("setup.activate drops the per-family stat keys", () => {
    const activate = setup?.activate as Record<string, string> | undefined;

    it("no longer exposes coverage/automated/review counts", () => {
      // The 2x2 family-count grid is gone; the summary now reports the
      // store-wide mode, playbook count, and threshold.
      for (const key of [
        "statCoverageLabel",
        "statCoverageDesc",
        "statAutomatedLabel",
        "statAutomatedDesc",
        "statReviewLabel",
        "statReviewDesc",
      ]) {
        expect(activate?.[key]).toBeUndefined();
      }
    });
  });
});
