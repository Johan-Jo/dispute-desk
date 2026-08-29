/**
 * The outcome email explains the decision — in the real production HTML.
 *
 * Driven through `sendOutcomePostedAlert` itself with Resend mocked, per
 * `newDisputeAlertHeldVariant.test.ts`: a preview script re-declares the copy
 * and can drift from what ships, which is how the last email defect here got
 * out.
 *
 * The load-bearing claim is the LAST test in this file: the paragraph the
 * merchant reads in the email must be byte-identical to the sentence the
 * dispute Overview header renders. One decision cannot be explained two ways.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import enMessages from "@/messages/en.json";

// `sendOutcomePostedAlert` reads RESEND_API_KEY at module scope and returns
// early without it. `vi.hoisted` runs before the (hoisted) import below, so
// the constant is populated by the time the module body evaluates; a plain
// top-level assignment here executes too late and every send is skipped.
vi.hoisted(() => {
  process.env.RESEND_API_KEY = "test-key";
});

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

import { sendOutcomePostedAlert } from "@/lib/email/sendOutcomePostedAlert";
import { getServiceClient } from "@/lib/supabase/server";
import {
  outcomeExplanationToken,
  resolveOutcomeExplanation,
} from "@/lib/disputes/outcomeExplanation";

const mockGetServiceClient = vi.mocked(getServiceClient);

const fact = (value: Record<string, unknown>) => ({ id: "f", value });

/** #349145 as persisted in prod: AVS N, delivered but unsigned. */
const FACTS_349145 = [
  fact({ fieldKey: "avs_cvv_match", avsResult: "N", cvvResult: "M" }),
  fact({ fieldKey: "delivery_proof", proofType: "delivered_confirmed", signedByName: null }),
];

function buildClient() {
  const fromImpl = (table: string): any => {
    if (table === "shop_setup") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                steps: { team: { payload: { teamEmail: "merchant@example.com" } } },
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

const BASE = {
  shopId: "shop-1",
  disputeId: "dispute-1",
  reason: "FRAUDULENT",
  amount: 255.07,
  currencyCode: "USD",
  orderName: "#349145",
  phase: "chargeback" as const,
};

const DEFENDED = {
  submittedAt: "2026-08-09T08:10:48Z",
  facts: FACTS_349145,
};

async function htmlFor(ctx: Parameters<typeof sendOutcomePostedAlert>[0]) {
  await sendOutcomePostedAlert(ctx);
  expect(sendMock).toHaveBeenCalledTimes(1);
  return sendMock.mock.calls[0][0].html;
}

beforeEach(() => {
  sendMock.mockClear();
  mockGetServiceClient.mockReturnValue(buildClient());
});

describe("outcome email — explanation paragraph", () => {
  it("a defended loss names what we filed and the likely deciding factor", async () => {
    const html = await htmlFor({ ...BASE, outcome: "lost", defencePackage: DEFENDED });
    expect(html).toContain("We filed your evidence on");
    expect(html).toContain("billing address did not match");
    // The old copy still stands; the paragraph is added, not substituted.
    expect(html).toContain("The card network sided with the cardholder");
  });

  it("keeps the existing wording when we never built a package", async () => {
    // A historical import: the email must not volunteer "we did nothing".
    const html = await htmlFor({ ...BASE, outcome: "lost", defencePackage: null });
    expect(html).toContain("The card network sided with the cardholder");
    expect(html).not.toContain("We filed your evidence on");
    expect(html).not.toContain("before DisputeDesk filed any evidence");
  });

  it("omits the paragraph when the package has no usable facts", async () => {
    const html = await htmlFor({
      ...BASE,
      outcome: "lost",
      reason: "CREDIT_NOT_PROCESSED",
      defencePackage: { submittedAt: "2026-08-09T08:10:48Z", facts: [] },
    });
    // `we_defended_no_facts` still states that we filed — just no clause.
    expect(html).toContain("We filed your evidence on");
    expect(html).not.toContain("banks weight this heavily");
  });

  it("never adds the paragraph to the `accepted` catch-all", async () => {
    // `accepted` also reaches disputes we DID submit, so it cannot know what
    // was filed — claiming otherwise would be the unfounded assertion the
    // whole derivation exists to prevent.
    const html = await htmlFor({
      ...BASE,
      outcome: "accepted",
      defencePackage: DEFENDED,
    });
    expect(html).not.toContain("We filed your evidence on");
  });

  it("survives a malformed facts_json without failing the send", async () => {
    const html = await htmlFor({
      ...BASE,
      outcome: "lost",
      defencePackage: { submittedAt: "2026-08-09T08:10:48Z", facts: "not-an-array" },
    });
    expect(html).toContain("The card network sided with the cardholder");
  });

  it("renders the merchant's locale, not English", async () => {
    mockGetServiceClient.mockReturnValue(
      ((): never => {
        const fromImpl = (table: string): any => {
          if (table === "shop_setup") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      steps: {
                        team: { payload: { teamEmail: "m@example.com" } },
                        store_profile: { payload: { storeLocale: "sv-SE" } },
                      },
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
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
        };
        return { from: fromImpl } as unknown as never;
      })(),
    );
    const html = await htmlFor({ ...BASE, outcome: "lost", defencePackage: DEFENDED });
    expect(html).toContain("Vi skickade in dina bevis");
    expect(html).toContain("faktureringsadress");
  });
});

describe("the email and the Overview header cannot drift", () => {
  it("renders the identical sentence the header composes", async () => {
    // The header path: resolve → token → substitute against en.json.
    const explanation = resolveOutcomeExplanation({
      outcome: "lost",
      reason: BASE.reason,
      pack: DEFENDED,
    });
    const formattedDate = new Date(DEFENDED.submittedAt).toLocaleDateString("en", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const token = outcomeExplanationToken(explanation, "lost", formattedDate)!;
    const lookup = (key: string) =>
      key
        .split(".")
        .reduce<unknown>(
          (n, p) =>
            typeof n === "object" && n !== null ? (n as Record<string, unknown>)[p] : undefined,
          enMessages,
        ) as string;
    const headerSentence = lookup(token.key)
      .replace("{date}", formattedDate)
      .replace("{clause}", lookup((token.params!.clause as { key: string }).key));

    const html = await htmlFor({ ...BASE, outcome: "lost", defencePackage: DEFENDED });
    expect(html).toContain(headerSentence);
  });
});
