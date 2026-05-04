/**
 * Snapshot harness for the save-to-shopify pipeline (Phase 2.3 scaffold).
 *
 * The actual `handleSaveToShopify` orchestrator is a 682-LOC monolith
 * that does pack-load → mutation-compose → GraphQL call → read-back
 * verification → events + audit + alert. The Phase 2.3 plan calls
 * for splitting it into three pure helpers + a thin orchestrator:
 *   - composeShopifyMutationPayload  (extracted ✓)
 *   - buildRestSupplementFields      (extracted ✓ — Phase 2.3 step 1)
 *   - diffVerificationReadback       (extracted ✓ — Phase 2.3 step 2)
 *   - emitSaveToShopifyEvents        (still inline)
 *
 * This file is the byte-equivalence safety net for that split. It
 * pins the OUTPUT of each pure piece against four dispute-family
 * fixtures (FRAUDULENT, PRODUCT_NOT_RECEIVED, PRODUCT_UNACCEPTABLE,
 * DUPLICATE) using vitest's `toMatchSnapshot()`. The snapshots run
 * pre-refactor (capture baseline) and post-refactor (must stay
 * byte-identical).
 *
 * Helpers still pending extraction are mirrored INLINE here. As each
 * one lands in production, this file switches its inline copy for an
 * import; the snapshots stay byte-identical.
 */

import { describe, expect, it } from "vitest";
import {
  composeShopifyMutationPayload,
  type ComposeShopifyMutationPayloadInput,
} from "@/lib/shopify/composeShopifyMutationPayload";
import { buildRestSupplementFields } from "@/lib/shopify/buildRestSupplementFields";
import {
  diffVerificationReadback,
  VERIFIABLE_FIELDS,
} from "@/lib/shopify/verifyEvidenceReadback";
import type { RawPackSection } from "@/lib/shopify/fieldMapping";
import type { DisputeEvidenceUpdateInput } from "@/lib/shopify/mutations/disputeEvidenceUpdate";

/* ─────────────────────────────────────────────────────────────
 *  Helpers used in the snapshot harness.
 *
 *  Pure pieces (composeShopifyMutationPayload, buildRestSupplementFields,
 *  diffVerificationReadback) are now imported from production. The
 *  events emitter remains inline pending Phase 2.3 step 3.
 * ───────────────────────────────────────────────────────────── */


/* ─────────────────────────────────────────────────────────────
 *  FIXTURES — one per dispute family.
 *
 *  Each fixture is the minimum realistic pack snapshot that
 *  exercises the reason-aware payload routing in
 *  `formatEvidenceForShopify.ts` and the REST-supplement
 *  extraction. Hard-coded values stay in the snapshot file so
 *  any byte-level drift surfaces in code review.
 * ───────────────────────────────────────────────────────────── */

function orderSection(opts: { name: string; total: string } = { name: "#1234", total: "150.00" }): RawPackSection {
  return {
    type: "order",
    label: "Order",
    source: "shopify",
    data: {
      orderName: opts.name,
      total: opts.total,
      currency: "USD",
      financialStatus: "paid",
      createdAt: "2026-04-10T12:00:00Z",
      billingAddress: { city: "Austin", provinceCode: "TX", countryCode: "US", zip: "78701" },
      shippingAddress: { city: "Austin", provinceCode: "TX", countryCode: "US", zip: "78701" },
      lineItems: [
        { title: "Acme Widget", variantTitle: "Large", quantity: 1, price: opts.total, sku: "WGT-001" },
      ],
    },
  };
}

function shippingSection(): RawPackSection {
  return {
    type: "shipping",
    label: "Shipping",
    source: "shopify",
    data: {
      overallStatus: "DELIVERED",
      fulfillments: [
        {
          status: "FULFILLED",
          createdAt: "2026-04-11T10:00:00Z",
          deliveredAt: "2026-04-13T14:00:00Z",
          tracking: [{ carrier: "UPS", number: "1Z999AA10123456784" }],
        },
      ],
    },
  };
}

function paymentSection(opts: { avs?: string; cvv?: string } = { avs: "Y", cvv: "M" }): RawPackSection {
  return {
    type: "other",
    label: "Payment Verification",
    source: "shopify",
    fieldsProvided: ["avs_cvv_match"],
    data: {
      avsResultCode: opts.avs,
      cvvResultCode: opts.cvv,
      cardCompany: "Visa",
      lastFour: "1234",
    },
  };
}

function policySection(): RawPackSection {
  return {
    type: "policy",
    label: "Policies",
    source: "shopify",
    data: {
      refund: { text: "All sales final after 30 days." },
      shipping: { text: "Standard shipping ships within 3 business days." },
      cancellation: { text: "Subscriptions cancellable any time before next renewal." },
    },
  };
}

function commsSection(): RawPackSection {
  return {
    type: "comms",
    label: "Customer communication",
    source: "shopify",
    data: {
      messages: [
        { from: "merchant", at: "2026-04-12T09:00:00Z", body: "Order confirmed and shipped." },
      ],
    },
  };
}

function makeFixture(reason: string): ComposeShopifyMutationPayloadInput {
  return {
    sections: [
      orderSection({ name: `#${reason.slice(0, 4)}-001`, total: "199.00" }),
      paymentSection(),
      shippingSection(),
      policySection(),
      commsSection(),
    ],
    rebuttalText: `Rebuttal for ${reason}: the transaction was authorized and the order was shipped/delivered as agreed.`,
    disputeReason: reason,
    customer: { displayName: "Casey Rivera", email: "casey@example.com" },
    manualAttachments: [],
    pdfAttachment: null,
  };
}

const FAMILIES = [
  "FRAUDULENT",
  "PRODUCT_NOT_RECEIVED",
  "PRODUCT_UNACCEPTABLE",
  "DUPLICATE",
] as const;

/* ─────────────────────────────────────────────────────────────
 *  SNAPSHOTS
 * ───────────────────────────────────────────────────────────── */

describe("save-to-shopify pipeline — pre-refactor snapshots (Phase 2.3)", () => {
  describe("composeShopifyMutationPayload", () => {
    for (const reason of FAMILIES) {
      it(`${reason} — composed mutation payload`, () => {
        const out = composeShopifyMutationPayload(makeFixture(reason));
        // Sort keys for stable snapshot output. Real GraphQL accepts any
        // key order; a stable sort keeps diffs reviewable.
        const stable = Object.fromEntries(
          Object.keys(out).sort().map((k) => [k, (out as Record<string, unknown>)[k]]),
        );
        expect(stable).toMatchSnapshot();
      });
    }
  });

  describe("buildRestSupplementFields", () => {
    for (const reason of FAMILIES) {
      it(`${reason} — REST supplement (product_description + shipping)`, () => {
        const fixture = makeFixture(reason);
        expect(buildRestSupplementFields(fixture.sections)).toMatchSnapshot();
      });
    }

    it("emits no fields when sections lack order + shipping", () => {
      expect(buildRestSupplementFields([policySection(), commsSection()])).toEqual({});
    });
  });

  describe("diffVerificationReadback", () => {
    function inputKeysFor(reason: string): string[] {
      const composed = composeShopifyMutationPayload(makeFixture(reason));
      return Object.keys(composed).sort();
    }

    function readbackEcho(inputKeys: string[]): Record<string, unknown> {
      // Simulate Shopify echoing every verifiable field back. Ignored for
      // write-only fields (mutation accepts but read API doesn't expose).
      const out: Record<string, unknown> = {};
      for (const k of inputKeys) {
        if (VERIFIABLE_FIELDS.has(k)) out[k] = `__verified__${k}__`;
      }
      return out;
    }

    for (const reason of FAMILIES) {
      it(`${reason} — verified read-back classification`, () => {
        const inputKeys = inputKeysFor(reason);
        const diff = diffVerificationReadback({
          inputKeys,
          evidenceFromShopify: readbackEcho(inputKeys),
        });
        expect(diff).toMatchSnapshot();
      });

      it(`${reason} — read-back missing one field flips verified to false`, () => {
        const inputKeys = inputKeysFor(reason);
        const partial = readbackEcho(inputKeys);
        // Drop the first verifiable field if any exists.
        const firstVerifiable = inputKeys.find((k) => VERIFIABLE_FIELDS.has(k));
        if (firstVerifiable) delete partial[firstVerifiable];
        const diff = diffVerificationReadback({
          inputKeys,
          evidenceFromShopify: partial,
        });
        if (firstVerifiable) {
          expect(diff).toMatchObject({
            verified: false,
            fields_missing: expect.arrayContaining([firstVerifiable]),
          });
        }
      });
    }

    it("returns a stable error envelope when Shopify returned no evidence node", () => {
      expect(
        diffVerificationReadback({
          inputKeys: ["uncategorizedText"],
          evidenceFromShopify: null,
        }),
      ).toEqual({ error: "Could not fetch evidence from Shopify" });
    });

    it("classifies non-verifiable input keys as fields_write_only", () => {
      // submitEvidence + customerFirstName/Last are accepted by the mutation
      // but never come back through the read-back query — they MUST land in
      // fields_write_only and never as missing.
      const diff = diffVerificationReadback({
        inputKeys: ["uncategorizedText", "customerFirstName", "customerLastName", "submitEvidence"],
        evidenceFromShopify: { uncategorizedText: "anything truthy" },
      });
      expect(diff).toEqual({
        fields_sent: ["uncategorizedText", "customerFirstName", "customerLastName", "submitEvidence"],
        fields_confirmed: ["uncategorizedText"],
        fields_missing: [],
        fields_write_only: ["customerFirstName", "customerLastName", "submitEvidence"],
        verified: true,
      });
    });

    describe("file-field GID equality (Phase 0d / Phase 3 close-out)", () => {
      const SENT_GID = "gid://shopify/ShopifyPaymentsDisputeFileUpload/8422326329";

      it("file field with matching read-back GID → confirmed", () => {
        const diff = diffVerificationReadback({
          inputKeys: ["shippingDocumentationFile"],
          evidenceFromShopify: {
            shippingDocumentationFile: { id: SENT_GID },
          },
          inputValues: {
            shippingDocumentationFile: { id: SENT_GID },
          },
        });
        expect(diff).toMatchObject({
          fields_confirmed: ["shippingDocumentationFile"],
          fields_missing: [],
          verified: true,
        });
      });

      it("file field with mismatched read-back GID → missing (real failure, not a false alarm)", () => {
        const diff = diffVerificationReadback({
          inputKeys: ["shippingDocumentationFile"],
          evidenceFromShopify: {
            shippingDocumentationFile: { id: "gid://shopify/ShopifyPaymentsDisputeFileUpload/different" },
          },
          inputValues: {
            shippingDocumentationFile: { id: SENT_GID },
          },
        });
        expect(diff).toMatchObject({
          fields_missing: ["shippingDocumentationFile"],
          verified: false,
        });
      });

      it("file field with null read-back → missing", () => {
        const diff = diffVerificationReadback({
          inputKeys: ["shippingDocumentationFile"],
          evidenceFromShopify: { shippingDocumentationFile: null },
          inputValues: { shippingDocumentationFile: { id: SENT_GID } },
        });
        expect(diff).toMatchObject({ verified: false });
      });

      it("backwards compat: caller without inputValues → file field falls through to write-only", () => {
        // Existing text-only callers (and the snapshot harness) don't
        // pass inputValues. File fields shouldn't break their behaviour —
        // they classify as write-only and don't trigger missing.
        const diff = diffVerificationReadback({
          inputKeys: ["uncategorizedText", "shippingDocumentationFile"],
          evidenceFromShopify: { uncategorizedText: "echoed" },
        });
        expect(diff).toMatchObject({
          fields_confirmed: ["uncategorizedText"],
          fields_missing: [],
          fields_write_only: ["shippingDocumentationFile"],
          verified: true,
        });
      });

      it("mixed text + file inputs both verify", () => {
        const diff = diffVerificationReadback({
          inputKeys: ["uncategorizedText", "shippingDocumentationFile"],
          evidenceFromShopify: {
            uncategorizedText: "rebuttal text echoed back",
            shippingDocumentationFile: { id: SENT_GID },
          },
          inputValues: {
            uncategorizedText: "rebuttal text echoed back",
            shippingDocumentationFile: { id: SENT_GID },
          },
        });
        expect(diff).toMatchObject({
          fields_confirmed: expect.arrayContaining(["uncategorizedText", "shippingDocumentationFile"]),
          fields_missing: [],
          verified: true,
        });
      });
    });
  });
});

/* ─────────────────────────────────────────────────────────────
 *  Type ergonomics: keep the import live so future moves of
 *  DisputeEvidenceUpdateInput show up here as type errors.
 * ───────────────────────────────────────────────────────────── */
const _typeAssert: (i: DisputeEvidenceUpdateInput) => boolean = (i) =>
  Object.keys(i).length > 0;
void _typeAssert;
