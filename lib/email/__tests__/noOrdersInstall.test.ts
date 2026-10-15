/**
 * Contract for the no-orders install emails (docs/plans/no-orders-install-gate.plan.md):
 *   - the MERCHANT email that replaces the welcome and explains we can't set up
 *     because there is no order history (hence no disputes);
 *   - the ADMIN alert whose subject/headline is "Yet another store with no
 *     orders was installed".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateNoOrdersInstallEmailHTML,
  generateNoOrdersInstallEmailText,
  getNoOrdersInstallSubject,
} from "@/lib/email/noOrdersInstallTemplate";
import { LOCALE_LIST } from "@/lib/i18n/locales";

describe("no-orders merchant email template", () => {
  it("says there is no order history and no disputes, nothing set up, welcome back (en)", () => {
    const text = generateNoOrdersInstallEmailText({ shopName: "Elio Varen" });
    expect(text).toContain("Thanks for trying DisputeDesk, Elio Varen");
    expect(text).toContain("can't complete the installation");
    expect(text).toContain("no order history");
    expect(text).toContain("no disputes");
    expect(text).toContain("haven't been charged");
    expect(text).toContain("very welcome back");
  });

  it("degrades to a name-less greeting and never shows the myshopify subdomain", () => {
    for (const shopName of [undefined, null, "", "   "]) {
      const html = generateNoOrdersInstallEmailHTML({ shopName });
      expect(html).not.toContain("{shopName}");
      expect(html).not.toContain("myshopify");
      expect(html).not.toMatch(/Thanks for trying DisputeDesk,\s*</);
    }
  });

  it("has no call-to-action link into the app", () => {
    const html = generateNoOrdersInstallEmailHTML({ shopName: "Elio Varen" });
    expect(html).not.toContain("admin.shopify.com");
    expect(html).not.toContain("<a ");
  });

  it("renders every locale, fully translated, with a subject and lang attribute", () => {
    expect(LOCALE_LIST.length).toBe(6);
    for (const locale of LOCALE_LIST) {
      const html = generateNoOrdersInstallEmailHTML({ shopName: "Elio Varen", locale });
      expect(html, locale).toContain("Elio Varen");
      expect(html, locale).not.toContain("{shopName}");
      expect(html, locale).toContain(`<html lang="${locale}"`);
      expect(getNoOrdersInstallSubject(locale).length).toBeGreaterThan(0);
    }
    // Non-English locales must not silently fall back to English copy.
    const de = generateNoOrdersInstallEmailText({ shopName: "X", locale: "de" });
    expect(de).not.toContain("no order history");
  });

  it("avoids the CI-forbidden submission copy in every locale", () => {
    const forbidden = [
      ["submit", "response"].join(" "),
      ["submit", "to", "card", "network"].join(" "),
      ["file", "dispute", "response"].join(" "),
    ];
    for (const locale of LOCALE_LIST) {
      const html = generateNoOrdersInstallEmailHTML({ locale }).toLowerCase();
      for (const phrase of forbidden) expect(html, locale).not.toContain(phrase);
    }
  });
});

// ─── Sender variant + admin alert ─────────────────────────────────────────

interface ResendSendArgs {
  from: string;
  to: string | string[];
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

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({ is: () => ({ select: async () => ({ data: [{ id: "shop-1" }], error: null }) }) }),
      }),
    }),
  }),
}));

process.env.RESEND_API_KEY = "test-key";

describe("sendInstallWelcomeEmail variant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  const opts = {
    shopInternalId: "shop-1",
    shopDomain: "vkqq7k-d1.myshopify.com",
    to: "owner@eliovaren.com",
    shopName: "Elio Varen",
  };

  it("no_orders sends the 'couldn't set up' email, not the welcome", async () => {
    const { sendInstallWelcomeEmail } = await import("@/lib/email/sendInstallWelcome");
    const result = await sendInstallWelcomeEmail({ ...opts, variant: "no_orders" });

    expect(result.ok).toBe(true);
    const args = sendMock.mock.calls[0][0];
    expect(args.subject).toBe(getNoOrdersInstallSubject());
    expect(args.text).toContain("no order history");
    expect(args.html).not.toContain("already going through your orders");
  });

  it("default variant is still the normal welcome", async () => {
    const { sendInstallWelcomeEmail } = await import("@/lib/email/sendInstallWelcome");
    await sendInstallWelcomeEmail(opts);

    const args = sendMock.mock.calls[0][0];
    expect(args.subject).toContain("Welcome to DisputeDesk");
    expect(args.text).not.toContain("no order history");
  });
});

describe("sendAdminInstallNotification noOrders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("uses the 'Yet another store with no orders was installed' subject and headline", async () => {
    const { sendAdminInstallNotification } = await import(
      "@/lib/email/sendAdminNotification"
    );
    await sendAdminInstallNotification({
      shopDomain: "vkqq7k-d1.myshopify.com",
      shopName: "Elio Varen",
      email: "owner@eliovaren.com",
      source: "token-exchange",
      noOrders: true,
    });

    const args = sendMock.mock.calls[0][0];
    expect(args.subject).toBe(
      "Yet another store with no orders was installed: vkqq7k-d1.myshopify.com",
    );
    expect(args.html).toContain("Yet another store with no orders was installed");
    expect(args.text).toContain("Yet another store with no orders was installed");
    expect(args.text).toContain("vkqq7k-d1.myshopify.com");
  });

  it("keeps the normal subject when the store has orders", async () => {
    const { sendAdminInstallNotification } = await import(
      "@/lib/email/sendAdminNotification"
    );
    await sendAdminInstallNotification({ shopDomain: "ok-shop.myshopify.com" });

    const args = sendMock.mock.calls[0][0];
    expect(args.subject).toBe("New DisputeDesk install: ok-shop.myshopify.com");
    expect(args.text).not.toContain("no orders");
  });
});
