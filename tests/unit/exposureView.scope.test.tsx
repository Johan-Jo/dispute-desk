/**
 * The monthly chart opens on every payment method.
 *
 * Mein Maison, September 2026: 1 chargeback on cards (0.10% of card orders)
 * and 49 on PayPal. The card-only chart showed a quiet month for a shop with
 * 50 chargebacks. The card view, with the Visa thresholds, is one click away
 * and is what a trend without the all-method figures still shows.
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
import type { TrendPoint } from "@/lib/insights/period/readTrend";

const month = fixture as unknown as { programme: Record<string, unknown>; operational: Record<string, unknown>; checkpoints: unknown[] };
const period = {
  status: "ok",
  periodMonth: "2026-09-01",
  periodState: "final",
  finalOn: "2026-10-08T00:00:00.000Z",
  revision: 2,
  revisedAt: null,
  programme: { status: "ok", periodState: "final", finalOn: "2026-10-08T00:00:00.000Z", ...month.programme },
  operational: month.operational,
  checkpoints: month.checkpoints,
} as unknown as InsightsPeriod;

const CARDS: TrendPoint[] = [
  { periodMonth: "2026-08-01", periodState: "final", cardDisputeRatio: 0.00201, cardChargebackCount: 2, cardSettledCount: 995 },
  { periodMonth: "2026-09-01", periodState: "final", cardDisputeRatio: 0.00098, cardChargebackCount: 1, cardSettledCount: 1022 },
];
const ALL: TrendPoint[] = [
  { ...CARDS[0]!, allChargebackRate: 0.0219, allChargebackCount: 83, allCardChargebackCount: 2, allOrderCount: 3790 },
  { ...CARDS[1]!, allChargebackRate: 0.01332, allChargebackCount: 50, allCardChargebackCount: 1, allOrderCount: 3754 },
];

function render(trend: TrendPoint[], locale = "en", msgs: Record<string, unknown> = messages) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={msgs} timeZone="UTC">
      <AppProvider i18n={polarisEn}>
        <ExposureView
          period={period}
          trend={trend}
          monthOptions={[{ value: "2026-09-01", label: "September 2026" }]}
          selected="2026-09-01"
          onSelect={() => {}}
        />
      </AppProvider>
    </NextIntlClientProvider>,
  );
}

describe("ExposureView — chart scope", () => {
  const html = render(ALL);

  it("opens on all payment methods, with the switch to cards", () => {
    expect(html).toContain("Chargeback rate by month");
    expect(html).toContain(">All methods<");
    expect(html).toContain(">Cards only<");
    expect(html).toMatch(/aria-pressed="true"[^>]*>All methods</);
  });

  it("states the month across every method: 50 chargebacks of 3,754 orders", () => {
    expect(html).toContain("Sep 2026 · 1.33% — 50 chargebacks of 3,754 orders");
    expect(html).toContain("1 on cards · 49 on other methods");
  });

  it("does not draw or name the Visa thresholds on the all-methods chart", () => {
    const chart = html.slice(html.indexOf('data-screen-label="Ratio by month"'), html.indexOf('data-screen-label="Disputes by payment method"'));
    expect(chart).not.toContain("Visa early warning");
    expect(chart).not.toContain("below both thresholds");
    expect(chart).toContain("Visa and Mastercard only measure card payments");
  });

  it("keeps the card chart, thresholds included, when the trend has no all-method figures", () => {
    const cards = render(CARDS);
    expect(cards).toContain("Card dispute ratio by month");
    expect(cards).toContain("Visa early warning");
    expect(cards).toContain("Sep 2026 · 0.10% — below both thresholds");
    expect(cards).not.toContain(">All methods<");
  });

  it("renders in German without a missing key", () => {
    const g = render(ALL, "de", de as Record<string, unknown>);
    expect(g).toContain("Rückbuchungsquote nach Monat");
    expect(g).not.toContain("insightsPage.");
  });
});
