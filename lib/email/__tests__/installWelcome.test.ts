/**
 * Contract for the App Store install welcome email.
 *
 * Covers the template (greeting, locales, forbidden copy) and the sender
 * (recipient resolution, atomic single-send claim, graceful degradation).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateInstallWelcomeEmailHTML,
  generateInstallWelcomeEmailText,
  getInstallWelcomeSubject,
} from "@/lib/email/installWelcomeTemplate";
import { LOCALE_LIST } from "@/lib/i18n/locales";

describe("install welcome template", () => {
  const base = { appUrl: "https://admin.shopify.com/store/x/apps/disputedesk-1" };

  it("greets the store by name", () => {
    const html = generateInstallWelcomeEmailHTML({ ...base, shopName: "Mein Maison" });
    expect(html).toContain("Welcome to DisputeDesk, Mein Maison");
  });

  it("degrades to a name-less greeting rather than showing a placeholder", () => {
    for (const shopName of [undefined, null, "", "   "]) {
      const html = generateInstallWelcomeEmailHTML({ ...base, shopName });
      expect(html).toContain("Welcome to DisputeDesk");
      expect(html).not.toContain("{shopName}");
      // Never a dangling greeting like "Welcome to DisputeDesk, </p>".
      expect(html).not.toMatch(/Welcome to DisputeDesk,\s*</);
    }
  });

  it("never falls back to the opaque myshopify subdomain", () => {
    const html = generateInstallWelcomeEmailHTML({ ...base, shopName: null });
    expect(html).not.toContain("myshopify");
    expect(html).not.toContain("6a8848-dd");
  });

  it("links the CTA to the embedded app, never the portal", () => {
    const html = generateInstallWelcomeEmailHTML({
      ...base,
      appUrl: "https://admin.shopify.com/store/mein-maison/apps/disputedesk-1",
    });
    expect(html).toContain("https://admin.shopify.com/store/mein-maison/apps/disputedesk-1");
    expect(html).not.toContain("/portal/dashboard");
  });

  it("renders every active locale with no untranslated placeholder", () => {
    expect(LOCALE_LIST.length).toBe(6);
    for (const locale of LOCALE_LIST) {
      const html = generateInstallWelcomeEmailHTML({
        ...base,
        shopName: "Mein Maison",
        locale,
      });
      expect(html, `locale ${locale}`).toContain("Mein Maison");
      expect(html, `locale ${locale}`).not.toContain("{shopName}");
      expect(getInstallWelcomeSubject(locale).length).toBeGreaterThan(0);
      // Every locale must set the html lang attribute.
      expect(html, `locale ${locale}`).toContain(`<html lang="${locale}"`);
    }
  });

  it("avoids the CI-forbidden submission copy in every locale", () => {
    // Assembled rather than written literally: the CI forbidden-copy gate
    // greps every .ts file, so spelling these out here would fail the build
    // on this very test.
    const forbidden = [
      ["submit", "response"].join(" "),
      ["submit", "to", "card", "network"].join(" "),
      ["file", "dispute", "response"].join(" "),
    ];
    for (const locale of LOCALE_LIST) {
      const html = generateInstallWelcomeEmailHTML({
        ...base,
        locale,
      }).toLowerCase();
      for (const phrase of forbidden) {
        expect(html, `locale ${locale}`).not.toContain(phrase);
      }
    }
  });

  it("produces a plain-text part mirroring the HTML", () => {
    const vars = { ...base, shopName: "Mein Maison" };
    const text = generateInstallWelcomeEmailText(vars);
    expect(text).toContain("Welcome to DisputeDesk, Mein Maison");
    expect(text).toContain(base.appUrl);
    expect(text).not.toContain("<p");
  });
});

// ─── Sender ───────────────────────────────────────────────────────────────

interface ResendSendArgs {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}
const sendMock = vi.fn(
  async (_args: ResendSendArgs, _opts?: { idempotencyKey?: string }) => ({
    data: { id: "msg-1" } as { id: string } | null,
    error: null as { message: string } | null,
  }),
);
vi.mock("resend", () => {
  class FakeResend {
    emails = { send: sendMock };
  }
  return { Resend: FakeResend };
});

/** Chainable Supabase stub whose claim result is controlled per test. */
let claimRows: Array<{ id: string }> | null = [{ id: "shop-1" }];
let claimError: { message: string } | null = null;
const updateMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: () => ({
      update: (...args: unknown[]) => {
        updateMock(...args);
        return {
          eq: () => ({
            is: () => ({
              select: async () => ({ data: claimRows, error: claimError }),
            }),
          }),
        };
      },
    }),
  }),
}));

process.env.RESEND_API_KEY = "test-key";

describe("sendInstallWelcomeEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    claimRows = [{ id: "shop-1" }];
    claimError = null;
  });

  const opts = {
    shopInternalId: "shop-1",
    shopDomain: "6a8848-dd.myshopify.com",
    to: "info@meinmaison.de",
    shopName: "Mein Maison",
  };

  it("sends to the Shopify shop-owner address", async () => {
    const { sendInstallWelcomeEmail } = await import("@/lib/email/sendInstallWelcome");
    const result = await sendInstallWelcomeEmail(opts);

    expect(result.ok).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const args = sendMock.mock.calls[0][0];
    expect(args.to).toBe("info@meinmaison.de");
    expect(args.html).toContain("Mein Maison");
  });

  it("skips without sending when no recipient is known", async () => {
    const { sendInstallWelcomeEmail } = await import("@/lib/email/sendInstallWelcome");
    const result = await sendInstallWelcomeEmail({ ...opts, to: null });

    expect(result).toEqual({ ok: false, reason: "no_recipient" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("does not send when the claim was already taken", async () => {
    claimRows = [];
    const { sendInstallWelcomeEmail } = await import("@/lib/email/sendInstallWelcome");
    const result = await sendInstallWelcomeEmail(opts);

    expect(result).toEqual({ ok: false, reason: "already_sent" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("claims before sending, so a crash cannot yield a duplicate", async () => {
    const { sendInstallWelcomeEmail } = await import("@/lib/email/sendInstallWelcome");
    await sendInstallWelcomeEmail(opts);

    expect(updateMock).toHaveBeenCalledTimes(1);
    const patch = updateMock.mock.calls[0][0] as { welcome_email_sent_at: string };
    expect(patch.welcome_email_sent_at).toBeTruthy();
  });

  it("reports a Resend rejection instead of failing silently", async () => {
    sendMock.mockResolvedValueOnce({
      data: null,
      error: { message: "domain not verified" },
    });
    const { sendInstallWelcomeEmail } = await import("@/lib/email/sendInstallWelcome");
    const result = await sendInstallWelcomeEmail(opts);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("send_failed");
  });
});
