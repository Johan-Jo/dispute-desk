/**
 * The insight digests are suspended (docs/plans/insights-single-source.plan.md,
 * PR0). Every path that could send one must stop before it reads data,
 * claims anything, or reaches Resend.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const resendSend = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: resendSend } })),
}));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));

import { getServiceClient } from "@/lib/supabase/server";
import { insightsDigestsEnabled } from "../insightsDigestGate";
import { triggerOnboardingDigest } from "../triggerOnboardingDigest";
import { sendMonthlyChargebackDigest } from "../sendMonthlyChargebackDigest";
import { sendOnboardingAnalysisDigest } from "../sendOnboardingAnalysisDigest";
import { GET } from "@/app/api/cron/monthly-digest/route";

const mockClient = vi.mocked(getServiceClient);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-secret";
  process.env.CRON_ENABLED = "true";
});

describe("insight digest suspension", () => {
  it("is suspended", () => {
    expect(insightsDigestsEnabled()).toBe(false);
  });

  it("monthly cron answers suspended without touching the database", async () => {
    const from = vi.fn();
    mockClient.mockReturnValue({ from } as never);
    const req = new Request("https://x.test/api/cron/monthly-digest", {
      headers: { authorization: "Bearer test-secret" },
    });
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suspended: true, sent: 0 });
    expect(from).not.toHaveBeenCalled();
  });

  it("onboarding trigger returns before any query or claim", async () => {
    const from = vi.fn();
    mockClient.mockReturnValue({ from } as never);
    const out = await triggerOnboardingDigest("11111111-1111-1111-1111-111111111111");
    expect(out).toEqual({ sent: false, reason: "suspended" });
    expect(mockClient).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("monthly sender never reaches Resend", async () => {
    const out = await sendMonthlyChargebackDigest({ to: "a@b.test" } as never);
    expect(out).toMatchObject({ delivered: false, suspended: true });
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("onboarding sender never reaches Resend", async () => {
    const out = await sendOnboardingAnalysisDigest({ to: "a@b.test" } as never);
    expect(out).toMatchObject({ delivered: false, suspended: true });
    expect(resendSend).not.toHaveBeenCalled();
  });
});
