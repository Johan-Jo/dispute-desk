import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Rendered-email regression guard.
 *
 * These assert the ACTUAL email payload (subject + HTML + text) that Resend
 * would send — the check that was missing when the broken email reached prod.
 * We mock Resend to capture the payload instead of sending.
 */

// Set the API key BEFORE the module under test is imported — it captures
// process.env.RESEND_API_KEY at module load. `vi.hoisted` runs before imports.
const { sendMock } = vi.hoisted(() => {
  process.env.RESEND_API_KEY = "test-key";
  return { sendMock: vi.fn().mockResolvedValue({ error: null }) };
});

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
}));

import { sendEvidenceNeededAlert } from "@/lib/email/sendEvidenceNeededAlert";

type Payload = { subject: string; html: string; text: string };
const lastPayload = (): Payload => sendMock.mock.calls.at(-1)![0] as Payload;

const baseCtx = {
  to: "merchant@example.com",
  shopName: "blume-box.myshopify.com",
  shopDomain: "blume-box.myshopify.com",
  disputeId: "5355f2e1-7d43-4f0a-8864-b536825250a8",
  disputeReason: "FRAUDULENT",
  disputeAmount: "120",
  packId: "pack-1",
  storeTypes: ["physical"],
  orderName: "#352515",
};

describe("sendEvidenceNeededAlert — rendered output", () => {
  beforeEach(() => sendMock.mockClear());

  it("the blume-box case: real delivery, NO real comms → no bogus asks, no false 'attached comms'", async () => {
    await sendEvidenceNeededAlert({
      ...baseCtx,
      hasRealDeliveryProof: true,
      hasRealSupportComms: false,
      pendingSupportReview: false,
    });

    const { subject, html, text } = lastPayload();

    // The three reported failures must all be gone:
    // 1. no invented digital-logs / usage-records ask
    for (const s of [subject, html, text]) {
      expect(s.toLowerCase()).not.toContain("digital access");
      expect(s.toLowerCase()).not.toContain("usage record");
    }
    // 2. must NOT claim we attached support conversations (we didn't)
    for (const s of [html, text]) {
      expect(s.toLowerCase()).not.toContain("customer support conversations");
    }
    // 3. delivery IS real → shown as attached
    expect(html.toLowerCase()).toContain("delivery confirmation");

    // Order number in the subject.
    expect(subject).toContain("#352515");
    // Nothing to ask → review mode.
    expect(html).toContain("ready to review");
  });

  it("real comms present → 'Customer support conversations' IS shown as attached", async () => {
    await sendEvidenceNeededAlert({
      ...baseCtx,
      hasRealDeliveryProof: true,
      hasRealSupportComms: true,
    });
    const { html } = lastPayload();
    expect(html).toContain("Customer support conversations");
    expect(html).toContain("Delivery confirmation");
  });

  it("physical PNR with NO delivery proof → asks for carrier delivery proof (never digital logs)", async () => {
    await sendEvidenceNeededAlert({
      ...baseCtx,
      disputeReason: "PRODUCT_NOT_RECEIVED",
      hasRealDeliveryProof: false,
      hasRealSupportComms: false,
    });
    const { subject, html, text } = lastPayload();
    expect(html).toContain("Carrier delivery proof");
    for (const s of [subject, html, text]) {
      expect(s.toLowerCase()).not.toContain("digital access");
    }
  });

  it("pending Gorgias review → prompts review + deep-links to the gorgias section", async () => {
    await sendEvidenceNeededAlert({
      ...baseCtx,
      hasRealDeliveryProof: true,
      hasRealSupportComms: false,
      pendingSupportReview: true,
      pendingSupportCount: 2,
    });
    const { html } = lastPayload();
    expect(html).toContain("Review matched support conversations");
    // The CTA deep-links to the gorgias review section. getEmbeddedAppUrl
    // URL-encodes the sub-path into ?ddredirect=, so the query is encoded.
    expect(html).toContain("gorgias-comms");
    expect(html).toContain("2 matched support conversations");
  });
});
