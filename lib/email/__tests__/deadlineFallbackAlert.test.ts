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
import type { PackageUnsafeReason } from "@/lib/defence/packageSafety";

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

type Reason =
  | "validation_failed"
  | "skipped_no_facts"
  | "skipped_covered"
  | "missing"
  | "unsafe_address_claim";

async function render(
  fallbackReason: Reason,
  unsafeReasons?: readonly PackageUnsafeReason[],
) {
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
    unsafeReasons,
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


/* ── The refusal must not describe itself as something it is not ────── */

describe("unsafe_address_claim — says only what we can support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = "test-key";
  });

  /* The sentence that shipped, and what it asserted about every verdict:
   *   "the existing Defence Package STATES THAT DELIVERY REACHED A VERIFIED
   *    ADDRESS — a claim we can no longer support"
   *
   * `assessPackageCandidateSafety` refuses on five different grounds. Only one
   * of them is that claim. */
  const OVERSTATEMENT = "states that delivery reached a verified address";

  it("does not tell a merchant their package states a claim, on ANY verdict", async () => {
    const verdicts: PackageUnsafeReason[][] = [
      ["affirmative_address_delivery_claim"],
      ["ambiguous_address_delivery_claim"],
      ["retired_delivery_fact"],
      ["unreadable_facts_json"],
      ["unreadable_narrative_json"],
    ];
    for (const reasons of verdicts) {
      vi.clearAllMocks();
      const sent = await render("unsafe_address_claim", reasons);
      expect(sent.html, `${reasons[0]} must not assert the claim`).not.toContain(OVERSTATEMENT);
      expect(sent.text, `${reasons[0]} must not assert the claim`).not.toContain(OVERSTATEMENT);
    }
  });

  it("on AMBIGUOUS says we could not stand behind the wording, not that it claims one", async () => {
    /* The real production case: blume-box 11051073729 was refused on
     * `ambiguous_address_delivery_claim`, where the offending sentence was the
     * `ip_location` fact naming its own comparand. The detector could not
     * resolve it and failed closed — the package asserted nothing. */
    const sent = await render("unsafe_address_claim", ["ambiguous_address_delivery_claim"]);
    expect(sent.text).toContain("built a defence package but could not file it: it used delivery wording we can no longer stand behind");
  });

  it("on UNREADABLE says we could not check it — we never parsed it to know", async () => {
    const sent = await render("unsafe_address_claim", ["unreadable_narrative_json"]);
    expect(sent.text).toContain("could not file it: we could not check it automatically");
    expect(sent.text).not.toContain("delivery wording");
  });

  it("degrades to the non-asserting branch when no reasons are supplied", async () => {
    /* A caller that cannot answer must not get the most specific sentence. */
    const sent = await render("unsafe_address_claim");
    expect(sent.text).not.toContain(OVERSTATEMENT);
    expect(sent.text).toContain("it used delivery wording we can no longer stand behind");
  });

  it("still says DisputeDesk filed nothing — the point of the email is unchanged", async () => {
    const sent = await render("unsafe_address_claim", ["ambiguous_address_delivery_claim"]);
    expect(sent.subject).toContain("has no response filed");
    expect(sent.text).toContain("We have sent no evidence to Shopify for this dispute.");
  });
});

describe("the summary table speaks English, not enum", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = "test-key";
  });

  /* `Why we could not build it: unsafe_address_claim` printed an internal
   * identifier to a merchant — the same class as the validator vocabulary
   * removed from the workspace card. The enum belongs in the audit row. */
  const ENUMS = [
    "unsafe_address_claim",
    "validation_failed",
    "skipped_no_facts",
    "missing",
  ] as const;

  for (const value of ENUMS) {
    it(`${value}: the raw identifier never reaches the merchant`, async () => {
      const sent = await render(value);
      expect(sent.text).not.toContain(value);
      expect(sent.html).not.toContain(value);
    });
  }

  it("every branch reads as one sentence, not a comma splice", async () => {
    for (const value of ENUMS) {
      vi.clearAllMocks();
      const sent = await render(value);
      expect(sent.text, value).not.toMatch(/,\s+There is no fallback/);
    }
  });
});
