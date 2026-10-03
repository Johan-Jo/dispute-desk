/**
 * The redesigned Chargeback Exposure page renders a REAL month record.
 *
 * Fixture: Mein Maison, September 2026, computed on prod data (2026-10-02) by
 * `computeShopMonth` — a PayPal-heavy book with ~1,000 card orders. A real
 * render through the real providers catches what pure-function tests cannot:
 * a missing translation key, a field the view reads that the record does not
 * carry, or a crash on a real shape.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AppProvider } from "@shopify/polaris";
import polarisEn from "@shopify/polaris/locales/en.json";
import messages from "@/messages/en.json";
import de from "@/messages/de.json";
import fixture from "@/lib/insights/period/__tests__/fixtures/meinmaison-2026-09.json";
import { ExposureView } from "@/app/(embedded)/app/insights/initial-analysis/ExposureView";
import type { InsightsPeriod } from "@/lib/insights/period/readInsightsPeriod";

const month = fixture as unknown as {
  programme: Record<string, unknown>;
  operational: Record<string, unknown>;
  checkpoints: unknown[];
};

const period = {
  status: "ok",
  periodMonth: "2026-09-01",
  periodState: "final",
  finalOn: "2026-10-08T00:00:00.000Z",
  revision: 2,
  revisedAt: "2026-10-09T02:00:00.000Z",
  programme: { status: "ok", periodState: "final", finalOn: "2026-10-08T00:00:00.000Z", ...month.programme },
  operational: month.operational,
  checkpoints: month.checkpoints,
} as unknown as InsightsPeriod;

const AUGUST = {
  periodMonth: "2026-08-01",
  byReason: [
    { reason: "FRAUDULENT", disputes: 3 },
    { reason: "PRODUCT_NOT_RECEIVED", disputes: 1 },
    { reason: "CREDIT_NOT_PROCESSED", disputes: 1 },
  ],
};
const withReasons = (previous: typeof AUGUST | null, locale = "en", msgs: Record<string, unknown> = messages) =>
  render(
    {
      ...period,
      operational: {
        ...month.operational,
        byReason: [
          { reason: "FRAUDULENT", disputes: 2 },
          { reason: "PRODUCT_NOT_RECEIVED", disputes: 1 },
          { reason: "PRODUCT_UNACCEPTABLE", disputes: 1 },
        ],
      },
    } as unknown as InsightsPeriod,
    locale,
    msgs,
    previous,
  );

function render(
  p: InsightsPeriod,
  locale = "en",
  msgs: Record<string, unknown> = messages,
  previousReasons: typeof AUGUST | null = null,
) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={msgs} timeZone="UTC">
      <AppProvider i18n={polarisEn}>
        <ExposureView
          period={p}
          previousReasons={previousReasons}
          trend={[
            { periodMonth: "2026-08-01", periodState: "final", cardDisputeRatio: 0.00201, cardChargebackCount: 2, cardSettledCount: 995 },
            { periodMonth: "2026-09-01", periodState: "final", cardDisputeRatio: 0.00098, cardChargebackCount: 1, cardSettledCount: 1022 },
          ]}
          monthOptions={[{ value: "2026-09-01", label: "September 2026" }]}
          selected="2026-09-01"
          onSelect={() => {}}
        />
      </AppProvider>
    </NextIntlClientProvider>,
  );
}

describe("ExposureView — Mein Maison, September 2026 (prod record)", () => {
  const html = render(period);

  it("shows the card verdict for a PayPal-heavy shop, not 'not applicable'", () => {
    expect(html).toContain("Card dispute ratio · estimate");
    expect(html).toContain("0.10%");
    expect(html).toContain("1 chargeback of 1,022 card orders");
  });

  it("says the Visa floor count is Visa's, beside a fraction that counts every card chargeback", () => {
    // "1 / 1,022" (all card chargebacks) next to "you had 0" read as two
    // counts of the same thing.
    expect(html).toMatch(/you had \d+ on Visa/);
  });

  it("explains that most disputes were PayPal claims", () => {
    expect(html).toMatch(/of your \d+ disputes this month were PayPal claims/);
  });

  it("lists disputes by payment method with PayPal first", () => {
    expect(html).toContain("Disputes by payment method");
    expect(html.indexOf(">PayPal<")).toBeGreaterThan(-1);
    expect(html.indexOf(">PayPal<")).toBeLessThan(html.indexOf(">Card (typed in)<"));
  });

  it("shows Protect coverage near 0%, never 100%", () => {
    expect(html).toContain("Shopify Protect");
    expect(html).not.toContain(">100%<");
  });

  it("renders the stored checkpoints, the first marked In email", () => {
    expect(html).toContain("In email");
  });

  it("leads with the trend: chart, then payment methods, then the card verdict", () => {
    const order = ["Ratio by month", "Disputes by payment method", "Card-network exposure", "Checkpoints", "Protection"].map(
      (label) => html.indexOf(`data-screen-label="${label}"`),
    );
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("3-month average");
    expect(html).toContain("Sep 2026 · 0.10% — below both thresholds");
  });

  it("keeps methods without disputes folded until asked for", () => {
    expect(html).toMatch(/With disputes · \d+/);
    expect(html).toMatch(/No disputes this month · \d+/);
    expect(html).toContain(">Show<");
  });

  it("renders in German without a missing key", () => {
    const de_ = render(period, "de", de as Record<string, unknown>);
    expect(de_).toContain("Streitfälle nach Zahlungsart");
    expect(de_).not.toContain("insightsPage.");
  });

  it("leaves the reasons card out for a record written before reasons were stored", () => {
    expect(html).not.toContain('data-screen-label="Dispute reasons"');
  });

  it("compares dispute reasons with the month before, after the protection card", () => {
    const r = withReasons(AUGUST);
    expect(r.indexOf('data-screen-label="Dispute reasons"')).toBeGreaterThan(r.indexOf('data-screen-label="Protection"'));
    expect(r).toContain("Dispute reasons · September vs August");
    expect(r).toContain("4 disputes");
    expect(r).toContain("1 fewer than August");
    expect(r).toContain(">Fraudulent<");
    expect(r).toContain("50% of September");
    expect(r).toContain(">Not as described<");
    expect(r).toContain(">New<");
    expect(r).toContain(">Credit not processed<");
    expect(r).toContain("None in September");
    expect(r).toContain(">−1<");
  });

  it("shows a dash, not zero, when the month before has no reasons on record", () => {
    const r = withReasons(null);
    expect(r).toContain("Dispute reasons · September vs August");
    expect(r).not.toContain("than August");
    expect(r).not.toContain(">New<");
  });

  it("renders the reasons card in German without a missing key", () => {
    const r = withReasons(AUGUST, "de", de as Record<string, unknown>);
    expect(r).toContain("Streitfallgründe · September vs. August");
    expect(r).toContain("1 weniger als im August");
    expect(r).not.toContain("insightsPage.");
  });

  it("says not available, never a blank page, for a month without a record", () => {
    const na = render({ status: "not_available", periodMonth: "2026-04-01" } as InsightsPeriod);
    expect(na).toContain("Not available for this month");
  });
});
