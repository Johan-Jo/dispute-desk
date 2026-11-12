/**
 * The refund-advice email renders in all six locales from messages/*.json, resolves every placeholder, and says
 * nothing it cannot back (no "in full", no promise that the inquiry will close, no fee amount).
 */
import { describe, expect, it } from "vitest";
import { renderRefundAdviceEmail } from "../sendRefundAdviceAlert";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import es from "@/messages/es.json";
import fr from "@/messages/fr.json";
import pt from "@/messages/pt.json";
import sv from "@/messages/sv.json";

const CATALOGS = { en, de, es, fr, pt, sv } as const;
const asMessages = (m: unknown) => m as Record<string, unknown>;

const ctx = {
  locale: "en",
  variant: "none" as const,
  shopDomain: "whj8db-1q.myshopify.com",
  disputeId: "61cc006c-7447-4141-b2c4-0e398cfc1b47",
  orderName: "#23527",
  amount: 1468,
  currencyCode: "SEK",
  dueAt: "2026-11-21T23:00:00Z",
};

describe("renderRefundAdviceEmail", () => {
  for (const [locale, messages] of Object.entries(CATALOGS)) {
    for (const variant of ["none", "failed"] as const) {
      it(`${locale}/${variant}: no unresolved placeholder, no raw key, links the dispute`, () => {
        const r = renderRefundAdviceEmail({ ...ctx, locale, variant }, asMessages(messages));
        const all = `${r.subject}\n${r.html}\n${r.text}`;
        expect(all).not.toMatch(/\{[a-zA-Z]+\}/);
        expect(all).not.toMatch(/email\.refundAdvice/);
        expect(r.subject).toContain("#23527");
        expect(r.html).toContain("admin.shopify.com/store/whj8db-1q/apps/disputedesk-1?ddredirect=");
        expect(r.html).toContain(encodeURIComponent("/disputes/61cc006c-7447-4141-b2c4-0e398cfc1b47"));
        expect(r.locale).toBe(locale);
      });
    }
  }

  it("falls back to English for an unknown locale", () => {
    const r = renderRefundAdviceEmail({ ...ctx, locale: "xx" }, asMessages(en));
    expect(r.locale).toBe("en");
    expect(r.subject).toMatch(/Order #23527/);
  });

  it("formats the amount and the due date in the merchant locale", () => {
    const r = renderRefundAdviceEmail({ ...ctx, locale: "sv" }, asMessages(sv));
    expect(r.text).toMatch(/1\s468,00/);
    expect(r.text).toMatch(/21 november 2026/);
  });

  it("asks for the disputed amount, never 'in full', and does not promise a result or name a fee amount", () => {
    const r = renderRefundAdviceEmail(ctx, asMessages(en));
    expect(r.text).toMatch(/refund the disputed amount/i);
    expect(r.text).not.toMatch(/in full/i);
    expect(r.text).not.toMatch(/will close|guarantee|automatic response|submit response|submit to card network|file dispute response/i);
    expect(r.text).not.toMatch(/\$\s?\d/);
    expect(r.text).toMatch(/not do it for you/i);
  });

  it("the failed variant is its own copy", () => {
    const none = renderRefundAdviceEmail({ ...ctx, variant: "none" }, asMessages(en));
    const failed = renderRefundAdviceEmail({ ...ctx, variant: "failed" }, asMessages(en));
    expect(failed.subject).not.toBe(none.subject);
    expect(failed.text).toMatch(/did not go through|failed/i);
  });
});
