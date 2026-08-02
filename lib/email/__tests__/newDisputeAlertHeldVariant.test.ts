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
 * date, and the dispute page offers an Auto-pilot merchant no approve / hold /
 * concede control at all — that block renders only for a review-mode approval
 * gate.
 *
 * So this body must not ask for a review, and must not name conceding: the old
 * copy did both, sending merchants to look for buttons that were not there.
 * What it MAY do is name the one contribution a held case can actually take —
 * a cardholder acknowledgement — and only when `lib/disputes/heldState` says
 * the acknowledgement card would really render for that dispute.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { HeldState } from "@/lib/disputes/heldState";

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
  getEmbeddedAppUrl: vi.fn((_shop: string | null, path: string) => `https://example.test/${path}`),
}));
vi.mock("@/lib/shopify/shopDetails", () => ({ fetchShopDetails: vi.fn() }));

import { sendNewDisputeAlert } from "@/lib/email/sendNewDisputeAlert";
import { getServiceClient } from "@/lib/supabase/server";

const mockGetServiceClient = vi.mocked(getServiceClient);

function buildClient(storeLocale?: string) {
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
                  ...(storeLocale
                    ? { store_profile: { payload: { storeLocale } } }
                    : {}),
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

/** Moderate hold with the acknowledgement available — the common case. */
const HELD_WITH_OFFER: HeldState = {
  held: true,
  reason: "moderate_strength",
  offer: "cardholder_acknowledgement",
  offerFlipsToStrong: true,
};
/** Weak hold, acknowledgement available: helps, but no promise of a save. */
const HELD_WEAK_WITH_OFFER: HeldState = {
  held: true,
  reason: "weak_strength",
  offer: "cardholder_acknowledgement",
  offerFlipsToStrong: false,
};
/** Held, but the merchant already provided customer communication. */
const HELD_NO_OFFER: HeldState = {
  held: true,
  reason: "moderate_strength",
  offer: null,
  offerFlipsToStrong: false,
};

async function render(
  variant: "auto" | "review" | "held",
  opts: { held?: HeldState | null; locale?: string } = {},
) {
  mockGetServiceClient.mockReturnValue(buildClient(opts.locale));
  await sendNewDisputeAlert({
    ...BASE_CTX,
    resolvedMode: variant,
    held: opts.held ?? null,
  });
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

  it("does not ask for a review or a decision", async () => {
    const mail = await render("held", { held: HELD_WITH_OFFER });
    // The exact sentence the review body sends, which is false here.
    expect(mail.html).not.toContain("still requires your decision");
    // "Review" is the whole defect: an Auto-pilot merchant is not the gate,
    // and the page gives them no approve/hold/concede control.
    expect(mail.subject).not.toMatch(/review/i);
    expect(mail.html).not.toMatch(/review the prepared evidence/i);
    expect(mail.html).not.toMatch(/Review dispute/i);
  });

  it("does not offer conceding — no such control exists in auto mode", async () => {
    // It also would not do what the sentence implied: conceding withholds our
    // package, and Shopify still files the order data it scraped.
    const mail = await render("held", { held: HELD_WITH_OFFER });
    expect(mail.html).not.toMatch(/concede/i);
    expect(mail.html).not.toMatch(/Don't defend/i);
  });

  it("says it is held and being monitored, and names the due date", async () => {
    const mail = await render("held", { held: HELD_WITH_OFFER });
    expect(mail.html).toMatch(/held/i);
    expect(mail.html).toMatch(/save this response to Shopify on/i);
    expect(mail.html).toMatch(/Aug(ust)?\s+14|14\s+Aug/i);
    expect(mail.html).toMatch(/Nothing is required from you/i);
    // The shared phase hint is an instruction ("Evidence must be submitted
    // before the deadline") — printing it two lines under "nothing is
    // required from you" contradicts it, and on a held case the submitting
    // is ours to do.
    expect(mail.html).not.toContain("Evidence must be submitted before the deadline");
    expect(mail.html).toMatch(/We save your response to Shopify/i);
  });

  it("names the acknowledgement, and promises the immediate save only on a moderate case", async () => {
    const moderate = await render("held", { held: HELD_WITH_OFFER });
    expect(moderate.html).toMatch(/cardholder confirms they placed and received/i);
    expect(moderate.html).toMatch(/save it to Shopify straight away/i);
    // The deep link lands ON the acknowledgement card, not the dispute root.
    expect(moderate.html).toContain("section=cardholder-ack");

    vi.clearAllMocks();
    const weak = await render("held", { held: HELD_WEAK_WITH_OFFER });
    expect(weak.html).toMatch(/cardholder confirms they placed and received/i);
    // A weak case has no strong signal yet, so one acknowledgement does not
    // reach the auto-save bar. Promising it would be a new lie.
    expect(weak.html).not.toMatch(/straight away/i);
    expect(weak.html).toMatch(/strongest single piece of evidence/i);
  });

  it("prints no ask when the acknowledgement card would not render", async () => {
    // heldState said `offer: null` — e.g. the merchant already provided
    // customer communication. Inviting them again is the "add the product
    // listing" defect in a new place.
    const mail = await render("held", { held: HELD_NO_OFFER });
    expect(mail.html).not.toMatch(/cardholder confirms/i);
    expect(mail.html).not.toContain("section=cardholder-ack");
  });

  it("prints no ask when no held facts were supplied at all", async () => {
    const mail = await render("held", { held: null });
    expect(mail.html).not.toMatch(/cardholder confirms/i);
    expect(mail.html).toMatch(/save this response to Shopify on/i);
  });

  it("never claims the response was already submitted", async () => {
    const mail = await render("held", { held: HELD_WITH_OFFER });
    // That is the `auto` variant's job, and only after a real save.
    expect(mail.html).not.toContain("submitted the response automatically");
    expect(mail.html).not.toContain("on your behalf");
  });

  it("the review variant still says nothing is submitted — review mode is a hard gate", async () => {
    const mail = await render("review");
    expect(mail.html).toContain("Nothing has been submitted yet");
  });

  it("the review variant still offers the decisions review mode really has", async () => {
    // Guard against over-correcting: the concede/approve language belongs
    // here, where the merchant is genuinely the gate.
    const mail = await render("review");
    expect(mail.html).toMatch(/concede/i);
    expect(mail.subject).toMatch(/review/i);
  });

  it.each(["de", "es", "fr", "pt", "sv"])(
    "%s: the held body carries the ask, the deep link, and no concede offer",
    async (locale) => {
      const mail = await render("held", { held: HELD_WITH_OFFER, locale });
      expect(mail.html).toContain("section=cardholder-ack");
      // Shopify is named in every locale — a sentence about what we won't do,
      // without what Shopify still does, is the version that misleads.
      expect(mail.html).toMatch(/Shopify/);
      // The concede button's own label, read from the catalog, so renaming
      // the button keeps this guard honest.
      const messages = JSON.parse(
        readFileSync(resolve(__dirname, `../../../messages/${locale}.json`), "utf8"),
      ) as { disputes: { overviewExtra: { review: { concede: string } } } };
      expect(mail.html).not.toContain(messages.disputes.overviewExtra.review.concede);
    },
  );
});
