/**
 * `decideFileAttachments` — unit tests covering every rule from
 * `docs/plans/conditional_file_evidence_layer.plan.md` Phase 2.
 *
 * Pure function tests — no mocks, no I/O.
 */
import { describe, expect, it } from "vitest";
import {
  decideFileAttachments,
  type DecideFileAttachmentsInput,
  type FileAttachmentCandidate,
} from "../decideFileAttachments";

const STRONG_DELIVERY: FileAttachmentCandidate = {
  evidenceItemId: "ev-delivery-1",
  evidenceFieldKey: "delivery_proof",
  payload: { proofType: "signature_confirmed" },
  label: "Carrier signature",
};

const MODERATE_DELIVERY: FileAttachmentCandidate = {
  evidenceItemId: "ev-delivery-2",
  evidenceFieldKey: "delivery_proof",
  payload: { proofType: "delivered_confirmed" },
  label: "Delivery confirmation",
};

const STRONG_COMMUNICATION: FileAttachmentCandidate = {
  evidenceItemId: "ev-comm-1",
  evidenceFieldKey: "customer_communication",
  payload: { customerConfirmsOrder: true },
  label: "Customer confirms order",
};

const STRONG_SUPPORTING: FileAttachmentCandidate = {
  evidenceItemId: "ev-supp-1",
  evidenceFieldKey: "supporting_documents",
  payload: { signedContract: true },
  label: "Signed agreement",
};

const STRONG_REFUND_POLICY: FileAttachmentCandidate = {
  evidenceItemId: "ev-rp-1",
  evidenceFieldKey: "refund_policy",
  payload: { acceptedAtCheckout: true, acceptanceTimestamp: "2026-01-01T00:00:00Z" },
  label: "Refund policy acceptance",
};

const STRONG_CANCELLATION_POLICY: FileAttachmentCandidate = {
  evidenceItemId: "ev-cp-1",
  evidenceFieldKey: "cancellation_policy",
  payload: { acceptedAtCheckout: true, acceptanceTimestamp: "2026-01-01T00:00:00Z" },
  label: "Cancellation policy acceptance",
};

/** A "supporting" customer_communication — derived category will be
 *  `supporting`, so the planner must drop it. */
const SUPPORTING_COMMUNICATION: FileAttachmentCandidate = {
  evidenceItemId: "ev-comm-supporting",
  evidenceFieldKey: "customer_communication",
  payload: { customerConfirmsOrder: false },
  label: "Routine email",
};

/** A "label_created" delivery — derives to `invalid`, must be dropped. */
const INVALID_DELIVERY: FileAttachmentCandidate = {
  evidenceItemId: "ev-delivery-invalid",
  evidenceFieldKey: "delivery_proof",
  payload: { proofType: "label_created" },
  label: "Just a label",
};

/** Non-fileEligible field — AVS is text-only. */
const NON_FILE_ELIGIBLE: FileAttachmentCandidate = {
  evidenceItemId: "ev-avs",
  evidenceFieldKey: "avs_cvv_match",
  payload: { avsResultCode: "Y", cvvResultCode: "M" },
  label: "AVS+CVV match",
};

function input(overrides: Partial<DecideFileAttachmentsInput> = {}): DecideFileAttachmentsInput {
  return {
    caseStrength: "moderate",
    disputeReason: "FRAUDULENT",
    coverageActive: false,
    fatalLossActive: false,
    candidates: [],
    ...overrides,
  };
}

describe("decideFileAttachments — gates", () => {
  it("coverage gate active → empty plan, regardless of candidates", () => {
    expect(
      decideFileAttachments(input({
        coverageActive: true,
        candidates: [STRONG_DELIVERY, STRONG_COMMUNICATION],
      })),
    ).toEqual([]);
  });

  it("fatal-loss gate active → empty plan, regardless of candidates", () => {
    expect(
      decideFileAttachments(input({
        fatalLossActive: true,
        candidates: [STRONG_DELIVERY, STRONG_COMMUNICATION],
      })),
    ).toEqual([]);
  });

  it("strong case → empty plan (no need for amplification)", () => {
    expect(
      decideFileAttachments(input({
        caseStrength: "strong",
        candidates: [STRONG_DELIVERY, STRONG_COMMUNICATION],
      })),
    ).toEqual([]);
  });

  it("insufficient case → empty plan", () => {
    expect(
      decideFileAttachments(input({
        caseStrength: "insufficient",
        candidates: [STRONG_DELIVERY, STRONG_COMMUNICATION],
      })),
    ).toEqual([]);
  });
});

describe("decideFileAttachments — strength rules", () => {
  it("moderate case + 1 strong candidate → 1 native", () => {
    const plan = decideFileAttachments(input({
      caseStrength: "moderate",
      candidates: [STRONG_DELIVERY],
    }));
    expect(plan).toHaveLength(1);
    expect(plan[0].priority).toBe("strong");
    expect(plan[0].resolvedSlot).toMatchObject({
      kind: "native",
      targetField: "shippingDocumentationFile",
      origin: "primary",
    });
  });

  it("moderate case + 3 candidates → caps at 2 native", () => {
    const plan = decideFileAttachments(input({
      caseStrength: "moderate",
      candidates: [STRONG_DELIVERY, STRONG_COMMUNICATION, STRONG_SUPPORTING],
    }));
    const native = plan.filter(p => p.resolvedSlot.kind === "native");
    expect(native).toHaveLength(2);
  });

  it("weak case + no strong-priority candidate → empty plan", () => {
    // Two moderate-priority delivery candidates — weak rule still blocks
    // because no candidate is strong-priority.
    const MODERATE_TRACKING: FileAttachmentCandidate = {
      evidenceItemId: "ev-tracking-mod",
      evidenceFieldKey: "shipping_tracking",
      payload: { proofType: "delivered_confirmed" },
      label: "Tracking",
    };
    const plan = decideFileAttachments(input({
      caseStrength: "weak",
      candidates: [MODERATE_DELIVERY, MODERATE_TRACKING],
    }));
    expect(plan).toEqual([]);
  });

  it("weak case + 1 strong + 1 moderate → both included (strong unlocks the gate)", () => {
    // NOTE: among fileEligible fields, only delivery-family (delivery_proof
    // / shipping_tracking) produces a `moderate` priority. So strong + moderate
    // pair shares the shippingDocumentationFile slot — strong wins primary,
    // moderate overflows to uncategorizedFile.
    const plan = decideFileAttachments(input({
      caseStrength: "weak",
      candidates: [STRONG_DELIVERY, MODERATE_DELIVERY],
    }));
    expect(plan).toHaveLength(2);
    expect(plan[0].priority).toBe("strong");
    expect(plan[1].priority).toBe("moderate");
  });
});

describe("decideFileAttachments — exclusions", () => {
  it("supporting candidates are filtered (rubric: never elevate)", () => {
    const plan = decideFileAttachments(input({
      candidates: [SUPPORTING_COMMUNICATION],
    }));
    expect(plan).toEqual([]);
  });

  it("invalid candidates are filtered", () => {
    const plan = decideFileAttachments(input({
      candidates: [INVALID_DELIVERY],
    }));
    expect(plan).toEqual([]);
  });

  it("non-file-eligible field keys (e.g. avs_cvv_match) are filtered even when category is strong", () => {
    const plan = decideFileAttachments(input({
      candidates: [NON_FILE_ELIGIBLE],
    }));
    expect(plan).toEqual([]);
  });
});

describe("decideFileAttachments — slot resolution", () => {
  it("two strong candidates on same targetField → primary + overflow to uncategorized", () => {
    const STRONG_TRACKING: FileAttachmentCandidate = {
      evidenceItemId: "ev-tracking-1",
      evidenceFieldKey: "shipping_tracking",
      payload: { proofType: "signature_confirmed" },
      label: "Tracking",
    };
    const plan = decideFileAttachments(input({
      candidates: [STRONG_DELIVERY, STRONG_TRACKING],
    }));
    expect(plan).toHaveLength(2);
    expect(plan[0].resolvedSlot).toMatchObject({
      kind: "native",
      targetField: "shippingDocumentationFile",
      origin: "primary",
    });
    expect(plan[1].resolvedSlot).toMatchObject({
      kind: "native",
      targetField: "uncategorizedFile",
      origin: "overflow",
    });
  });

  it("three candidates, two on same targetField + uncategorized taken → second drops to link", () => {
    const STRONG_TRACKING: FileAttachmentCandidate = {
      evidenceItemId: "ev-tracking-1",
      evidenceFieldKey: "shipping_tracking",
      payload: { proofType: "signature_confirmed" },
      label: "Tracking",
    };
    const STRONG_UNCAT: FileAttachmentCandidate = {
      evidenceItemId: "ev-uncat-1",
      evidenceFieldKey: "supporting_documents",
      payload: { signedContract: true },
      label: "Signed contract",
    };
    // Order: strong delivery → primary shipping slot; strong uncat →
    // primary uncategorized slot; strong tracking → would conflict on
    // shipping AND uncategorized is already taken → max-2 cap kicks
    // in (planner stops adding before tracking is processed).
    const plan = decideFileAttachments(input({
      candidates: [STRONG_DELIVERY, STRONG_UNCAT, STRONG_TRACKING],
    }));
    const nativeCount = plan.filter(p => p.resolvedSlot.kind === "native").length;
    expect(nativeCount).toBe(2);
    // Either the third never enters the plan (max-2 hit before
    // overflow attempt) or it enters as link with no_slot_available.
    if (plan.length === 3) {
      const last = plan[2];
      expect(last.resolvedSlot).toMatchObject({
        kind: "link",
        fallbackReason: "no_slot_available",
      });
    } else {
      expect(plan.length).toBe(2);
    }
  });

  it("higher priority wins primary slot when same targetField", () => {
    // Both delivery_proof, but one strong (signature_confirmed) and one
    // moderate (delivered_confirmed). Strong must take primary.
    const plan = decideFileAttachments(input({
      candidates: [MODERATE_DELIVERY, STRONG_DELIVERY],
    }));
    const primary = plan.find(p =>
      p.resolvedSlot.kind === "native" && p.resolvedSlot.origin === "primary",
    );
    expect(primary?.evidenceItemId).toBe("ev-delivery-1");
    expect(primary?.priority).toBe("strong");
  });
});

describe("decideFileAttachments — reason-aware slot filtering (Phase 0c)", () => {
  it("FRAUDULENT: refund_policy candidate is hidden — drops out of native plan", () => {
    // Phase 0c finding: refundPolicyFile does not render in fraud
    // disputes' Admin UI even though API accepts it.
    const plan = decideFileAttachments(input({
      caseStrength: "moderate",
      disputeReason: "FRAUDULENT",
      candidates: [STRONG_REFUND_POLICY, STRONG_DELIVERY],
    }));
    const native = plan.filter(p => p.resolvedSlot.kind === "native");
    // STRONG_REFUND_POLICY should not have grabbed a native slot.
    expect(native.find(p => p.evidenceFieldKey === "refund_policy")).toBeUndefined();
    expect(native.find(p => p.evidenceFieldKey === "delivery_proof")).toBeDefined();
    // It MAY appear as a link with reason_hidden_for_dispute.
    const hidden = plan.find(p =>
      p.resolvedSlot.kind === "link" &&
      p.resolvedSlot.fallbackReason === "reason_hidden_for_dispute",
    );
    expect(hidden?.evidenceFieldKey).toBe("refund_policy");
  });

  it("CREDIT_NOT_PROCESSED (refund family): refund_policy is NOT visible until empirically verified — falls to link", () => {
    // Conservative policy: until a real refund-family dispute is
    // observed in Shopify Admin, refundPolicyFile is treated as hidden
    // for ALL families (including refund). Refund policy still ships
    // as a labelled link inside uncategorizedText.
    const plan = decideFileAttachments(input({
      caseStrength: "moderate",
      disputeReason: "CREDIT_NOT_PROCESSED",
      candidates: [STRONG_REFUND_POLICY],
    }));
    const native = plan.filter(p => p.resolvedSlot.kind === "native");
    expect(native).toHaveLength(0);
    const linked = plan.find(p => p.resolvedSlot.kind === "link");
    expect(linked?.resolvedSlot).toMatchObject({ kind: "link", fallbackReason: "reason_hidden_for_dispute" });
  });

  it("SUBSCRIPTION_CANCELED: cancellation_policy is NOT visible until empirically verified — falls to link", () => {
    const plan = decideFileAttachments(input({
      caseStrength: "moderate",
      disputeReason: "SUBSCRIPTION_CANCELED",
      candidates: [STRONG_CANCELLATION_POLICY],
    }));
    const native = plan.filter(p => p.resolvedSlot.kind === "native");
    expect(native).toHaveLength(0);
  });

  it("FRAUDULENT: cancellation_policy candidate is hidden", () => {
    const plan = decideFileAttachments(input({
      caseStrength: "moderate",
      disputeReason: "FRAUDULENT",
      candidates: [STRONG_CANCELLATION_POLICY, STRONG_DELIVERY],
    }));
    const native = plan.filter(p => p.resolvedSlot.kind === "native");
    expect(native.find(p => p.evidenceFieldKey === "cancellation_policy")).toBeUndefined();
  });

  it("unknown reason → conservative 'general' family: only fraud-verified slots visible", () => {
    // Conservative default: until non-fraud families are empirically
    // verified, every family — including 'general' — restricts to the
    // fraud-verified slot set. Refund policy here is hidden, not given
    // a native slot.
    const plan = decideFileAttachments(input({
      caseStrength: "moderate",
      disputeReason: null,
      candidates: [STRONG_REFUND_POLICY],
    }));
    const native = plan.filter(p => p.resolvedSlot.kind === "native");
    expect(native).toHaveLength(0);
  });

  it("the fraud-verified slot set is identical across all reason families (conservative policy)", () => {
    // This test pins the conservative widening policy: any future PR
    // that widens a non-fraud family must come with a captured Admin
    // screenshot AND add a per-family-specific slot set. As long as the
    // four fraud slots remain the only verified ones, this test stays
    // green.
    const fraudCandidates = [STRONG_DELIVERY, STRONG_COMMUNICATION, STRONG_SUPPORTING];
    const fraudPlan = decideFileAttachments(input({
      caseStrength: "moderate",
      disputeReason: "FRAUDULENT",
      candidates: fraudCandidates,
    }));
    const fraudSlots = new Set(
      fraudPlan
        .filter(p => p.resolvedSlot.kind === "native")
        .map(p => (p.resolvedSlot.kind === "native" ? p.resolvedSlot.targetField : "")),
    );
    for (const reason of ["CREDIT_NOT_PROCESSED", "SUBSCRIPTION_CANCELED", "PRODUCT_NOT_RECEIVED", "DUPLICATE", "GENERAL"]) {
      const plan = decideFileAttachments(input({
        caseStrength: "moderate",
        disputeReason: reason,
        candidates: fraudCandidates,
      }));
      const slots = new Set(
        plan
          .filter(p => p.resolvedSlot.kind === "native")
          .map(p => (p.resolvedSlot.kind === "native" ? p.resolvedSlot.targetField : "")),
      );
      expect(slots, reason).toEqual(fraudSlots);
    }
  });
});

describe("decideFileAttachments — manual-upload heuristic", () => {
  // The most common real-world input: a merchant uploaded a file from
  // the Evidence tab. evidence_items.payload carries only fileName +
  // checklistField, never proofType / customerConfirmsOrder /
  // acceptedAtCheckout. categorizeEvidenceField alone returns `invalid`
  // for delivery fields (proofType defaults to "label_created"), which
  // would otherwise drop every manual-upload candidate. The heuristic
  // promotes such uploads to `moderate` priority.

  const MANUAL_DELIVERY_UPLOAD: FileAttachmentCandidate = {
    evidenceItemId: "ev-manual-1",
    evidenceFieldKey: "shipping_tracking",
    payload: { fileName: "tracking.pdf", fileSize: 12345, checklistField: "shipping_tracking" },
    label: "Tracking screenshot",
  };

  const MANUAL_COMM_UPLOAD: FileAttachmentCandidate = {
    evidenceItemId: "ev-manual-2",
    evidenceFieldKey: "customer_communication",
    payload: { fileName: "emails.pdf", fileSize: 4321, checklistField: "customer_communication" },
    label: "Email thread",
  };

  it("manual upload of shipping_tracking → moderate native attachment (would be `invalid` under raw categorizer)", () => {
    const plan = decideFileAttachments(input({
      caseStrength: "moderate",
      candidates: [MANUAL_DELIVERY_UPLOAD],
    }));
    expect(plan).toHaveLength(1);
    expect(plan[0].priority).toBe("moderate");
    expect(plan[0].resolvedSlot).toMatchObject({
      kind: "native",
      targetField: "shippingDocumentationFile",
      origin: "primary",
    });
  });

  it("manual upload of customer_communication → moderate (would be `supporting` under raw categorizer)", () => {
    const plan = decideFileAttachments(input({
      caseStrength: "moderate",
      candidates: [MANUAL_COMM_UPLOAD],
    }));
    expect(plan).toHaveLength(1);
    expect(plan[0].priority).toBe("moderate");
    expect(plan[0].resolvedSlot).toMatchObject({
      kind: "native",
      targetField: "customerCommunicationFile",
    });
  });

  it("manual upload with discriminator (e.g. proofType: 'signature_confirmed') still uses categorizer's verdict (strong)", () => {
    const plan = decideFileAttachments(input({
      caseStrength: "moderate",
      candidates: [{
        ...MANUAL_DELIVERY_UPLOAD,
        payload: { ...MANUAL_DELIVERY_UPLOAD.payload, proofType: "signature_confirmed" },
      }],
    }));
    expect(plan).toHaveLength(1);
    expect(plan[0].priority).toBe("strong");
  });

  it("manual upload with explicit downgrade (proofType: 'label_created') stays invalid → dropped", () => {
    // When the merchant — or an integration — explicitly sets
    // proofType: "label_created", that's a real "no delivery yet"
    // signal; we should not paper over it with the heuristic.
    const plan = decideFileAttachments(input({
      caseStrength: "moderate",
      candidates: [{
        ...MANUAL_DELIVERY_UPLOAD,
        payload: { ...MANUAL_DELIVERY_UPLOAD.payload, proofType: "label_created" },
      }],
    }));
    expect(plan).toEqual([]);
  });

  it("non-manual payload (no fileName) does not trigger the heuristic", () => {
    // A category-`invalid` shipping_tracking section without a fileName
    // (e.g. a legacy structured pack section that lost its proofType)
    // should NOT be elevated. The heuristic gates on fileName presence.
    const plan = decideFileAttachments(input({
      caseStrength: "moderate",
      candidates: [{
        evidenceItemId: "ev-section-1",
        evidenceFieldKey: "shipping_tracking",
        payload: {}, // no fileName, no proofType
        label: null,
      }],
    }));
    expect(plan).toEqual([]);
  });
});

describe("decideFileAttachments — output shape", () => {
  it("each native entry carries evidenceItemId, fieldKey, attachmentType, priority, reason, slot", () => {
    const plan = decideFileAttachments(input({ candidates: [STRONG_DELIVERY] }));
    expect(plan[0]).toEqual({
      evidenceItemId: "ev-delivery-1",
      evidenceFieldKey: "delivery_proof",
      attachmentType: "delivery",
      priority: "strong",
      reason: expect.stringContaining("Carrier signature"),
      resolvedSlot: {
        kind: "native",
        targetField: "shippingDocumentationFile",
        origin: "primary",
      },
    });
  });

  it("reason string is human-readable and includes the merchant label", () => {
    const plan = decideFileAttachments(input({
      candidates: [{ ...STRONG_DELIVERY, label: "FedEx delivery scan" }],
    }));
    expect(plan[0].reason).toMatch(/FedEx delivery scan/);
    expect(plan[0].reason).toMatch(/strong/i);
  });

  it("ordering: strong-priority candidate sorts before moderate-priority candidate", () => {
    const plan = decideFileAttachments(input({
      caseStrength: "moderate",
      candidates: [MODERATE_DELIVERY, STRONG_DELIVERY],
    }));
    expect(plan[0].priority).toBe("strong");
    expect(plan[1].priority).toBe("moderate");
  });
});
