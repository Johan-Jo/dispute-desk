/**
 * Coverage for `sendAdminInstallNotification` — the source-independent
 * new-merchant alert wired into the Shopify OAuth callback on shop creation.
 *
 * 2026-05-31: a real merchant (`6mjjvm-tc.myshopify.com`) installed via the
 * embedded App Store path. No admin email arrived because the only signup
 * notification (`sendAdminSignupNotification`) was gated behind
 * `source === "portal"`, and embedded installs skip that branch entirely.
 * This helper fires on the `shops` row insert regardless of source, so an
 * App Store install can no longer go unannounced.
 *
 * Contract pinned here:
 *   1. Sends to the admin address (ADMIN_NOTIFY_EMAIL / default).
 *   2. The shop domain is always present in the subject + body.
 *   3. Optional shop name / email / source are included when supplied and
 *      degrade to "—" when absent (never crash on partial Shopify data).
 *   4. Missing RESEND_API_KEY is a silent skip, never a throw.
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
const sendMock = vi.fn(async (_args: ResendSendArgs) => ({
  data: { id: "msg-1" },
}));

vi.mock("resend", () => {
  class FakeResend {
    emails = { send: sendMock };
    constructor(_apiKey?: string) {
      // no-op
    }
  }
  return { Resend: FakeResend };
});

describe("sendAdminInstallNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("sends a new-install alert to the admin address with full shop context", async () => {
    const { sendAdminInstallNotification } = await import(
      "@/lib/email/sendAdminNotification"
    );

    await sendAdminInstallNotification({
      shopDomain: "6mjjvm-tc.myshopify.com",
      email: "owner@example.com",
      shopName: "Acme Goods",
      source: "embedded",
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const args = sendMock.mock.calls[0][0];
    expect(args.to).toBe("oi@johan.com.br");
    expect(args.subject).toContain("6mjjvm-tc.myshopify.com");
    expect(args.html).toContain("6mjjvm-tc.myshopify.com");
    expect(args.html).toContain("Acme Goods");
    expect(args.html).toContain("owner@example.com");
    expect(args.html).toContain("embedded");
    expect(args.text).toContain("6mjjvm-tc.myshopify.com");
    expect(args.text).toContain("owner@example.com");
  });

  it("degrades missing optional fields to em-dash without crashing", async () => {
    const { sendAdminInstallNotification } = await import(
      "@/lib/email/sendAdminNotification"
    );

    await sendAdminInstallNotification({
      shopDomain: "lonely-shop.myshopify.com",
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const args = sendMock.mock.calls[0][0];
    expect(args.subject).toContain("lonely-shop.myshopify.com");
    // shop name / email / source all absent → rendered as em-dash
    expect(args.text).toContain("Store name: —");
    expect(args.text).toContain("Owner email: —");
    expect(args.text).toContain("Source: —");
  });

  it("silently skips (no throw) when RESEND_API_KEY is unset", async () => {
    vi.resetModules();
    const prev = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      const { sendAdminInstallNotification } = await import(
        "@/lib/email/sendAdminNotification"
      );
      await expect(
        sendAdminInstallNotification({ shopDomain: "x.myshopify.com" }),
      ).resolves.toBeUndefined();
      expect(sendMock).not.toHaveBeenCalled();
    } finally {
      process.env.RESEND_API_KEY = prev;
      vi.resetModules();
    }
  });
});
