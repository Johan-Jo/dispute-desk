"use client";

/**
 * Chargeback Exposure — the month view, transcribed from the Claude Design
 * file "Chargeback Exposure Alternatives" (variant 1a, Trend hero;
 * 2026-10-03). Every number comes from the stored month record (`period`)
 * and the records-only trend; nothing is computed here except display
 * formatting through lib/insights/period/format.ts and the chart's
 * 3-month average (lib/insights/period/trendAverage.ts).
 */

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Select } from "@shopify/polaris";

import type { CheckpointSeverity } from "@/lib/insights/checkpoints.types";
import type { InsightsPeriod } from "@/lib/insights/period/readInsightsPeriod";
import type { TrendPoint } from "@/lib/insights/period/readTrend";
import type { PaymentMethodRow } from "@/lib/insights/period/computeOperationalMetrics";
import {
  formatCheckpointValues,
  formatCount,
  formatMonth,
  formatRatio,
} from "@/lib/insights/period/format";
import { trendAverage } from "@/lib/insights/period/trendAverage";
import { hasAllMethods, trendBarValue } from "@/lib/insights/period/trendScope";
import { compareReasons, type PreviousReasons } from "@/lib/insights/period/reasonComparison";
import { addMonths } from "@/lib/insights/period/months";
import { MC_ECM_COUNT_FLOOR, MC_ECM_RATIO, VAMP_COUNT_FLOOR, VAMP_EARLY_WARNING, VAMP_EXCESSIVE } from "@/lib/insights/programmeThresholds";
import s from "./exposure.module.css";

const PRIMARY = "#1D4ED8";
const WARNING = "#F59E0B";
const DANGER = "#EF4444";
const INFO = "#0EA5E9";
/** Unselected-month tints of the two stacked parts. */
const PRIMARY_SOFT = "#BFD0F7";
const INFO_SOFT = "#BAE6FD";

const SEV: Record<CheckpointSeverity, { badge: string; dotBg: string; dotFg: string }> = {
  healthy: { badge: s.bSuccess, dotBg: "#DCFCE7", dotFg: "#166534" },
  info: { badge: s.bDefault, dotBg: "#F1F5F9", dotFg: "#64748B" },
  consider: { badge: s.bWarning, dotBg: "#FEF3C7", dotFg: "#92400E" },
  breach: { badge: s.bDanger, dotBg: "#FEE2E2", dotFg: "#991B1B" },
};

/** Chart ceiling, the bar scales of the exposure rows and the payment table. */
const CHART_MAX = 0.025;
const PROGRAMME_SCALE = 0.02;
const METHOD_REFERENCE = 0.01;
/** Lowest top of the all-methods chart, so one chargeback is not a full bar. */
const COUNT_CHART_MIN = 5;

/** Method keys with their own name; anything else is shown as stored. */
const METHOD_KEYS = new Set([
  "card", "shopify_pay", "shop_pay", "apple_pay", "google_pay", "shop_pay_installments",
  "paypal", "klarna", "amazon_pay", "tiktok_shop", "gift_card", "shop_cash", "unknown",
]);

/** Shopify dispute reasons with their own name; anything else is shown as stored. */
const REASON_KEYS = new Set([
  "BANK_CANNOT_PROCESS", "CREDIT_NOT_PROCESSED", "CUSTOMER_INITIATED", "DEBIT_NOT_AUTHORIZED",
  "DUPLICATE", "FRAUDULENT", "GENERAL", "INCORRECT_ACCOUNT_DETAILS", "INSUFFICIENT_FUNDS",
  "NONCOMPLIANT", "PRODUCT_NOT_RECEIVED", "PRODUCT_UNACCEPTABLE", "SUBSCRIPTION_CANCELLED",
  "UNRECOGNIZED", "UNKNOWN",
]);

/** A month's methods, with small quiet ones folded into one "Other" row. */
function displayMethods(rows: PaymentMethodRow[]): Array<PaymentMethodRow & { other?: number }> {
  const keep = rows.filter((r) => r.orders >= 50 || r.chargebacks + r.inquiries > 0);
  const fold = rows.filter((r) => !keep.includes(r));
  if (fold.length === 0) return keep;
  return [
    ...keep,
    {
      method: "other", brand: null, isCardNetwork: false,
      orders: fold.reduce((n, r) => n + r.orders, 0), chargebacks: 0, inquiries: 0,
      chargebackRate: null, disputeRate: null, other: fold.length,
    },
  ];
}

export function ExposureView({
  period,
  trend,
  previousReasons = null,
  monthOptions,
  selected,
  onSelect,
  initialScope = "all",
}: {
  /** Which chart view opens first. */
  initialScope?: "all" | "cards";
  period: InsightsPeriod;
  trend: TrendPoint[];
  /** The month before `period`; null when it has no reasons on record. */
  previousReasons?: PreviousReasons | null;
  /** Value "YYYY-MM-01" or "mtd". */
  monthOptions: Array<{ value: string; label: string }>;
  selected: string;
  onSelect: (value: string) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [showZero, setShowZero] = useState(false);
  /** "all" = chargebacks on every payment method; "cards" = the ratio the
   *  card networks judge, with their thresholds. */
  const [scope, setScope] = useState<"all" | "cards">(initialScope);
  const ip = (k: string, v?: Record<string, string | number>) => t(`insightsPage.${k}` as never, v as never);
  const month = formatMonth(period.periodMonth, locale);
  const shortDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
  const monthPart = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" }).format(new Date(`${iso.slice(0, 7)}-15T12:00:00Z`));

  // ── State badge + the line under "Thresholds verified" ────────────
  let state: { text: string; badge: string };
  let stateLine: string;
  if (period.status === "ok") {
    if (period.periodState === "final") {
      state = {
        text: period.revisedAt ? ip("stateFinalUpdated", { date: shortDate(period.revisedAt) }) : ip("stateFinal"),
        badge: s.bSuccess,
      };
      stateLine = ip("headerSubFinal", { month });
    } else if (period.periodState === "provisional") {
      state = { text: ip("stateProvisional", { date: shortDate(period.finalOn) }), badge: s.bWarning };
      stateLine = ip("headerSubProvisional", { month, date: shortDate(period.finalOn) });
    } else {
      state = { text: ip("stateMtd", { date: shortDate(new Date().toISOString()) }), badge: s.bInfo };
      stateLine = ip("headerSubMtd", { month });
    }
  } else if (period.status === "not_fully_imported") {
    state = { text: ip("stateNotFullyImported"), badge: s.bDefault };
    stateLine = ip("headerSubNotFullyImported");
  } else {
    state = { text: ip(period.status === "error" ? "stateFinal" : "stateNotAvailable"), badge: s.bDefault };
    stateLine = ip("headerSubNotAvailable");
  }

  const ok = period.status === "ok" ? period : null;
  const p = ok?.programme;
  const op = ok?.operational;
  const sevLabel = (sev: CheckpointSeverity) => t(`fraudIntel.checkpointSeverity.${sev}` as never);
  const methodName = (r: PaymentMethodRow & { other?: number }) =>
    r.method === "other"
      ? ip("methodOther", { count: r.other ?? 0 })
      : METHOD_KEYS.has(r.method)
        ? ip(`method.${r.method}`)
        : r.method;

  // ── Notes under the exposure block ────────────────────────────────
  const notes: string[] = [];
  if (p && p.unknownPaymentShare !== null && p.unknownPaymentShare > 0.2) {
    notes.push(ip("noteUnknownPayment", { pct: formatRatio(p.unknownPaymentShare, locale, 0) }));
  }
  if (op) {
    const totalDisputes = op.byPaymentMethod.reduce((n, r) => n + r.chargebacks + r.inquiries, 0);
    const nonCard = op.byPaymentMethod.filter((r) => !r.isCardNetwork && r.method !== "unknown");
    const nonCardDisputes = nonCard.reduce((n, r) => n + r.chargebacks + r.inquiries, 0);
    const top = [...nonCard].sort((a, b) => b.chargebacks + b.inquiries - (a.chargebacks + a.inquiries))[0];
    if (top && totalDisputes > 0 && nonCardDisputes * 2 > totalDisputes) {
      // The sentence names ONE method, so the count is that method's own
      // disputes. It used to be every non-card dispute: PayPal 45 + Klarna 4
      // read "49 … were PayPal claims" above a table showing PayPal at 45.
      notes.push(ip("noteNonCard", { count: top.chargebacks + top.inquiries, total: totalDisputes, method: methodName(top) }));
    }
  }

  // ── Ratio by month ────────────────────────────────────────────────
  // A trend without the all-method figures (older API payloads, records
  // without a payment-method split) only has the card view.
  const hasAll = hasAllMethods(trend);
  const all = scope === "all" && hasAll;
  // All methods: a bar is a NUMBER of chargebacks. Cards only: the ratio.
  const valueOf = (x: TrendPoint) => trendBarValue(x, all ? "all" : "cards");
  const fmtValue = (v: number | null) =>
    all
      ? v === null
        ? "—"
        : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(v)
      : formatRatio(v, locale);
  const max = Math.max(all ? COUNT_CHART_MIN : CHART_MAX, ...trend.map((x) => (valueOf(x) ?? 0) * 1.1));
  const up = (v: number) => `${(v / max) * 100}%`;
  const avg = trendAverage(trend.map(valueOf));
  const avgPoints = avg.flatMap((a, i) => (a === null ? [] : [{ i, a }]));
  const selectedPoint = trend.find((x) => x.periodMonth === period.periodMonth);
  const selectedText = all
    ? selectedPoint && selectedPoint.allChargebackCount !== null && selectedPoint.allChargebackCount !== undefined
      ? ip("trendSelectedAll", {
          month: monthPart(selectedPoint.periodMonth, { month: "short", year: "numeric" }),
          n: selectedPoint.allChargebackCount,
          d: formatCount(selectedPoint.allOrderCount, locale),
        })
      : null
    : selectedPoint && selectedPoint.cardDisputeRatio !== null
      ? ip("trendSelected", {
          month: monthPart(selectedPoint.periodMonth, { month: "short", year: "numeric" }),
          ratio: formatRatio(selectedPoint.cardDisputeRatio, locale),
          status: ip(
            selectedPoint.cardDisputeRatio >= VAMP_EXCESSIVE
              ? "trendStatusExcessive"
              : selectedPoint.cardDisputeRatio >= VAMP_EARLY_WARNING
                ? "trendStatusEarlyWarning"
                : "trendStatusBelow",
          ),
        })
      : null;
  let trendText: string | null = null;
  const now3 = avg[avg.length - 1] ?? null;
  const prev3 = avg[avg.length - 4] ?? null;
  if (now3 !== null) {
    const now = fmtValue(now3);
    const prev = prev3 === null ? null : fmtValue(prev3);
    trendText =
      prev === null || prev === now
        ? ip(all ? "trendAverageAllOnly" : "trendAverageOnly", { now })
        : ip(now3 < prev3! ? (all ? "trendAverageAllDown" : "trendAverageDown") : all ? "trendAverageAllUp" : "trendAverageUp", {
            now,
            prev,
            month: monthPart(trend[trend.length - 4]!.periodMonth, { month: "long" }),
          });
  }

  // ── Disputes by payment method ────────────────────────────────────
  const methods = (op ? displayMethods(op.byPaymentMethod) : []).map((r) => ({
    ...r,
    name: methodName(r),
    flagged: r.chargebackRate !== null && r.chargebackRate >= METHOD_REFERENCE,
  }));
  const activeRows = methods.filter((r) => r.chargebacks + r.inquiries > 0);
  const zeroRows = methods.filter((r) => r.chargebacks + r.inquiries === 0);
  const flagged = methods.filter((r) => r.flagged);
  const referencePct = formatRatio(METHOD_REFERENCE, locale, 0);

  // ── Dispute reasons, this month against the one before ────────────
  const reasons = op?.byReason ? compareReasons(op.byReason, previousReasons?.byReason ?? null) : null;
  const prevMonthIso = addMonths(period.periodMonth, -1);
  const monthLong = monthPart(period.periodMonth, { month: "long" });
  const prevLong = monthPart(prevMonthIso, { month: "long" });
  const reasonWidth = (n: number) => (n > 0 ? `${Math.max((n / (reasons?.max ?? 1)) * 100, 4)}%` : "0%");
  // "So far this month" is part of a month. Set against a complete month it
  // would always read as fewer, in green: on 3 October, "2 disputes, 60 fewer
  // than September". The previous month's counts stay; the comparison goes.
  const partialMonth = ok?.periodState === "mtd";
  const reasonRows = (reasons?.rows ?? []).map((r) => (partialMonth ? { ...r, change: null, isNew: false } : r));
  const totalChange =
    reasons && !partialMonth && reasons.previousTotal !== null ? reasons.currentTotal - reasons.previousTotal : null;

  const checkpoints = ok ? ok.checkpoints.slice(0, 5) : [];
  const threeDsSeverity = ok?.checkpoints.find((c) => c.id === "threeds_auth")?.severity;
  const threeDsFlagged = threeDsSeverity === "consider" || threeDsSeverity === "breach";
  const cols = { gridTemplateColumns: `repeat(${trend.length}, minmax(0, 1fr))` };

  return (
    <div className={s.wrap} data-screen-label="Chargeback Exposure page">
      <div className={s.header} data-screen-label="Header">
        <div className={s.subtitle}>{ip("subtitle")}</div>
        <div className={s.headerRight}>
          <span className={`${s.badge} ${state.badge}`}>{state.text}</span>
          <div className={s.select}>
            <Select label={ip("monthSelectLabel")} labelHidden options={monthOptions} value={selected} onChange={onSelect} />
          </div>
        </div>
      </div>

      {/* ── Card dispute ratio by month ───────────────────────────── */}
      {trend.length > 0 && (
        <div className={s.trend} data-screen-label="Ratio by month">
          <div className={s.trendHead}>
            <div className={s.titleBlock}>
              <div className={s.cardTitle}>{ip(all ? "trendTitleAll" : "trendTitle")}</div>
              <div className={s.cardSub}>{ip("trendSub", { count: trend.length })}</div>
            </div>
            <div className={s.trendControls}>
              {hasAll && (
                <div className={s.scope} role="group" aria-label={ip("trendScopeLabel")}>
                  {(["all", "cards"] as const).map((k) => (
                    <button
                      type="button"
                      key={k}
                      className={`${s.scopeBtn} ${scope === k ? s.scopeBtnOn : ""}`}
                      aria-pressed={scope === k}
                      onClick={() => setScope(k)}
                    >
                      {ip(k === "all" ? "trendScopeAll" : "trendScopeCards")}
                    </button>
                  ))}
                </div>
              )}
            <div className={s.legend}>
              {all ? (
                <>
                  <span className={s.legendItem}>
                    <span className={s.legendSwatch} style={{ background: PRIMARY }} />
                    {ip("legendCards")}
                  </span>
                  <span className={s.legendItem}>
                    <span className={s.legendSwatch} style={{ background: INFO }} />
                    {ip("legendOther")}
                  </span>
                </>
              ) : (
                <>
                  <span className={s.legendItem}>
                    <span className={s.legendLine} style={{ borderColor: WARNING }} />
                    {ip("legendEarlyWarning", { pct: formatRatio(VAMP_EARLY_WARNING, locale, 1) })}
                  </span>
                  <span className={s.legendItem}>
                    <span className={s.legendLine} style={{ borderColor: DANGER }} />
                    {ip("legendExcessive", { pct: formatRatio(VAMP_EXCESSIVE, locale, 1) })}
                  </span>
                </>
              )}
              <span className={s.legendItem}>
                <span className={s.legendLine} style={{ borderTopStyle: "solid", borderColor: "#0B1220" }} />
                {ip("legendAverage")}
              </span>
            </div>
            </div>
          </div>
          <div className={s.chart}>
            {!all && <div className={s.tline} style={{ bottom: up(VAMP_EARLY_WARNING), borderColor: WARNING }} />}
            {!all && <div className={s.tline} style={{ bottom: up(VAMP_EXCESSIVE), borderColor: DANGER }} />}
            <div className={s.baseline} />
            <div className={s.bars} style={cols}>
              {trend.map((x) => {
                const v = valueOf(x);
                const sel = x.periodMonth === period.periodMonth;
                // All methods: one bar, the card part below the other methods.
                const cardPart =
                  all && x.allChargebackCount ? (x.allCardChargebackCount ?? 0) / x.allChargebackCount : 1;
                const tone = v !== null && v >= VAMP_EXCESSIVE ? DANGER : v !== null && v >= VAMP_EARLY_WARNING ? WARNING : PRIMARY;
                const soft = v !== null && v >= VAMP_EXCESSIVE ? "#FCA5A5" : v !== null && v >= VAMP_EARLY_WARNING ? "#FCD34D" : "#BFD0F7";
                const h = v === null || (all && v === 0) ? "0%" : `${Math.max((v / max) * 100, 1.5)}%`;
                return (
                  <button
                    type="button"
                    key={x.periodMonth}
                    className={s.barCol}
                    onClick={() => onSelect(x.periodMonth)}
                    aria-label={`${formatMonth(x.periodMonth, locale)}: ${all && v !== null ? ip("tipChargebacks", { n: v }) : fmtValue(v)}`}
                  >
                    <span
                      className={s.barLabel}
                      style={
                        all
                          ? { color: sel ? "#0B1220" : "#667085", opacity: v !== null && sel ? 1 : 0 }
                          : { color: sel ? tone : "#667085", opacity: v !== null && (sel || v >= VAMP_EARLY_WARNING) ? 1 : 0 }
                      }
                    >
                      {fmtValue(v)}
                    </span>
                    {all ? (
                      <span className={`${s.bar} ${s.barStack}`} style={{ height: h }}>
                        <span style={{ flex: `${1 - cardPart} 1 0`, background: sel ? INFO : INFO_SOFT }} />
                        <span style={{ flex: `${cardPart} 1 0`, background: sel ? PRIMARY : PRIMARY_SOFT }} />
                      </span>
                    ) : (
                      <span className={s.bar} style={{ height: h, background: sel ? tone : soft }} />
                    )}
                    {v !== null && (
                      <span className={s.tip} style={{ bottom: `calc(${h} + 28px)` }}>
                        <span className={s.tipDim}>
                          {monthPart(x.periodMonth, { month: "short", year: "numeric" })}
                          {!all && <> · {formatRatio(v, locale)}</>}
                        </span>
                        {all ? (
                          <>
                            <span className={s.tipMain}>{ip("tipChargebacks", { n: x.allChargebackCount ?? 0 })}</span>
                            <span className={s.tipDim}>{ip("tipOrdersAll", { d: formatCount(x.allOrderCount, locale) })}</span>
                            <span className={s.tipDim}>
                              {ip("tipSplit", {
                                cards: formatCount(x.allCardChargebackCount ?? 0, locale),
                                other: formatCount((x.allChargebackCount ?? 0) - (x.allCardChargebackCount ?? 0), locale),
                              })}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className={s.tipMain}>{ip("tipChargebacks", { n: x.cardChargebackCount ?? 0 })}</span>
                            <span className={s.tipDim}>{ip("tipOrders", { d: formatCount(x.cardSettledCount, locale) })}</span>
                          </>
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <svg className={s.avgLine} viewBox={`0 0 ${trend.length * 100} 100`} preserveAspectRatio="none" aria-hidden="true">
              <polyline
                points={avgPoints.map(({ i, a }) => `${i * 100 + 50},${(100 - (a / max) * 100).toFixed(2)}`).join(" ")}
                fill="none"
                stroke="#0B1220"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {avgPoints.map(({ i, a }) => (
              <span key={i} className={s.avgDot} style={{ left: `${(i * 100 + 50) / trend.length}%`, bottom: up(a) }} />
            ))}
          </div>
          <div className={s.mlabels} style={cols}>
            {trend.map((x) => {
              const sel = x.periodMonth === period.periodMonth;
              return (
                <span key={x.periodMonth} className={s.mlabel} style={{ color: sel ? "#0B1220" : "#667085", fontWeight: sel ? 600 : 400 }}>
                  <span className={s.mlabLong}>{monthPart(x.periodMonth, { month: "short" })}</span>
                  <span className={s.mlabShort}>{monthPart(x.periodMonth, { month: "narrow" })}</span>
                </span>
              );
            })}
          </div>
          <div className={s.trendFoot}>
            <span className={s.trendFootLeft}>
              {selectedText && <span className={s.trendSelected}>{selectedText}</span>}
              {trendText && <span>{trendText}</span>}
            </span>
            <span>{ip(all ? "trendNoteAll" : "trendNote")}</span>
          </div>
        </div>
      )}

      {/* ── Disputes by payment method ────────────────────────────── */}
      {op && (
        <div className={s.card} data-screen-label="Disputes by payment method">
          <div className={s.pmTop}>
            <div className={s.titleBlock}>
              <div className={s.cardTitle}>{ip("methodsTitle")}</div>
              <div className={s.cardSub}>{ip("methodsSub")}</div>
            </div>
            {flagged.length > 0 && (
              <div className={s.flag}>
                <span className={s.flagDot} />
                <span>
                  {flagged.length === 1
                    ? ip("methodsFlaggedOne", {
                        name: flagged[0]!.brand ? `${flagged[0]!.name} · ${flagged[0]!.brand}` : flagged[0]!.name,
                        pct: referencePct,
                      })
                    : ip("methodsFlaggedMany", { count: flagged.length, pct: referencePct })}
                </span>
              </div>
            )}
          </div>
          <div className={s.pmScroll}>
            <div className={s.pmInner}>
              <div className={`${s.pm} ${s.pmHead}`}>
                <div>{ip("colMethod")}</div>
                <div className={s.r}>{ip("colOrders")}</div>
                <div className={s.r}>{ip("colChargebacks")}</div>
                <div className={s.r}>{ip("colInquiries")}</div>
                <div className={s.pmRateHead}>
                  <span>{ip("colChargebackRate")}</span>
                  <span>{referencePct}</span>
                </div>
                <div className={s.r}>{ip("colAllDisputes")}</div>
              </div>
              <div className={`${s.pmGroup} ${s.pmGroupRow}`}>{ip("methodsGroupActive", { count: activeRows.length })}</div>
              {activeRows.map((r) => (
                <div className={`${s.pm} ${r.flagged ? s.pmFlagged : ""}`} key={`${r.method}|${r.brand ?? ""}`}>
                  <div className={s.pmName}>
                    <span style={{ fontWeight: 500 }}>{r.name}</span>
                    {r.brand && <span className={`${s.badge} ${s.bDefault}`}>{r.brand}</span>}
                  </div>
                  <div className={`${s.r} ${s.subtle}`}>{formatCount(r.orders, locale)}</div>
                  <div className={s.r} style={{ fontWeight: 600 }}>{formatCount(r.chargebacks, locale)}</div>
                  <div className={`${s.r} ${s.subtle}`}>{formatCount(r.inquiries, locale)}</div>
                  <div className={s.pmRate}>
                    {r.chargebackRate !== null ? (
                      <>
                        <div className={s.pmTrack}>
                          <div
                            className={s.pmFill}
                            style={{
                              width: `${Math.max(Math.min(r.chargebackRate / (METHOD_REFERENCE * 2), 1) * 100, 2)}%`,
                              background: r.flagged ? WARNING : PRIMARY,
                            }}
                          />
                          <div className={s.pmRef} />
                        </div>
                        <span className={s.pmRateValue} style={{ fontWeight: 600, color: r.flagged ? "#B45309" : "#0B1220" }}>
                          {formatRatio(r.chargebackRate, locale)}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className={s.pmTooFew}>{ip("methodsTooFew")}</span>
                        <span className={`${s.pmRateValue} ${s.muted}`}>—</span>
                      </>
                    )}
                  </div>
                  <div className={`${s.r} ${s.subtle}`}>{formatRatio(r.disputeRate, locale)}</div>
                </div>
              ))}
              <button type="button" className={s.pmToggle} onClick={() => setShowZero(!showZero)} aria-expanded={showZero}>
                <span className={s.pmGroup}>{ip("methodsGroupZero", { count: zeroRows.length })}</span>
                <span className={s.pmToggleLabel}>{ip(showZero ? "methodsHide" : "methodsShow")}</span>
              </button>
              {showZero &&
                zeroRows.map((r) => (
                  <div className={`${s.pm} ${s.pmZero}`} key={`${r.method}|${r.brand ?? ""}`}>
                    <div className={s.pmName}>
                      <span style={{ color: "#0B1220" }}>{r.name}</span>
                      {r.brand && <span className={`${s.badge} ${s.bDefault}`}>{r.brand}</span>}
                    </div>
                    <div className={s.r}>{formatCount(r.orders, locale)}</div>
                    <div className={s.r}>{formatCount(0, locale)}</div>
                    <div className={s.r}>{formatCount(0, locale)}</div>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <span className={s.pmRateValue}>{formatRatio(r.chargebackRate, locale)}</span>
                    </div>
                    <div className={s.r}>{formatRatio(r.disputeRate, locale)}</div>
                  </div>
                ))}
            </div>
          </div>
          <div className={s.pmFoot}>
            <span>{ip("methodsFootRates")}</span>
            <span>{ip("methodsFootEarlier")}</span>
            <span className={s.pmFootRef}>
              <span className={s.pmFootRefLine} />
              {ip("methodsFootReference", { pct: referencePct })}
            </span>
          </div>
        </div>
      )}

      {/* ── Card-network exposure ─────────────────────────────────── */}
      <div className={s.exposureRow}>
        <div className={`${s.card} ${s.exposure}`} data-screen-label="Card-network exposure">
          {p && p.cardDisputeRatio !== null && p.vampSeverity && (
            <>
              <div className={s.exposureTop}>
                <div className={s.exposureLeft}>
                  <div className={s.eyebrow}>{ip("headlineEstimate")}</div>
                  <div className={s.bigRow}>
                    <span className={s.big}>{formatRatio(p.cardDisputeRatio, locale)}</span>
                    <span className={`${s.badge} ${SEV[p.vampSeverity].badge}`}>{sevLabel(p.vampSeverity)}</span>
                  </div>
                  <div className={`${s.subtle} ${s.num}`}>
                    {ip("headlineDetail", { n: p.cardChargebackCount, d: formatCount(p.cardSettledCount, locale) })}
                  </div>
                </div>
                <div className={s.exposureRight}>
                  <span className={s.nowrap}>{ip("thresholdsVerified", { date: "2026-10-01" })}</span>
                  <span className={s.pretty}>{stateLine}</span>
                </div>
              </div>
              <ProgrammeRow
                name={ip("vampName")}
                basis={ip("vampQualEstimate")}
                ratio={p.cardDisputeRatio}
                value={formatRatio(p.cardDisputeRatio, locale)}
                fraction={`${formatCount(p.cardChargebackCount, locale)} / ${formatCount(p.cardSettledCount, locale)}`}
                ticks={[
                  { at: VAMP_EARLY_WARNING, color: WARNING },
                  { at: VAMP_EXCESSIVE, color: DANGER },
                ]}
                threshold={ip("vampThreshold", {
                  warn: formatRatio(VAMP_EARLY_WARNING, locale, 1),
                  excessive: formatRatio(VAMP_EXCESSIVE, locale, 1),
                })}
                applies={ip("vampFloor", { floor: formatCount(VAMP_COUNT_FLOOR, locale), count: formatCount(p.visaChargebackCount, locale) })}
              />
              {p.ecmRatio !== null && p.ecmSeverity && (
                <ProgrammeRow
                  name={ip("ecmName")}
                  basis={ip("ecmQualLowerBound")}
                  ratio={p.ecmRatio}
                  value={formatRatio(p.ecmRatio, locale)}
                  fraction={`${formatCount(p.mcChargebackCount, locale)} / ${formatCount(p.cardSettledPrevCount, locale)}`}
                  ticks={[{ at: MC_ECM_RATIO, color: DANGER }]}
                  threshold={ip("ecmThreshold", { pct: formatRatio(MC_ECM_RATIO, locale, 1) })}
                  applies={ip("ecmFloor", { floor: formatCount(MC_ECM_COUNT_FLOOR, locale), count: formatCount(p.mcChargebackCount, locale) })}
                />
              )}
              {notes.map((n) => (
                <div className={s.exposureNote} key={n}>{n}</div>
              ))}
            </>
          )}
          {p && p.cardDisputeRatio === null && (
            <div className={s.state}>
              <span className={`${s.subtle} ${s.pretty}`}>{ip("tooFewCardOrders")}</span>
            </div>
          )}
          {!ok && (
            <div className={s.state}>
              <span className={s.stateTitle}>{ip(`stateMsg.${period.status}.title`)}</span>
              <span className={`${s.subtle} ${s.pretty}`} style={{ maxWidth: 620 }}>
                {ip(`stateMsg.${period.status}.body`, { month })}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Checkpoints ───────────────────────────────────────────── */}
      <div className={s.card} data-screen-label="Checkpoints">
        <div className={s.sectionHead}>
          <div className={s.cardTitle}>{ip("checkpointsTitle", { month })}</div>
          <div className={s.cardSub}>{ip("checkpointsSub")}</div>
        </div>
        {checkpoints.map((c, i) => {
          const values = formatCheckpointValues(c.values, locale);
          return (
            <div className={s.cp} key={c.id}>
              <span className={s.cpNum} style={{ background: SEV[c.severity].dotBg, color: SEV[c.severity].dotFg }}>{i + 1}</span>
              <div className={s.cpText}>
                <span className={s.cpTitle}>{t(c.titleKey as never, values as never)}</span>
                <span className={s.cpBody}>{t(c.bodyKey as never, values as never)}</span>
                {c.source && (
                  <span className={s.cpSource}>
                    {ip("sourcePrefix")}{" "}
                    <a href={c.source.url} target="_blank" rel="noopener noreferrer">{c.source.label}</a>
                  </span>
                )}
              </div>
              <div className={s.cpBadges}>
                {i < 3 && <span className={`${s.badge} ${s.bInfo}`}>{ip("inEmail")}</span>}
                <span className={`${s.badge} ${SEV[c.severity].badge}`}>{sevLabel(c.severity)}</span>
              </div>
            </div>
          );
        })}
        {checkpoints.length === 0 && <div className={s.cpNone}>{ip("checkpointsNone")}</div>}
      </div>

      {/* ── How orders were protected ─────────────────────────────── */}
      {op && (
        <div className={s.card} data-screen-label="Protection">
          <div className={s.sectionHead}>
            <div className={s.cardTitle}>{ip("protectTitle", { month })}</div>
            <div className={s.cardSub}>{ip("protectSub")}</div>
          </div>
          <div className={s.metrics}>
            <Metric
              label={ip("m3ds")}
              value={formatRatio(op.threeDsShare, locale, 1)}
              note={ip("m3dsNote")}
              color={threeDsFlagged ? "#B45309" : undefined}
            />
            <Metric
              label={ip("mSigned")}
              value={formatRatio(op.signedForShare, locale, 0)}
              note={op.signedForShare === null ? ip("mSignedUnobservable") : ip("mSignedNote")}
            />
            <Metric
              label={ip("mProtect")}
              value={formatRatio(op.protectShareByValue, locale, 0)}
              note={op.protectShareByValue === null ? ip("mProtectNotMeasured") : ip("mProtectNote")}
            />
            <Metric
              label={ip("mWinRate")}
              value={formatRatio(op.winRate, locale, 0)}
              note={ip("mWinRateNote", { won: op.wonCount, decided: op.decidedCount, month })}
            />
          </div>
        </div>
      )}

      {/* ── Dispute reasons ───────────────────────────────────────── */}
      {reasons && (
        <div className={s.card} data-screen-label="Dispute reasons">
          <div className={s.pmTop}>
            <div className={s.titleBlock} style={{ maxWidth: 600 }}>
              <div className={s.cardTitle}>{ip("reasonsTitle", { month: monthLong, prev: prevLong })}</div>
              <div className={s.cardSub}>{ip("reasonsSub")}</div>
            </div>
            <div className={s.rsSummary}>
              <div className={s.rsTotalRow}>
                <span className={s.rsTotal}>{ip("reasonsTotal", { count: reasons.currentTotal })}</span>
                {totalChange !== null && (
                  <span
                    className={s.rsDelta}
                    style={{ color: totalChange > 0 ? "#B45309" : totalChange < 0 ? "#15803D" : "#64748B" }}
                  >
                    {totalChange === 0
                      ? ip("reasonsSame", { prev: prevLong })
                      : ip(totalChange < 0 ? "reasonsFewer" : "reasonsMore", { count: Math.abs(totalChange), prev: prevLong })}
                  </span>
                )}
              </div>
              <div className={s.rsLegend}>
                <span className={s.rsLegendItem}>
                  <span className={s.rsSwatch} style={{ background: PRIMARY }} />
                  {monthLong}
                </span>
                <span className={s.rsLegendItem}>
                  <span className={s.rsSwatch} style={{ background: INFO }} />
                  {prevLong}
                </span>
              </div>
            </div>
          </div>
          <div className={s.pmScroll}>
            <div className={s.rsInner}>
              <div className={`${s.rs} ${s.rsHead}`}>
                <div>{ip("reasonsColReason")}</div>
                <div />
                <div className={s.r}>{monthPart(period.periodMonth, { month: "short" })}</div>
                <div className={s.r}>{monthPart(prevMonthIso, { month: "short" })}</div>
                <div className={s.r}>{ip("reasonsColChange")}</div>
              </div>
              {reasonRows.map((r) => (
                <div className={s.rs} key={r.reason}>
                  <div className={s.rsName}>
                    <span style={{ fontWeight: 500 }}>{REASON_KEYS.has(r.reason) ? ip(`reason.${r.reason}`) : r.reason}</span>
                    <span className={s.rsShare}>
                      {r.share !== null
                        ? ip("reasonsShare", { pct: formatRatio(r.share, locale, 0), month: monthLong })
                        : ip("reasonsNone", { month: monthLong })}
                    </span>
                  </div>
                  <div className={s.rsBars}>
                    <div className={s.rsBar} style={{ background: PRIMARY, width: reasonWidth(r.current) }} />
                    <div className={s.rsBar} style={{ background: INFO, width: reasonWidth(r.previous ?? 0) }} />
                  </div>
                  <div className={s.r} style={{ fontWeight: 600 }}>{formatCount(r.current, locale)}</div>
                  <div className={`${s.r} ${s.subtle}`}>{r.previous === null ? "—" : formatCount(r.previous, locale)}</div>
                  <div
                    className={s.r}
                    style={{
                      fontWeight: 600,
                      color: r.change !== null && r.change > 0 ? "#B45309" : r.change !== null && r.change < 0 ? "#15803D" : "#64748B",
                    }}
                  >
                    {r.change === null || r.change === 0
                      ? "—"
                      : r.isNew
                        ? ip("reasonsNew")
                        : `${r.change > 0 ? "+" : "−"}${formatCount(Math.abs(r.change), locale)}`}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className={s.rsFoot}>{ip("reasonsFoot")}</div>
        </div>
      )}

      <div className={s.footer}>{ip("footer")}</div>
    </div>
  );
}

function ProgrammeRow(props: {
  name: string;
  basis: string;
  ratio: number;
  value: string;
  fraction: string;
  ticks: Array<{ at: number; color: string }>;
  threshold: string;
  applies: string;
}) {
  const pos = (v: number) => `${Math.min(v / PROGRAMME_SCALE, 1) * 100}%`;
  return (
    <div className={s.prog}>
      <div className={s.progName}>
        <span className={s.progTitle}>{props.name}</span>
        <span className={s.progBasis}>{props.basis}</span>
      </div>
      <div className={s.progMid}>
        <div className={s.progTrack}>
          <div className={s.progFill} style={{ width: pos(props.ratio) }} />
          {props.ticks.map((tick) => (
            <div key={tick.at} className={s.progTick} style={{ left: pos(tick.at), background: tick.color }} />
          ))}
        </div>
        <div className={s.progTexts}>
          <span>{props.threshold}</span>
          <span>{props.applies}</span>
        </div>
      </div>
      <div className={s.progValue}>
        <span className={s.progNumber}>{props.value}</span>
        <span className={s.progFraction}>{props.fraction}</span>
      </div>
    </div>
  );
}

function Metric({ label, value, note, color }: { label: string; value: string; note: string; color?: string }) {
  return (
    <div className={s.metric}>
      <span className={s.metricLabel}>{label}</span>
      <span className={s.metricValue} style={{ color: value === "—" ? "#64748B" : color }}>{value}</span>
      <span className={s.metricNote}>{note}</span>
    </div>
  );
}
