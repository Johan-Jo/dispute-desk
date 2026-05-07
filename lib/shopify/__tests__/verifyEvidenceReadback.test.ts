/**
 * Integration tests for `verifyEvidenceReadback` orchestration.
 *
 * The pure diff (`diffVerificationReadback`) is already pinned by the
 * snapshot harness in
 * `lib/jobs/handlers/__tests__/saveToShopify.snapshot.test.ts`. What
 * was UNCOVERED until now: the orchestration layer that issues the
 * GraphQL query and normalizes the response shape before passing it
 * to the diff. A regression there shows up in production as
 * `saved_to_shopify_unverified` or as a `verification: { error: ... }`
 * audit row — both of which are silent on the merchant's side.
 *
 * Closes the second item from RELEASE_TESTING_PLAN.md §12 ("Read-back
 * verification in CI").
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/shopify/graphql", () => ({
  requestShopifyGraphQL: vi.fn(),
}));

import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import {
  verifyEvidenceReadback,
  VERIFY_EVIDENCE_QUERY,
} from "@/lib/shopify/verifyEvidenceReadback";

const mockRequest = vi.mocked(requestShopifyGraphQL);

const SESSION = {
  shopDomain: "demo-store.myshopify.com",
  accessToken: "shpat_TEST",
  disputeGid: "gid://shopify/ShopifyPaymentsDispute/9001",
};

/** Build a fake Shopify GraphQL response shaped like the production
 *  `requestShopifyGraphQL` return. The orchestration unwraps
 *  `data.node.disputeEvidence`. */
function shopifyResponse(disputeEvidence: Record<string, unknown> | null) {
  return {
    data: {
      node: disputeEvidence === null ? null : { disputeEvidence },
    },
  };
}

describe("verifyEvidenceReadback — orchestration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("issues VERIFY_EVIDENCE_QUERY against the dispute GID with the right session", async () => {
    mockRequest.mockResolvedValue(
      shopifyResponse({
        id: "gid://shopify/DisputeEvidence/1",
        accessActivityLog: "Customer logged in 2x.",
      }) as never,
    );

    await verifyEvidenceReadback({
      shopDomain: SESSION.shopDomain,
      accessToken: SESSION.accessToken,
      disputeGid: SESSION.disputeGid,
      inputKeys: ["accessActivityLog"],
      correlationId: "verify-job-42",
    });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith({
      session: { shopDomain: SESSION.shopDomain, accessToken: SESSION.accessToken },
      query: VERIFY_EVIDENCE_QUERY,
      variables: { id: SESSION.disputeGid },
      correlationId: "verify-job-42",
    });
  });

  it("classifies a populated text field as confirmed and verified=true", async () => {
    mockRequest.mockResolvedValue(
      shopifyResponse({
        id: "gid://shopify/DisputeEvidence/1",
        accessActivityLog: "Customer logged in 2x.",
        uncategorizedText: "Authorization succeeded; AVS+CVV match.",
      }) as never,
    );

    const { diff, evidenceNode } = await verifyEvidenceReadback({
      ...SESSION,
      inputKeys: ["accessActivityLog", "uncategorizedText"],
    });

    expect(evidenceNode).not.toBeNull();
    if ("verified" in diff) {
      expect(diff.fields_confirmed.sort()).toEqual(["accessActivityLog", "uncategorizedText"]);
      expect(diff.fields_missing).toEqual([]);
      expect(diff.verified).toBe(true);
    } else {
      throw new Error(`expected a VerificationDiff, got error: ${diff.error}`);
    }
  });

  it("classifies an empty text field as missing and verified=false", async () => {
    mockRequest.mockResolvedValue(
      shopifyResponse({
        id: "gid://shopify/DisputeEvidence/1",
        accessActivityLog: "Customer logged in 2x.",
        // We sent uncategorizedText but Shopify's read-back shows it empty
        uncategorizedText: "",
      }) as never,
    );

    const { diff } = await verifyEvidenceReadback({
      ...SESSION,
      inputKeys: ["accessActivityLog", "uncategorizedText"],
    });

    if ("verified" in diff) {
      expect(diff.fields_confirmed).toEqual(["accessActivityLog"]);
      expect(diff.fields_missing).toEqual(["uncategorizedText"]);
      expect(diff.verified).toBe(false);
    } else {
      throw new Error(`expected a VerificationDiff, got error: ${diff.error}`);
    }
  });

  it("treats whitespace-only text as missing (not confirmed)", async () => {
    mockRequest.mockResolvedValue(
      shopifyResponse({
        id: "gid://shopify/DisputeEvidence/1",
        uncategorizedText: "   \n  ",
      }) as never,
    );

    const { diff } = await verifyEvidenceReadback({
      ...SESSION,
      inputKeys: ["uncategorizedText"],
    });

    if ("verified" in diff) {
      expect(diff.fields_missing).toEqual(["uncategorizedText"]);
      expect(diff.verified).toBe(false);
    } else {
      throw new Error("expected a VerificationDiff");
    }
  });

  it("routes write-only fields (submitEvidence, customerFirstName, customerLastName) to fields_write_only", async () => {
    mockRequest.mockResolvedValue(
      shopifyResponse({
        id: "gid://shopify/DisputeEvidence/1",
      }) as never,
    );

    const { diff } = await verifyEvidenceReadback({
      ...SESSION,
      inputKeys: ["submitEvidence", "customerFirstName", "customerLastName"],
    });

    if ("verified" in diff) {
      expect(diff.fields_confirmed).toEqual([]);
      expect(diff.fields_missing).toEqual([]);
      expect(diff.fields_write_only.sort()).toEqual(
        ["customerFirstName", "customerLastName", "submitEvidence"],
      );
      // No verifiable field was missing → verified === true even though
      // we sent only write-only fields. This matches production behaviour.
      expect(diff.verified).toBe(true);
    } else {
      throw new Error("expected a VerificationDiff");
    }
  });

  it("verifies file fields by GID equality when inputValues is provided", async () => {
    const fileGid = "gid://shopify/GenericFile/777";
    mockRequest.mockResolvedValue(
      shopifyResponse({
        id: "gid://shopify/DisputeEvidence/1",
        shippingDocumentationFile: { id: fileGid },
        accessActivityLog: "Logged in.",
      }) as never,
    );

    const { diff } = await verifyEvidenceReadback({
      ...SESSION,
      inputKeys: ["shippingDocumentationFile", "accessActivityLog"],
      inputValues: {
        shippingDocumentationFile: { id: fileGid },
        accessActivityLog: "Logged in.",
      },
    });

    if ("verified" in diff) {
      expect(diff.fields_confirmed.sort()).toEqual(
        ["accessActivityLog", "shippingDocumentationFile"],
      );
      expect(diff.fields_missing).toEqual([]);
      expect(diff.verified).toBe(true);
    } else {
      throw new Error("expected a VerificationDiff");
    }
  });

  it("flags file-field GID mismatch as missing (verified=false)", async () => {
    mockRequest.mockResolvedValue(
      shopifyResponse({
        id: "gid://shopify/DisputeEvidence/1",
        shippingDocumentationFile: { id: "gid://shopify/GenericFile/OTHER" },
      }) as never,
    );

    const { diff } = await verifyEvidenceReadback({
      ...SESSION,
      inputKeys: ["shippingDocumentationFile"],
      inputValues: {
        shippingDocumentationFile: { id: "gid://shopify/GenericFile/SENT" },
      },
    });

    if ("verified" in diff) {
      expect(diff.fields_missing).toEqual(["shippingDocumentationFile"]);
      expect(diff.verified).toBe(false);
    } else {
      throw new Error("expected a VerificationDiff");
    }
  });

  it("falls back to write-only for file fields when inputValues is omitted (back-compat)", async () => {
    mockRequest.mockResolvedValue(
      shopifyResponse({
        id: "gid://shopify/DisputeEvidence/1",
        shippingDocumentationFile: { id: "gid://shopify/GenericFile/777" },
      }) as never,
    );

    const { diff } = await verifyEvidenceReadback({
      ...SESSION,
      inputKeys: ["shippingDocumentationFile"],
      // inputValues intentionally omitted
    });

    if ("verified" in diff) {
      expect(diff.fields_write_only).toEqual(["shippingDocumentationFile"]);
      expect(diff.fields_missing).toEqual([]);
      expect(diff.verified).toBe(true);
    } else {
      throw new Error("expected a VerificationDiff");
    }
  });

  it("returns an error diff when Shopify response lacks node.disputeEvidence", async () => {
    mockRequest.mockResolvedValue(shopifyResponse(null) as never);

    const { diff, evidenceNode } = await verifyEvidenceReadback({
      ...SESSION,
      inputKeys: ["uncategorizedText"],
    });

    expect(evidenceNode).toBeNull();
    expect("error" in diff).toBe(true);
    if ("error" in diff) {
      expect(diff.error).toMatch(/Could not fetch evidence from Shopify/i);
    }
  });

  it("returns an error diff when the response has no data wrapper at all", async () => {
    // Defensive — production has seen Shopify return `{ errors: [...] }`
    // with no `data` field. Orchestration must not crash.
    mockRequest.mockResolvedValue({} as never);

    const { diff, evidenceNode } = await verifyEvidenceReadback({
      ...SESSION,
      inputKeys: ["uncategorizedText"],
    });

    expect(evidenceNode).toBeNull();
    expect("error" in diff).toBe(true);
  });

  it("handles a mixed payload (text confirmed + text missing + write-only) in one diff", async () => {
    mockRequest.mockResolvedValue(
      shopifyResponse({
        id: "gid://shopify/DisputeEvidence/1",
        accessActivityLog: "Logged in 3x.",
        uncategorizedText: null, // sent but not echoed
      }) as never,
    );

    const { diff } = await verifyEvidenceReadback({
      ...SESSION,
      inputKeys: ["accessActivityLog", "uncategorizedText", "submitEvidence"],
    });

    if ("verified" in diff) {
      expect(diff.fields_confirmed).toEqual(["accessActivityLog"]);
      expect(diff.fields_missing).toEqual(["uncategorizedText"]);
      expect(diff.fields_write_only).toEqual(["submitEvidence"]);
      expect(diff.fields_sent.sort()).toEqual(
        ["accessActivityLog", "submitEvidence", "uncategorizedText"],
      );
      expect(diff.verified).toBe(false);
    } else {
      throw new Error("expected a VerificationDiff");
    }
  });
});
