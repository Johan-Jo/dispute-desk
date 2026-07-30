/**
 * The deadline-fallback email must not claim a submission that never happened.
 *
 * WHAT IT USED TO SAY, on the morning a merchant's deadline expired:
 *   "To avoid losing the dispute by default, we submitted the existing
 *    evidence pack PDF to Shopify in its place."
 *   "Your evidence pack has been sent — the bank will review what was
 *    submitted."
 *
 * Both false. The cron that sends this email inserts no job at all — its own
 * comment reads "Post-retirement: no pack-PDF fallback… The merchant must
 * regenerate manually" (defence-package-deadline-submit/route.ts:165-168). So
 * the one warning a merchant received told them they were covered, hours
 * before forfeiting by default.
 *
 * Asserted on the real rendered HTML, not on a copy of the template.
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

import { sendDefenceDeadlineFallbackAlert } from "@/lib/email/sendDefenceDeadlineFallbackAlert";
import { getServiceClient } from "@/lib/supabase/server";

const mockGetServiceClient = vi.mocked(getServiceClient);

function buildClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromImpl = (table: string): any => {
    if (table === "shop_setup") {
      // This sender uses `.maybeSingle()` here and `.single()` for `shops`.
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { steps: { team: { payload: { teamEmail: "merchant@example.com" } } } },
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

type Reason = "validation_failed" | "skipped_no_facts" | "skipped_covered" | "missing";

async function render(fallbackReason: Reason) {
  mockGetServiceClient.mockReturnValue(buildClient());
  await sendDefenceDeadlineFallbackAlert({
    shopId: "shop-1",
    disputeId: "dispute-1",
    disputeGid: "gid://shopify/ShopifyPaymentsDispute/123456",
    reason: "fraudulent",
    amount: 240,
    currencyCode: "USD",
    dueAt: "2026-08-14T22:55:00Z",
    fallbackReason,
  });
  expect(sendMock).toHaveBeenCalledTimes(1);
  return sendMock.mock.calls[0][0];
}

describe("deadline fallback alert — nothing was submitted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = "test-key";
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  for (const reason of ["validation_failed", "skipped_no_facts", "missing"] as const) {
    it(`${reason}: never claims anything was sent`, async () => {
      const mail = await render(reason);
      // Precise to the retired sentences — the replacement copy legitimately
      // contains "No evidence has been sent", which is the opposite claim, so
      // a bare /has been sent/ would flag the fix itself.
      expect(mail.html).not.toMatch(/we submitted/i);
      expect(mail.html).not.toMatch(/pack has been sent/i);
      expect(mail.html).not.toMatch(/will review what was submitted/i);
      expect(mail.html).not.toMatch(/in its place/i);
      expect(mail.text).not.toMatch(/we submitted|pack has been sent/i);
    });

    it(`${reason}: scopes "filed nothing" to DisputeDesk, and names today as the deadline`, async () => {
      const mail = await render(reason);
      expect(mail.subject).toMatch(/action required today/i);
      // Amended 2026-07-30. This asserted a flat /nothing has been filed/.
      // Shopify auto-compiles the order data it holds and files THAT when no
      // evidence is submitted, so the only true version of the claim is the
      // one scoped to us. The unscoped sentence would tell a merchant the case
      // is merely unattended when it is about to be argued badly on their
      // behalf — the same defect as the old concedeHelp copy.
      expect(mail.html).toMatch(/DisputeDesk has filed nothing/i);
      expect(mail.html).toMatch(/We have sent no evidence to Shopify/i);
      expect(mail.html).not.toMatch(/nothing has been filed/i);
      // And it must say what Shopify does instead, or the warning understates
      // the stake.
      expect(mail.html).toMatch(/Shopify will pass on the basic order details/i);
      expect(mail.text).toMatch(/Shopify will pass on the basic order details/i);
      expect(mail.html).toMatch(/rarely wins/i);
    });
  }

  it("Shopify Protect is NOT dressed up as a failure", async () => {
    // Protect means Shopify absorbs the loss and DisputeDesk deliberately
    // builds nothing. The urgent framing would be alarming and wrong — and
    // before the route started reading `failure_code`, these disputes were
    // told their evidence was too thin to defend.
    const mail = await render("skipped_covered");
    expect(mail.subject).toMatch(/no response needed/i);
    expect(mail.subject).toMatch(/Shopify Protect/i);
    expect(mail.html).toMatch(/nothing to defend and nothing for you to do/i);
    expect(mail.html).not.toMatch(/lost by default|action required/i);
  });
});
