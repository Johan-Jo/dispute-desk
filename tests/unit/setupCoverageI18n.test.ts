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
      "evidenceSummaryTitle",
      "evidenceNote",
      "recommendedBadge",
      "optionalBadge",
      "installedBadge",
      "noTemplatesSelected",
      "installingSaving",
      "coverageSummary",
      "loading",
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

    const requiredKeys = [
      "title",
      "subtitle",
      "evidenceSummary",
      "evidenceManualNote",
      "coverageSummary",
      "automationSummary",
      "activateInfo",
      "changeLater",
      "loading",
    ];

    it.each(requiredKeys)("has key: %s", (key) => {
      expect(activate?.[key]).toBeDefined();
      expect(typeof activate?.[key]).toBe("string");
    });
  });

  describe("setup.storeProfile evidence keys", () => {
    const profile = setup?.storeProfile as Record<string, string> | undefined;

    it("has evidence config keys", () => {
      expect(profile?.evidenceTitle).toBeDefined();
      expect(profile?.evidenceSubtitle).toBeDefined();
      expect(profile?.evidenceAlways).toBeDefined();
      expect(profile?.evidenceWhenPresent).toBeDefined();
      expect(profile?.evidenceReview).toBeDefined();
      expect(profile?.evidenceOff).toBeDefined();
    });

    const evidenceGroups = [
      "orderDetails",
      "customerAddress",
      "fulfillmentRecords",
      "trackingDetails",
      "orderTimeline",
      "refundHistory",
      "notesMetadata",
    ];

    it.each(evidenceGroups)("has label and description for %s", (group) => {
      expect(profile?.[`evidence_${group}`]).toBeDefined();
      expect(profile?.[`evidence_${group}Desc`]).toBeDefined();
    });

    it("has other evidence keys", () => {
      expect(profile?.otherEvidenceTitle).toBeDefined();
      expect(profile?.manualUploadOnly).toBeDefined();
      expect(profile?.otherEvidence_carrierProof).toBeDefined();
      expect(profile?.otherEvidence_supportConversations).toBeDefined();
      expect(profile?.otherEvidence_digitalAccessLogs).toBeDefined();
      expect(profile?.otherEvidence_customDocuments).toBeDefined();
    });
  });
});
