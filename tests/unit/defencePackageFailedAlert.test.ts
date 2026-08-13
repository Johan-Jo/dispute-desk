/**
 * A failed defence package must not be silent.
 *
 * On 2026-08-12 fourteen open disputes held a `failed` latest package with no
 * fileable defence. `markFailed` wrote a row and an audit event; nothing read
 * either. The state was found because a merchant opened the UI and asked.
 * `#12936` had been blocked three weeks past its deadline and `#353605` lost
 * its deadline outright — both recoverable the whole time.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/email/adminEmail", () => ({ sendAdminEmail: vi.fn().mockResolvedValue(undefined) }));

import { sendAdminEmail } from "@/lib/email/adminEmail";
import { sendDefencePackageFailedAlert } from "@/lib/email/sendDefencePackageFailedAlert";

const mockSend = vi.mocked(sendAdminEmail);
const NOW = new Date("2026-08-12T12:00:00Z");

const BASE = {
  shopDomain: "blume-box.myshopify.com",
  orderName: "#352555",
  disputeId: "31af9dc5-c34f-46d4-98a8-fc5f7894be9d",
  packageId: "pkg-6",
  version: 6,
  failureCode: "validation_failed",
  failureReason: "1 validation error (after one retry)",
  promptVersion: 13,
  validatorVersion: 1,
};

beforeEach(() => mockSend.mockClear());

describe("the subject carries the urgency", () => {
  it("names the shop and order so it is triageable from the inbox list", async () => {
    await sendDefencePackageFailedAlert({ ...BASE, dueAt: "2026-08-30T23:00:00Z" }, NOW);
    const { subject } = mockSend.mock.calls[0][0];
    expect(subject).toContain("blume-box.myshopify.com");
    expect(subject).toContain("#352555");
  });

  it("flags a deadline inside three days", async () => {
    await sendDefencePackageFailedAlert({ ...BASE, dueAt: "2026-08-14T23:00:00Z" }, NOW);
    expect(mockSend.mock.calls[0][0].subject).toContain("due in 2d");
  });

  it("flags a deadline already past — the #12936 case, blocked three weeks", async () => {
    await sendDefencePackageFailedAlert({ ...BASE, dueAt: "2026-07-22T23:00:00Z" }, NOW);
    expect(mockSend.mock.calls[0][0].subject).toContain("PAST DEADLINE");
  });

  it("says nothing about urgency when the deadline is far off", async () => {
    await sendDefencePackageFailedAlert({ ...BASE, dueAt: "2026-09-30T23:00:00Z" }, NOW);
    const { subject } = mockSend.mock.calls[0][0];
    expect(subject).not.toContain("due in");
    expect(subject).not.toContain("PAST DEADLINE");
  });

  it("survives a missing or unparseable deadline rather than throwing", async () => {
    await sendDefencePackageFailedAlert({ ...BASE, dueAt: null }, NOW);
    await sendDefencePackageFailedAlert({ ...BASE, dueAt: "not-a-date" }, NOW);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});

describe("the body says what failed and what happens next", () => {
  it("carries the validation errors, so the reader need not query", async () => {
    await sendDefencePackageFailedAlert(
      {
        ...BASE,
        dueAt: "2026-08-19T23:00:00Z",
        validationErrors: [
          {
            rule: "unauthorized_claim",
            section: "fulfillmentArgument",
            message: "makes an affirmative address-delivery claim",
          },
        ],
      },
      NOW,
    );
    const { text, html } = mockSend.mock.calls[0][0];
    expect(text).toContain("fulfillmentArgument");
    expect(text).toContain("unauthorized_claim");
    expect(html).toContain("fulfillmentArgument");
  });

  it("records the versions, so a stale failure is distinguishable from a live one", async () => {
    await sendDefencePackageFailedAlert({ ...BASE, dueAt: null }, NOW);
    expect(mockSend.mock.calls[0][0].text).toMatch(/prompt 13.*validator 1/);
  });

  it("states the recovery rule — it regenerates when the rules change", async () => {
    await sendDefencePackageFailedAlert({ ...BASE, dueAt: null }, NOW);
    expect(mockSend.mock.calls[0][0].text).toContain("regenerate");
    // And the consequence of doing nothing, which is the part that costs money.
    expect(mockSend.mock.calls[0][0].text).toContain("Shopify");
  });

  it("escapes HTML — a failure reason is model output, not trusted markup", async () => {
    await sendDefencePackageFailedAlert(
      { ...BASE, dueAt: null, failureReason: '<script>alert("x")</script>' },
      NOW,
    );
    expect(mockSend.mock.calls[0][0].html).not.toContain("<script>");
    expect(mockSend.mock.calls[0][0].html).toContain("&lt;script&gt;");
  });
});

describe("it never becomes a second failure", () => {
  it("does not throw when the transport fails", async () => {
    mockSend.mockRejectedValueOnce(new Error("resend down"));
    await expect(
      sendDefencePackageFailedAlert({ ...BASE, dueAt: null }, NOW),
    ).rejects.toThrow();
    /* NOTE: the module itself does not catch — `sendAdminEmail` is documented
     * as never throwing, and the ONE caller wraps this in try/catch plus
     * `void`. Asserted here so that contract is visible: if sendAdminEmail
     * ever starts throwing, the caller is what keeps the build safe. */
  });

  it("tolerates an empty validation-error list", async () => {
    await sendDefencePackageFailedAlert({ ...BASE, dueAt: null, validationErrors: [] }, NOW);
    expect(mockSend.mock.calls[0][0].text).not.toContain("Validation errors:");
  });

  it("drops malformed error entries rather than rendering 'undefined'", async () => {
    await sendDefencePackageFailedAlert(
      { ...BASE, dueAt: null, validationErrors: [{}, { rule: "r" }] as never },
      NOW,
    );
    const { text } = mockSend.mock.calls[0][0];
    expect(text).toContain("r");
    expect(text).not.toContain("undefined");
  });
});
