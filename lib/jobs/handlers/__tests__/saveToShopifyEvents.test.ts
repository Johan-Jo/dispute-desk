/**
 * Tests for `emitSaveToShopifyEvents` (Phase 2.3 step 3).
 *
 * The function fires four downstream effects on the success path:
 *   1. logAuditEvent          (awaited)
 *   2. emitDisputeEvent       (fire-and-forget)
 *   3. updateNormalizedStatus (fire-and-forget)
 *   4. sendPackSavedAlert     (fire-and-forget)
 *
 * Tests cover:
 *   - verified path:    audit payload reflects verified=true; dispute
 *                       event description matches "verified".
 *   - unverified path:  audit payload reflects verified=false; dispute
 *                       event description says "verification pending";
 *                       a console.warn fires with the missing-field list.
 *   - no disputeId:     dispute event + normalizedStatus update are
 *                       skipped; audit + alert still fire.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/disputeEvents/emitEvent", () => ({
  emitDisputeEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/disputeEvents/updateNormalizedStatus", () => ({
  updateNormalizedStatus: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/email/sendPackSavedAlert", () => ({
  sendPackSavedAlert: vi.fn().mockResolvedValue(undefined),
}));

import { logAuditEvent } from "@/lib/audit/logEvent";
import { emitDisputeEvent } from "@/lib/disputeEvents/emitEvent";
import { updateNormalizedStatus } from "@/lib/disputeEvents/updateNormalizedStatus";
import { sendPackSavedAlert } from "@/lib/email/sendPackSavedAlert";
import { emitSaveToShopifyEvents } from "../saveToShopifyEvents";

const mockLogAuditEvent = vi.mocked(logAuditEvent);
const mockEmitDisputeEvent = vi.mocked(emitDisputeEvent);
const mockUpdateNormalizedStatus = vi.mocked(updateNormalizedStatus);
const mockSendPackSavedAlert = vi.mocked(sendPackSavedAlert);

const baseInput = {
  shopId: "shop-1",
  disputeId: "dispute-1",
  packId: "pack-1",
  jobId: "job-1",
  evidenceGid: "gid://shopify/DisputeEvidence/42",
  inputKeys: ["uncategorizedText", "refundPolicyDisclosure", "customerFirstName"],
  manualAttachmentCount: 2,
  pdfAttached: true,
  reason: "FRAUDULENT",
  amount: 199,
  currencyCode: "USD",
  eventAt: "2026-05-03T12:00:00Z",
};

describe("emitSaveToShopifyEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verified path: audit payload + dispute event reflect verified=true", async () => {
    await emitSaveToShopifyEvents({
      ...baseInput,
      finalStatus: "saved_to_shopify_verified",
      verified: true,
      verificationDiff: {
        fields_sent: baseInput.inputKeys,
        fields_confirmed: ["uncategorizedText", "refundPolicyDisclosure"],
        fields_missing: [],
        fields_write_only: ["customerFirstName"],
        verified: true,
      },
    });

    // Audit log: awaited, fields_sent + verified=true.
    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "evidence_saved_to_shopify",
        eventPayload: expect.objectContaining({
          verified: true,
          field_count: 3,
          final_status: "saved_to_shopify_verified",
          manual_attachment_count: 2,
          pdf_attached: true,
        }),
      }),
    );

    // Dispute event: description says "sent and verified".
    expect(mockEmitDisputeEvent).toHaveBeenCalledTimes(1);
    const eventArgs = mockEmitDisputeEvent.mock.calls[0][0] as unknown as {
      description: string;
      dedupeKey: string;
      metadataJson: { verified: boolean };
    };
    expect(eventArgs.description).toContain("sent and verified");
    expect(eventArgs.dedupeKey).toBe(
      "dispute-1:evidence_saved_to_shopify:pack-1",
    );
    expect(eventArgs.metadataJson.verified).toBe(true);

    // Normalized status + alert both fired.
    expect(mockUpdateNormalizedStatus).toHaveBeenCalledWith("dispute-1");
    expect(mockSendPackSavedAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId: "shop-1",
        disputeId: "dispute-1",
        packId: "pack-1",
        reason: "FRAUDULENT",
        amount: 199,
        currencyCode: "USD",
      }),
    );
  });

  it("unverified path: dispute event description signals pending verification + warning logged", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await emitSaveToShopifyEvents({
      ...baseInput,
      finalStatus: "saved_to_shopify_unverified",
      verified: false,
      verificationDiff: {
        fields_sent: baseInput.inputKeys,
        fields_confirmed: ["uncategorizedText"],
        fields_missing: ["refundPolicyDisclosure"],
        fields_write_only: ["customerFirstName"],
        verified: false,
      },
    });

    // Audit reflects verified=false.
    const auditArgs = mockLogAuditEvent.mock.calls[0][0] as unknown as {
      eventPayload: { verified: boolean; final_status: string };
    };
    expect(auditArgs.eventPayload.verified).toBe(false);
    expect(auditArgs.eventPayload.final_status).toBe(
      "saved_to_shopify_unverified",
    );

    // Dispute event description signals verification pending.
    const eventArgs = mockEmitDisputeEvent.mock.calls[0][0] as unknown as {
      description: string;
    };
    expect(eventArgs.description).toContain("verification pending");

    // console.warn surfaces the missing field list.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warning = String(warnSpy.mock.calls[0][0]);
    expect(warning).toContain("verification failed");
    expect(warning).toContain("refundPolicyDisclosure");

    warnSpy.mockRestore();
  });

  it("missing disputeId: only the audit event fires; dispute event, normalized status, and alert are all gated", async () => {
    await emitSaveToShopifyEvents({
      ...baseInput,
      disputeId: null,
      finalStatus: "saved_to_shopify_verified",
      verified: true,
      verificationDiff: {
        fields_sent: baseInput.inputKeys,
        fields_confirmed: baseInput.inputKeys,
        fields_missing: [],
        fields_write_only: [],
        verified: true,
      },
    });

    // Audit log records the save with disputeId=null — observability
    // is preserved even when the dispute is absent.
    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);

    // Everything dispute-scoped is gated. The alert template references
    // dispute reason/amount, so without a disputeId it would render
    // an empty subject line — skip the send entirely.
    expect(mockEmitDisputeEvent).not.toHaveBeenCalled();
    expect(mockUpdateNormalizedStatus).not.toHaveBeenCalled();
    expect(mockSendPackSavedAlert).not.toHaveBeenCalled();
  });

  it("verification error envelope is persisted on the audit event verbatim", async () => {
    await emitSaveToShopifyEvents({
      ...baseInput,
      finalStatus: "saved_to_shopify_unverified",
      verified: false,
      verificationDiff: { error: "Could not fetch evidence from Shopify" },
    });

    const auditArgs = mockLogAuditEvent.mock.calls[0][0] as unknown as {
      eventPayload: { verification: unknown };
    };
    expect(auditArgs.eventPayload.verification).toEqual({
      error: "Could not fetch evidence from Shopify",
    });
  });
});
