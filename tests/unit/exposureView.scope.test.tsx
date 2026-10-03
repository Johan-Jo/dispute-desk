/**
 * The monthly chart opens on every payment method, as a NUMBER of
 * chargebacks; the card ratio with the Visa thresholds is one click away.
 *
 * Two shop shapes, both from prod records of 2026-10-03, because one is not
 * enough: the first version plotted a rate, looked right on Mein Maison
 * (PayPal-heavy) and read LOWER than "Cards only" on blume-box (all
 * chargebacks on cards): 0.09% against 0.15% for the same 4 chargebacks.
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

/** Mein Maison: 1 card chargeback, 49 on PayPal. */
const MM_CARDS: TrendPoint[] = [
  { periodMonth: "2026-08-01", periodState: "final", cardDisputeRatio: 0.00201, cardChargebackCount: 2, cardSettledCount: 995 },
  { periodMonth: "2026-09-01", periodState: "final", cardDisputeRatio: 0.00098, cardChargebackCount: 1, cardSettledCount: 1022 },
];
const MM_ALL: TrendPoint[] = [
  { ...MM_CARDS[0]!, allChargebackCount: 83, allCardChargebackCount: 2, allOrderCount: 3790 },
  { ...MM_CARDS[1]!, allChargebackCount: 50, allCardChargebackCount: 1, allOrderCount: 3754 },
];
/** blume-box: every chargeback is on a card. */
const BB_ALL: TrendPoint[] = [
  { periodMonth: "2026-08-01", periodState: "final", cardDisputeRatio: 0.00214, cardChargebackCount: 7, cardSettledCount: 3274, allChargebackCount: 7, allCardChargebackCount: 7, allOrderCount: 4875 },
  { periodMonth: "2026-09-01", periodState: "final", cardDisputeRatio: 0.00149, cardChargebackCount: 4, cardSettledCount: 2686, allChargebackCount: 4, allCardChargebackCount: 4, allOrderCount: 4465 },
];

function render(
  trend: TrendPoint[],
  locale = "en",
  msgs: Record<string, unknown> = messages,
  opts: {
    scope?: "all" | "cards";
    period?: InsightsPeriod;
    previousReasons?: { periodMonth: string; byReason: Array<{ reason: string; disputes: number }> } | null;
  } = {},
) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={msgs} timeZone="UTC">
      <AppProvider i18n={polarisEn}>
        <ExposureView
          period={opts.period ?? period}
          previousReasons={opts.previousReasons ?? null}
          initialScope={opts.scope ?? "all"}
          trend={trend}
          monthOptions={[{ value: "2026-09-01", label: "September 2026" }]}
          selected="2026-09-01"
          onSelect={() => {}}
        />
      </AppProvider>
    </NextIntlClientProvider>,
  );
}
const chartOf = (html: string) =>
  html.slice(html.indexOf('data-screen-label="Ratio by month"'), html.indexOf('data-screen-label="Disputes by payment method"'));

describe("ExposureView — chart scope, PayPal-heavy shop (Mein Maison)", () => {
  const chart = chartOf(render(MM_ALL));

  it("opens on all payment methods, with the switch to cards", () => {
    expect(chart).toContain("Chargebacks by month");
    expect(chart).toContain(">All methods<");
    expect(chart).toContain(">Cards only<");
    expect(chart).toMatch(/aria-pressed="true"[^>]*>All methods</);
  });

  it("states the month as a count: 50 chargebacks of 3,754 orders", () => {
    expect(chart).toContain("Sep 2026 · 50 chargebacks of 3,754 orders");
    expect(chart).toContain("1 on cards · 49 on other methods");
  });

  it("labels the selected bar with the count, not a percentage", () => {
    expect(chart).toMatch(/>50<\/span>/);
  });

  it("does not draw or name the Visa thresholds on the all-methods chart", () => {
    expect(chart).not.toContain("Visa early warning");
    expect(chart).not.toContain("below both thresholds");
    expect(chart).toContain("Visa and Mastercard only measure card payments");
  });
});

describe("ExposureView — chart scope, card-only shop (blume-box)", () => {
  const chart = chartOf(render(BB_ALL));

  it("shows the same 4 chargebacks the card view counts, never a smaller figure", () => {
    expect(chart).toContain("Sep 2026 · 4 chargebacks of 4,465 orders");
    expect(chart).toContain("4 on cards · 0 on other methods");
    expect(chart).toMatch(/>4<\/span>/);
  });

  it("shows no percentage anywhere on the all-methods chart", () => {
    // 0.09% (4 of 4,465) under the card view's 0.15% (4 of 2,686) was the bug.
    // Visible text only: bar heights are inline styles in percent.
    const text = chart.replace(/<[^>]*>/g, " ");
    expect(text).toContain("4 chargebacks");
    expect(text).not.toMatch(/\d\s?%/);
  });

  it("averages counts, not rates, on the 3-month line", () => {
    expect(chart).toContain("3-month average 5.5");
  });
});

describe("ExposureView — chart scope, fallbacks and locales", () => {
  it("keeps the card chart, thresholds included, when the trend has no all-method figures", () => {
    const cards = chartOf(render(MM_CARDS));
    expect(cards).toContain("Card dispute ratio by month");
    expect(cards).toContain("Visa early warning");
    expect(cards).toContain("Sep 2026 · 0.10% — below both thresholds");
    expect(cards).not.toContain(">All methods<");
  });

  it("renders in German without a missing key", () => {
    const g = render(MM_ALL, "de", de as Record<string, unknown>);
    expect(g).toContain("Rückbuchungen nach Monat");
    expect(g).not.toContain("insightsPage.");
  });
});

/** The chargeback count a rendered chart states for September, per scope. */
function selectedCount(chart: string): number {
  const text = chart.replace(/<[^>]*>/g, " ");
  const m =
    /Sep 2026 · ([\d,]+) chargebacks? of/.exec(text) ??
    /Sep 2026 · [\d.]+%\s+([\d,]+) chargebacks?\s+of [\d,]+ card orders/.exec(text);
  if (!m) throw new Error("no count found in chart text: " + text.slice(0, 400));
  return Number(m[1]!.replace(/,/g, ""));
}

describe("ExposureView — the two scopes never contradict each other", () => {
  for (const [shop, trend] of [
    ["blume-box", BB_ALL],
    ["Mein Maison", MM_ALL],
  ] as const) {
    it(`${shop}: all methods states at least the chargebacks cards only states`, () => {
      const allChart = chartOf(render(trend, "en", messages, { scope: "all" }));
      const cardChart = chartOf(render(trend, "en", messages, { scope: "cards" }));
      const sep = trend[1]!;
      // Cards only: the card ratio view, with its own count in the tooltip.
      expect(cardChart).toContain("Card dispute ratio by month");
      expect(cardChart).toContain("Visa early warning");
      const cardCount = selectedCount(cardChart);
      expect(cardCount).toBe(sep.cardChargebackCount);
      // All methods: a count that contains the card count.
      const allCount = selectedCount(allChart);
      expect(allCount).toBe(sep.allChargebackCount);
      expect(allCount).toBeGreaterThanOrEqual(cardCount);
      // And says how many of them are the card view's chargebacks.
      expect(allChart).toContain(`${cardCount} on cards`);
    });
  }
});

describe("ExposureView — count average and empty months", () => {
  const FOUR: TrendPoint[] = [
    { periodMonth: "2026-06-01", periodState: "final", cardDisputeRatio: 0.004, cardChargebackCount: 22, cardSettledCount: 4789, allChargebackCount: 22, allCardChargebackCount: 22, allOrderCount: 7190 },
    { periodMonth: "2026-07-01", periodState: "final", cardDisputeRatio: 0.0237, cardChargebackCount: 75, cardSettledCount: 3166, allChargebackCount: 75, allCardChargebackCount: 75, allOrderCount: 5311 },
    ...BB_ALL,
  ];

  it("states the 3-month average in chargebacks, with its direction", () => {
    const chart = chartOf(render(FOUR));
    // (75 + 7 + 4) / 3 = 28.7 against June's own 22.
    expect(chart).toContain("3-month average 28.7 chargebacks, up from 22 in June");
  });

  it("draws no bar for a month without chargebacks", () => {
    const zero: TrendPoint[] = [{ ...BB_ALL[0]!, allChargebackCount: 0, allCardChargebackCount: 0 }, BB_ALL[1]!];
    expect(chartOf(render(zero))).toContain("height:0%");
  });
});

describe("ExposureView — figures that must match the table below them", () => {
  it("counts only the named method in the non-card note", () => {
    const op = {
      ...month.operational,
      byPaymentMethod: [
        { method: "paypal", brand: null, isCardNetwork: false, orders: 2000, chargebacks: 30, inquiries: 15, chargebackRate: 0.015, disputeRate: 0.0225 },
        { method: "klarna", brand: null, isCardNetwork: false, orders: 700, chargebacks: 4, inquiries: 0, chargebackRate: 0.00571, disputeRate: 0.00571 },
        { method: "card", brand: "Visa", isCardNetwork: true, orders: 1000, chargebacks: 13, inquiries: 0, chargebackRate: 0.013, disputeRate: 0.013 },
      ],
    };
    const html = render(MM_ALL, "en", messages, { period: { ...period, operational: op } as unknown as InsightsPeriod });
    // PayPal has 45 of the 62; Klarna's 4 are not PayPal claims.
    expect(html).toContain("45 of your 62 disputes this month were PayPal claims");
    expect(html).not.toContain("49 of your 62");
  });

  it("does not compare a month in progress with a complete month", () => {
    const mtd = {
      ...period,
      periodMonth: "2026-10-01",
      periodState: "mtd",
      operational: { ...month.operational, byReason: [{ reason: "FRAUDULENT", disputes: 2 }] },
    } as unknown as InsightsPeriod;
    const html = render(MM_ALL, "en", messages, {
      period: mtd,
      previousReasons: {
        periodMonth: "2026-09-01",
        byReason: [
          { reason: "FRAUDULENT", disputes: 40 },
          { reason: "PRODUCT_NOT_RECEIVED", disputes: 22 },
        ],
      },
    });
    const card = html.slice(html.indexOf('data-screen-label="Dispute reasons"'));
    expect(card).toContain("Dispute reasons · October vs September");
    expect(card).toContain(">40<"); // September's count is still shown
    expect(card).not.toContain("fewer than September");
    expect(card).not.toContain("−38");
  });
});
