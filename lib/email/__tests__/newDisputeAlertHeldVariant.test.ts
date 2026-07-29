/**
 * The `held` variant renders the truth, in the real production HTML.
 *
 * Why this exists rather than a preview script: the existing preview scripts
 * (scripts/preview-outcome-emails.mjs and friends) re-declare the copy, so
 * they can drift from what actually ships — and the last email defect here
 * shipped precisely because only the template was reviewed. This drives
 * `sendNewDisputeAlert` itself with Resend mocked, and asserts on the HTML the
 * merchant would receive.
 *
 * The claim under test: an Auto-pilot dispute that the guards held is NOT
 * waiting for a decision. The deadline cron saves it to Shopify on the due
 * date. The `review` body says "this dispute still requires your decision",
 * which for these disputes is false — that is the sentence this variant was
 * added to stop sending.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.RESEND_API_KEY = "test-key";

interface ResendSendArgs {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}
const sendMock = vi.fn(async (_args: ResendSendArgs) => ({ data: { id: "msg-1" } }));

vi.mock("resend", () => {
  class FakeResend {
    emails = { send: sendMock };
    constructor(_apiKey?: string) {}
  }
  return { Resend: FakeResend };
});
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/email/publicSiteUrl", () => ({
  getEmbeddedAppUrl: vi.fn(() => "https://example.test/disputes/x"),
}));
vi.mock("@/lib/shopify/shopDetails", () => ({ fetchShopDetails: vi.fn() }));

import { sendNewDisputeAlert } from "@/lib/email/sendNewDisputeAlert";
import { getServiceClient } from "@/lib/supabase/server";

const mockGetServiceClient = vi.mocked(getServiceClient);

function buildClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromImpl = (table: string): any => {
    if (table === "shop_setup") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                steps: {
                  team: { payload: { teamEmail: "merchant@example.com" } },
                },
              },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "shops") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { shop_domain: "test.myshopify.com" },
              error: null,
            }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  };
  return { from: fromImpl } as unknown as never;
}

const BASE_CTX = {
  shopId: "shop-1",
  disputeId: "dispute-1",
  reason: "fraudulent",
  phase: "chargeback",
  amount: 167.64,
  currencyCode: "USD",
  dueAt: "2026-08-14T22:55:00Z",
  orderName: "#1082",
  shopifyDisputeEvidenceGid: null,
};

async function render(variant: "auto" | "review" | "held") {
  mockGetServiceClient.mockReturnValue(buildClient());
  await sendNewDisputeAlert({ ...BASE_CTX, resolvedMode: variant });
  expect(sendMock).toHaveBeenCalledTimes(1);
  return sendMock.mock.calls[0][0];
}

describe("sendNewDisputeAlert — the held variant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = "test-key";
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("says the response is held, not that it needs a decision", async () => {
    const mail = await render("held");
    expect(mail.subject).toContain("held for your review");
    expect(mail.html).toContain("held for your review");
    // The exact sentence the review body sends, which is false here.
    expect(mail.html).not.toContain("still requires your decision");
  });

  it("names the due date as the moment it goes to Shopify", async () => {
    const mail = await render("held");
    // The callout interpolates the formatted deadline — a merchant reading
    // this must be able to see WHEN it stops being their decision.
    expect(mail.html).toMatch(/save this response to Shopify on/i);
    expect(mail.html).toMatch(/Aug(ust)?\s+14|14\s+Aug/i);
  });

  it("offers conceding as the way to stop it", async () => {
    const mail = await render("held");
    expect(mail.html).toMatch(/concede/i);
  });

  it("never claims the response was already submitted", async () => {
    const mail = await render("held");
    // That is the `auto` variant's job, and only after a real save.
    expect(mail.html).not.toContain("submitted the response automatically");
    expect(mail.html).not.toContain("on your behalf");
  });

  it("the review variant still says nothing is submitted — review mode is a hard gate", async () => {
    const mail = await render("review");
    expect(mail.html).toContain("Nothing has been submitted yet");
  });
});
