/**
 * Tests for `sendGorgiasEvidenceReadyAlert` (lib/email/…).
 *
 * The "Gorgias evidence found — review & approve" email. It must:
 *   1. send once when a team email exists, the evidenceReady toggle is not
 *      disabled, RESEND_API_KEY is set, and proposalCount >= 1;
 *   2. respect the `notifications.evidenceReady === false` opt-out;
 *   3. no-op (no send) when there is no team email, no API key, or
 *      proposalCount < 1 — and never throw (fire-and-forget contract).
 *
 * Resend + Supabase are mocked so no real I/O happens.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_RESEND_KEY = process.env.RESEND_API_KEY;

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
const sendMock = vi.fn().mockResolvedValue({ data: { id: "msg-1" }, error: null });
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { sendGorgiasEvidenceReadyAlert } from "../sendGorgiasEvidenceReadyAlert";

const mockGetClient = vi.mocked(getServiceClient);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "test_key";
});
afterEach(() => {
  process.env.RESEND_API_KEY = ORIGINAL_RESEND_KEY;
});

/** Supabase mock: shop_setup (team email + toggle + locale), shops (domain),
 *  disputes (due_at). */
function buildSb(opts: {
  teamPayload?: Record<string, unknown> | null;
  locale?: string;
} = {}) {
  const steps =
    opts.teamPayload === null
      ? null
      : {
          team: { payload: opts.teamPayload ?? { teamEmail: "team@example.com" } },
          store_profile: { payload: { storeLocale: opts.locale ?? "en" } },
        };

  return {
    from: vi.fn((table: string) => {
      if (table === "shop_setup") {
        return {
          select: () => ({
            eq: () => ({
              single: vi
                .fn()
                .mockResolvedValue({ data: steps ? { steps } : null, error: null }),
            }),
          }),
        };
      }
      if (table === "shops") {
        return {
          select: () => ({
            eq: () => ({
              single: vi
                .fn()
                .mockResolvedValue({ data: { shop_domain: "acme.myshopify.com" }, error: null }),
            }),
          }),
        };
      }
      if (table === "disputes") {
        return {
          select: () => ({
            eq: () => ({
              single: vi
                .fn()
                .mockResolvedValue({ data: { due_at: "2026-07-22T23:00:00Z" }, error: null }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ single: vi.fn() }) }) };
    }),
  } as never;
}

const ctx = {
  shopId: "shop-1",
  disputeId: "dispute-1",
  proposalCount: 2,
  reason: "fraudulent",
  amount: 110.89,
  currencyCode: "USD",
};

describe("sendGorgiasEvidenceReadyAlert", () => {
  it("sends once when configured (team email, toggle not disabled, key set)", async () => {
    mockGetClient.mockReturnValue(buildSb());
    await sendGorgiasEvidenceReadyAlert(ctx);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0];
    expect(arg.to).toBe("team@example.com");
    expect(arg.subject).toContain("fraudulent");
    // proposalCount is reflected in the body copy.
    expect(arg.html).toContain("2");
  });

  it("sends even when the evidenceReady preference is missing (defaults on)", async () => {
    mockGetClient.mockReturnValue(
      buildSb({ teamPayload: { teamEmail: "team@example.com", notifications: {} } }),
    );
    await sendGorgiasEvidenceReadyAlert(ctx);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT send when evidenceReady is explicitly false", async () => {
    mockGetClient.mockReturnValue(
      buildSb({
        teamPayload: { teamEmail: "team@example.com", notifications: { evidenceReady: false } },
      }),
    );
    await sendGorgiasEvidenceReadyAlert(ctx);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("does NOT send when there is no team email", async () => {
    mockGetClient.mockReturnValue(buildSb({ teamPayload: {} }));
    await sendGorgiasEvidenceReadyAlert(ctx);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("no-ops when proposalCount < 1 (never queries or sends)", async () => {
    mockGetClient.mockReturnValue(buildSb());
    await sendGorgiasEvidenceReadyAlert({ ...ctx, proposalCount: 0 });
    expect(sendMock).not.toHaveBeenCalled();
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  it("no-ops when RESEND_API_KEY is unset", async () => {
    delete process.env.RESEND_API_KEY;
    mockGetClient.mockReturnValue(buildSb());
    await sendGorgiasEvidenceReadyAlert(ctx);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("never throws when the send fails (fire-and-forget)", async () => {
    mockGetClient.mockReturnValue(buildSb());
    sendMock.mockRejectedValueOnce(new Error("resend down"));
    await expect(sendGorgiasEvidenceReadyAlert(ctx)).resolves.toBeUndefined();
  });
});
