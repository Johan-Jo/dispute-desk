/**
 * The evidence-needed email renders from messages/*.json in the merchant's language: no unresolved
 * placeholder, no raw key, the amount in the dispute currency (it used to be a hard-coded "$"), and the
 * honesty rules of the English original still hold in every locale.
 */
import { describe, expect, it } from "vitest";
import { renderEvidenceNeededEmail } from "../sendEvidenceNeededAlert";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import es from "@/messages/es.json";
import fr from "@/messages/fr.json";
import pt from "@/messages/pt.json";
import sv from "@/messages/sv.json";

const CATALOGS = { en, de, es, fr, pt, sv } as const;
const asMessages = (m: unknown) => m as Record<string, unknown>;

const BASE = {
  shopName: "blume-box.myshopify.com",
  shopDomain: "blume-box.myshopify.com",
  disputeId: "5355f2e1-7d43-4f0a-8864-b536825250a8",
  disputeReason: "PRODUCT_NOT_RECEIVED",
  disputeAmount: "599",
  disputeCurrency: "SEK",
  packId: "pack-1",
  storeTypes: ["physical"],
  orderName: "#352515",
  locale: "en",
};

const MODES = {
  review: { ...BASE, hasRealDeliveryProof: true, hasRealSupportComms: true, pendingSupportReview: false },
  askUpload: { ...BASE, hasRealDeliveryProof: false, hasRealSupportComms: false, pendingSupportReview: false },
  askReview: { ...BASE, hasRealDeliveryProof: true, hasRealSupportComms: false, pendingSupportReview: true, pendingSupportCount: 2 },
} as const;

describe("renderEvidenceNeededEmail", () => {
  for (const [locale, messages] of Object.entries(CATALOGS)) {
    for (const [mode, ctx] of Object.entries(MODES)) {
      it(`${locale}/${mode}: resolves every placeholder, names the order, links the dispute`, () => {
        const r = renderEvidenceNeededEmail({ ...ctx, locale }, asMessages(messages));
        const all = `${r.subject}\n${r.html}\n${r.text}`;
        expect(all).not.toMatch(/\{[a-zA-Z]+\}/);
        expect(all).not.toMatch(/email\.evidenceNeeded|packs\.disputeTypeLabel/);
        expect(all).not.toMatch(/\*\*/);
        expect(r.subject).toContain("#352515");
        expect(r.html).toContain("admin.shopify.com/store/blume-box/apps/disputedesk-1?ddredirect=");
        expect(r.locale).toBe(locale);
      });
    }
  }

  it("the amount is in the dispute currency, in the merchant's locale (no hard-coded dollar sign)", () => {
    const r = renderEvidenceNeededEmail({ ...MODES.review, locale: "sv" }, asMessages(sv));
    expect(r.subject).toMatch(/599,00\s?kr/);
    expect(`${r.subject}${r.html}${r.text}`).not.toContain("$");
    const noCurrency = renderEvidenceNeededEmail({ ...MODES.review, disputeCurrency: null }, asMessages(en));
    expect(noCurrency.subject).toContain("(599)");
  });

  it("ask mode asks for the carrier proof; review mode asks for nothing", () => {
    const ask = renderEvidenceNeededEmail(MODES.askUpload, asMessages(en));
    expect(ask.html).toContain("Carrier delivery proof");
    const review = renderEvidenceNeededEmail(MODES.review, asMessages(en));
    expect(review.html).not.toContain("Carrier delivery proof");
    expect(review.html).toContain("Delivery confirmation");
    expect(review.html).toContain("Customer support conversations");
  });

  it("only claims attachments it has, in every locale", () => {
    for (const [locale, messages] of Object.entries(CATALOGS)) {
      const none = renderEvidenceNeededEmail({ ...MODES.askUpload, locale }, asMessages(messages));
      expect(none.html, locale).not.toContain(CATALOGS[locale as keyof typeof CATALOGS].email.evidenceNeeded.attachedTitle);
    }
  });

  it("the pending-review count is pluralised and deep-links the review section", () => {
    const two = renderEvidenceNeededEmail(MODES.askReview, asMessages(en));
    expect(two.html).toContain("2 matched support conversations are waiting for your review");
    expect(two.html).toContain("gorgias-comms");
    const one = renderEvidenceNeededEmail({ ...MODES.askReview, pendingSupportCount: 1 }, asMessages(en));
    expect(one.html).toContain("1 matched support conversation is waiting for your review");
  });

  it("an unknown locale falls back to English", () => {
    expect(renderEvidenceNeededEmail({ ...MODES.review, locale: "xx" }, asMessages(en)).locale).toBe("en");
  });

  it("never asks for digital access logs or usage records", () => {
    for (const [locale, messages] of Object.entries(CATALOGS)) {
      for (const ctx of Object.values(MODES)) {
        const r = renderEvidenceNeededEmail({ ...ctx, locale }, asMessages(messages));
        expect(`${r.html}${r.text}`.toLowerCase()).not.toMatch(/digital access|usage record/);
      }
    }
  });
});
