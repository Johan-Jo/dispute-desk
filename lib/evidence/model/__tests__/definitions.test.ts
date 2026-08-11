/**
 * EvidenceDefinition registry invariants.
 *
 * The registry is SEEDED from today's implementations rather than restating
 * them, so P1 cannot quietly invent policy. These tests pin the seams where a
 * future edit to one side would silently desync the other — which is how this
 * codebase acquired 310 independent definition sites in the first place.
 */

import { describe, it, expect } from "vitest";
import {
  EVIDENCE_DEFINITIONS,
  definitionFor,
  DEFINITION_REGISTRY_VERSION,
} from "../definitions";
import { EVIDENCE_FIELD_KEYS } from "../domains";
import { INTERNAL_ONLY_FIELDS } from "@/lib/defence/factClassifier";
import { REASON_TEMPLATES_V2 } from "@/lib/automation/completeness";

describe("guard the guard", () => {
  it("has a definition for every evidence field", () => {
    // 19 since PR-C4 retired `billing_address_match` (was 20).
    expect(EVIDENCE_FIELD_KEYS.length).toBeGreaterThanOrEqual(19);
    const missing = EVIDENCE_FIELD_KEYS.filter((k) => !EVIDENCE_DEFINITIONS[k]);
    expect(missing, `No definition for: ${missing.join(", ")}`).toEqual([]);
    expect(DEFINITION_REGISTRY_VERSION).toBeGreaterThan(0);
  });
});

describe("citation policy stays in lockstep with the bank filter", () => {
  it("citationPolicy 'never' matches factClassifier.INTERNAL_ONLY_FIELDS exactly", () => {
    // Two registries deciding "may the issuer see this" is exactly the class
    // of duplication being removed. Until factClassifier is migrated (P4),
    // they must agree; after it, this test is what proves the migration was
    // faithful rather than a rewrite.
    const neverInModel = EVIDENCE_FIELD_KEYS.filter(
      (k) => definitionFor(k).citationPolicy === "never",
    ).sort();
    const neverInClassifier = [...INTERNAL_ONLY_FIELDS].sort();
    expect(
      neverInModel,
      `Model says never-citable: [${neverInModel}]. factClassifier says: ` +
        `[${neverInClassifier}]. If you added a field to INTERNAL_ONLY_FIELDS, ` +
        `set citationPolicy: "never" in definitions.ts (and vice versa) — a ` +
        `field the classifier hides but the model calls citable will be shown ` +
        `to the merchant as bank-facing when it is not.`,
    ).toEqual(neverInClassifier);
  });

  it("the three conditionally-cited fields are declared conditional, not never", () => {
    // fraud_risk_screening and ip_location_check were REMOVED from
    // INTERNAL_ONLY_FIELDS (2026-05-19 / 2026-05-20) because blanket hiding
    // was discarding clean positive signals. tds_authentication is withheld
    // only when it neither shifted liability nor was merchant-confirmed.
    // Declaring any of them "never" would re-introduce those regressions.
    for (const field of [
      "ip_location_check",
      "fraud_risk_screening",
      "tds_authentication",
    ] as const) {
      expect(definitionFor(field).citationPolicy, field).toBe("conditional");
      expect(INTERNAL_ONLY_FIELDS.has(field)).toBe(false);
    }
  });
});

describe("relevance owns relevance, never existence", () => {
  it("returns not_applicable for a field absent from the reason template", () => {
    // The #352552 mechanism: absence from a template made a collected field
    // vanish. Here absence is an explicit RelevanceLevel on a record that
    // still exists.
    const inTemplate = new Set(
      (REASON_TEMPLATES_V2.PRODUCT_UNACCEPTABLE ?? []).map((t) => t.field),
    );
    expect(inTemplate.has("tds_authentication")).toBe(false);
    expect(definitionFor("tds_authentication").relevance("PRODUCT_UNACCEPTABLE")).toBe(
      "not_applicable",
    );
  });

  it("never throws or returns undefined for any field x reason", () => {
    const reasons = [...Object.keys(REASON_TEMPLATES_V2), null, "NOT_A_REAL_REASON"];
    for (const field of EVIDENCE_FIELD_KEYS) {
      for (const reason of reasons) {
        const level = definitionFor(field).relevance(reason);
        expect(
          ["critical", "recommended", "optional", "not_applicable"],
          `${field} x ${reason} → ${level}`,
        ).toContain(level);
      }
    }
  });

  it("resolves an unknown reason through the GENERAL template, not to a crash", () => {
    expect(definitionFor("order_confirmation").relevance("NOT_A_REAL_REASON")).not.toBe(
      "not_applicable",
    );
  });
});

describe("cardinality", () => {
  it("declares multiple for every field a dispute can hold more than one of", () => {
    // Under-declaring loses evidence; over-declaring costs a one-element
    // array. These six are multi-instance in the live data: parcels, files,
    // messages, refunds, listing screenshots.
    for (const field of [
      "delivery_proof",
      "shipping_tracking",
      "customer_communication",
      "supporting_documents",
      "refund_record",
      "product_description",
    ] as const) {
      expect(definitionFor(field).cardinality, field).toBe("multiple");
    }
  });

  it("declares the delivery sibling relation once, in the definition", () => {
    // Replaces collapseDeliveryRows, collapseDeliveryPair, OverviewTab's
    // signal dedup and EvidenceUsedSection's surviving-field logic.
    expect(definitionFor("delivery_proof").aggregation.collapsesWith).toBe(
      "shipping_tracking",
    );
  });

  it("single-cardinality fields carry no sibling collapse", () => {
    expect(definitionFor("avs_cvv_match").cardinality).toBe("single");
    expect(definitionFor("avs_cvv_match").aggregation.collapsesWith).toBeUndefined();
  });
});

describe("merchantSuppliable gates the 'add X' prompt", () => {
  it("system-derived fields are never merchant-suppliable", () => {
    // Asking a merchant to supply a gateway receipt or an IP lookup is the
    // dishonest-nag defect. 3DS in particular has no manual-confirmation
    // flow in production at all.
    for (const field of [
      "tds_authentication",
      "avs_cvv_match",
      "ip_location_check",
      "fraud_risk_screening",
      // `billing_address_match` was in this list until 2026-08-09 (PR-C4). It
      // is retired and no longer has a definition at all — the stronger
      // guarantee, asserted in `tests/unit/retiredFieldKeyContainment.test.ts`.
      "device_session_consistency",
    ] as const) {
      expect(definitionFor(field).merchantSuppliable, field).toBe(false);
    }
  });

  it("upload-backed fields are merchant-suppliable", () => {
    for (const field of ["supporting_documents", "product_description"] as const) {
      expect(definitionFor(field).merchantSuppliable, field).toBe(true);
    }
  });
});
