"use client";

/**
 * Chargeback Exposure — the month view, transcribed from the Claude Design
 * file "Chargeback Exposure redesign" (ChargebackExposure.dc.html, approved
 * 2026-10-02). Every number comes from the stored month record (`period`),
 * the records-only trend, and the live state; nothing is computed here
 * except display formatting through lib/insights/period/format.ts.
 */

import { useLocale, useTranslations } from "next-intl";
import { Select } from "@shopify/polaris";

import type { CheckpointSeverity } from "@/lib/insights/checkpoints.types";
import type { InsightsPeriod } from "@/lib/insights/period/readInsightsPeriod";
import type { TrendPoint } from "@/lib/insights/period/readTrend";
import type { LiveState } from "@/lib/insights/period/computeLiveState";
import type { PaymentMethodRow } from "@/lib/insights/period/computeOperationalMetrics";
import {
  formatCheckpointValues,
  formatCount,
  formatMonth,
  formatRatio,
} from "@/lib/insights/period/format";
import s from "./exposure.module.css";

const SEV: Record<CheckpointSeverity, { bg: string; fg: string; dot: string }> = {
  healthy: { bg: "#ECFDF3", fg: "#067647", dot: "#22C55E" },
  info: { bg: "#EEF0F3", fg: "#344054", dot: "#98A2B3" },
  consider: { bg: "#FFFAEB", fg: "#B54708", dot: "#F59E0B" },
  breach: { bg: "#FEF3F2", fg: "#B42318", dot: "#EF4444" },
};

const STATE_CHIP = {
  final: { bg: "#ECFDF3", fg: "#067647", dot: "#22C55E" },
  provisional: { bg: "#FFFAEB", fg: "#B54708", dot: "#F59E0B" },
  mtd: { bg: "#EFF4FF", fg: "#1D4ED8", dot: "#1D4ED8" },
  muted: { bg: "#EEF0F3", fg: "#344054", dot: "#98A2B3" },
} as const;

/** Method keys with their own name; anything else is shown as stored. */
const METHOD_KEYS = new Set([
  "card", "shopify_pay", "shop_pay", "apple_pay", "google_pay", "shop_pay_installments",
  "paypal", "klarna", "amazon_pay", "tiktok_shop", "gift_card", "shop_cash", "unknown",
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
  liveState,
  monthOptions,
  selected,
  onSelect,
}: {
  period: InsightsPeriod;
  trend: TrendPoint[];
  liveState: LiveState | null;
  /** Value "YYYY-MM-01" or "mtd". */
  monthOptions: Array<{ value: string; label: string }>;
  selected: string;
  onSelect: (value: string) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const ip = (k: string, v?: Record<string, string | number>) => t(`insightsPage.${k}` as never, v as never);
  const month = formatMonth(period.periodMonth, locale);
  const shortDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));

  // ── State chip + header sub ───────────────────────────────────────
  let chip: { text: string; c: (typeof STATE_CHIP)[keyof typeof STATE_CHIP] };
  let headerSub: string;
  if (period.status === "ok") {
    if (period.periodState === "final") {
      chip = {
        text: period.revisedAt ? ip("stateFinalUpdated", { date: shortDate(period.revisedAt) }) : ip("stateFinal"),
        c: STATE_CHIP.final,
      };
      headerSub = ip("headerSubFinal", { month });
    } else if (period.periodState === "provisional") {
      chip = { text: ip("stateProvisional", { date: shortDate(period.finalOn) }), c: STATE_CHIP.provisional };
      headerSub = ip("headerSubProvisional", { month, date: shortDate(period.finalOn) });
    } else {
      chip = { text: ip("stateMtd", { date: shortDate(new Date().toISOString()) }), c: STATE_CHIP.mtd };
      headerSub = ip("headerSubMtd", { month });
    }
  } else if (period.status === "not_fully_imported") {
    chip = { text: ip("stateNotFullyImported"), c: STATE_CHIP.muted };
    headerSub = ip("headerSubNotFullyImported");
  } else {
    chip = { text: ip(period.status === "error" ? "stateFinal" : "stateNotAvailable"), c: STATE_CHIP.muted };
    headerSub = ip("headerSubNotAvailable");
  }

  const ok = period.status === "ok" ? period : null;
  const p = ok?.programme;
  const op = ok?.operational;
  const sevLabel = (sev: CheckpointSeverity) => t(`fraudIntel.checkpointSeverity.${sev}` as never);
  const Chip = ({ sev }: { sev: CheckpointSeverity }) => (
    <span className={s.chip} style={{ background: SEV[sev].bg, color: SEV[sev].fg }}>
      <span className={s.dot} style={{ background: SEV[sev].dot }} />
      {sevLabel(sev)}
    </span>
  );

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
      notes.push(
        ip("noteNonCard", {
          count: nonCardDisputes,
          total: totalDisputes,
          method: METHOD_KEYS.has(top.method) ? ip(`method.${top.method}`) : top.method,
        }),
      );
    }
  }

  // ── Trend bars ────────────────────────────────────────────────────
  const max = Math.max(2.6, ...trend.map((x) => (x.cardDisputeRatio ?? 0) * 100 * 1.1));
  const monthShort = (iso: string, style: "short" | "narrow") =>
    new Intl.DateTimeFormat(locale, { month: style, timeZone: "UTC" }).format(new Date(`${iso.slice(0, 7)}-15T12:00:00Z`));

  const methods = op ? displayMethods(op.byPaymentMethod) : [];
  const checkpoints = ok ? ok.checkpoints.slice(0, 5) : [];

  return (
    <div className={s.wrap} data-screen-label="Chargeback Exposure page">
      <div className={s.header}>
        <div className={s.col} style={{ gap: 4, minWidth: 0 }}>
          <span className={`${s.sub} ${s.pretty}`}>{ip("subtitle")}</span>
        </div>
        <div className={s.row} style={{ gap: 8 }}>
          <div style={{ minWidth: 190 }}>
            <Select label={ip("monthSelectLabel")} labelHidden options={monthOptions} value={selected} onChange={onSelect} />
          </div>
          <span className={s.chip} style={{ background: chip.c.bg, color: chip.c.fg }}>
            <span className={s.dot} style={{ background: chip.c.dot }} />
            {chip.text}
          </span>
        </div>
      </div>

      {/* ── Card-network exposure ─────────────────────────────────── */}
      <div className={s.card}>
        <div className={s.cardHead}>
          <div className={s.col} style={{ gap: 2 }}>
            <span className={s.h2}>{ip("exposureTitle", { month })}</span>
            <span className={`${s.sub} ${s.small}`}>{headerSub}</span>
          </div>
          <span className={`${s.sub} ${s.small}`}>{ip("thresholdsVerified", { date: "2026-10-01" })}</span>
        </div>

        {p && p.cardDisputeRatio !== null && p.vampSeverity && (
          <>
            <div className={s.headline}>
              <span className={`${s.sub} ${s.small}`}>{ip("headlineEstimate")}</span>
              <span className={s.row} style={{ gap: 10, alignItems: "baseline" }}>
                <span className={`${s.big} ${s.num}`}>{formatRatio(p.cardDisputeRatio, locale)}</span>
                <Chip sev={p.vampSeverity} />
              </span>
              <span className={`${s.sub} ${s.num}`}>
                {ip("headlineDetail", { n: formatCount(p.cardChargebackCount, locale), d: formatCount(p.cardSettledCount, locale) })}
              </span>
            </div>
            <ProgrammeRow
              name={ip("vampName")}
              qual={ip("vampQualEstimate")}
              value={formatRatio(p.cardDisputeRatio, locale)}
              detail={`${formatCount(p.cardChargebackCount, locale)} / ${formatCount(p.cardSettledCount, locale)}`}
              threshold={ip("vampThreshold", { pct: formatRatio(0.009, locale, 1) })}
              floor={ip("vampFloor", { floor: formatCount(1500, locale), count: formatCount(p.visaChargebackCount, locale) })}
              chip={<Chip sev={p.vampSeverity} />}
            />
            {p.ecmRatio !== null && p.ecmSeverity && (
              <ProgrammeRow
                name={ip("ecmName")}
                qual={ip("ecmQualLowerBound")}
                value={formatRatio(p.ecmRatio, locale)}
                detail={`${formatCount(p.mcChargebackCount, locale)} / ${formatCount(p.cardSettledPrevCount, locale)}`}
                threshold={ip("ecmThreshold", { pct: formatRatio(0.015, locale, 1) })}
                floor={ip("ecmFloor", { floor: formatCount(100, locale), count: formatCount(p.mcChargebackCount, locale) })}
                chip={<Chip sev={p.ecmSeverity} />}
              />
            )}
            {notes.map((n) => (
              <div className={s.note} key={n}>
                <span className={s.noteIcon}>i</span>
                <span className={s.pretty}>{n}</span>
              </div>
            ))}
          </>
        )}
        {p && p.cardDisputeRatio === null && (
          <div className={s.state}>
            <span className={`${s.sub} ${s.pretty}`}>{ip("tooFewCardOrders")}</span>
          </div>
        )}
        {!ok && (
          <div className={s.state}>
            <span style={{ fontWeight: 600 }}>{ip(`stateMsg.${period.status}.title`)}</span>
            <span className={`${s.sub} ${s.pretty}`} style={{ maxWidth: 620 }}>
              {ip(`stateMsg.${period.status}.body`, { month })}
            </span>
          </div>
        )}
      </div>

      {/* ── Disputes by payment method ────────────────────────────── */}
      {op && (
        <div className={s.card} data-screen-label="Disputes by payment method">
          <div className={`${s.pad} ${s.col}`} style={{ gap: 2, paddingBottom: 12 }}>
            <span className={s.h2}>{ip("methodsTitle", { month })}</span>
            <span className={`${s.sub} ${s.small} ${s.pretty}`}>{ip("methodsSub")}</span>
          </div>
          <div className={`${s.pm} ${s.pmHead}`}>
            <span>{ip("colMethod")}</span>
            <span className={s.r}>{ip("colOrders")}</span>
            <span className={s.r}>{ip("colChargebacks")}</span>
            <span className={s.r}>{ip("colInquiries")}</span>
            <span className={s.r}>{ip("colChargebackRate")}</span>
            <span className={s.r}>{ip("colAllDisputes")}</span>
          </div>
          {methods.map((r) => {
            const hot = r.disputeRate !== null && r.disputeRate >= 0.009;
            const name =
              r.method === "other"
                ? ip("methodOther", { count: r.other ?? 0 })
                : METHOD_KEYS.has(r.method)
                  ? ip(`method.${r.method}`)
                  : r.method;
            return (
              <div className={`${s.pm} ${hot ? s.pmHot : ""}`} key={`${r.method}|${r.brand ?? ""}`}>
                <span className={`${s.row} ${s.pmName}`} style={{ gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{name}</span>
                  {r.brand && <span className={s.netBadge}>{r.brand}</span>}
                </span>
                <span className={`${s.r} ${s.num}`}><span className={s.mlab}>{ip("colOrders")} </span>{formatCount(r.orders, locale)}</span>
                <span className={`${s.r} ${s.num}`}><span className={s.mlab}>{ip("colChargebacks")} </span>{formatCount(r.chargebacks, locale)}</span>
                <span className={`${s.r} ${s.num}`}><span className={s.mlab}>{ip("colInquiries")} </span>{formatCount(r.inquiries, locale)}</span>
                <span className={`${s.r} ${s.num} ${hot ? s.pmHotRate : ""}`} style={{ fontWeight: 600 }}>
                  <span className={s.mlab}>{ip("colChargebackRate")} </span>{formatRatio(r.chargebackRate, locale)}
                </span>
                <span className={`${s.r} ${s.num}`}><span className={s.mlab}>{ip("colAllDisputes")} </span>{formatRatio(r.disputeRate, locale)}</span>
              </div>
            );
          })}
          <div className={s.note} style={{ color: "#667085" }}>
            <span className={s.pretty}>{ip("methodsFoot")}</span>
          </div>
        </div>
      )}

      {/* ── Trend ─────────────────────────────────────────────────── */}
      {trend.length > 0 && (
        <div className={`${s.card} ${s.pad} ${s.col}`} style={{ gap: 10 }}>
          <div className={s.row} style={{ justifyContent: "space-between" }}>
            <div className={s.col} style={{ gap: 2 }}>
              <span className={s.h2}>{ip("trendTitle")}</span>
              <span className={`${s.sub} ${s.small}`}>{ip("trendSub", { count: trend.length })}</span>
            </div>
            <div className={`${s.row} ${s.tiny} ${s.sub}`} style={{ gap: 12 }}>
              <span className={s.row} style={{ gap: 4 }}><span className={s.legendLine} style={{ borderColor: "#F59E0B" }} />{ip("legendEarlyWarning", { pct: formatRatio(0.009, locale, 1) })}</span>
              <span className={s.row} style={{ gap: 4 }}><span className={s.legendLine} style={{ borderColor: "#EF4444" }} />{ip("legendExcessive", { pct: formatRatio(0.015, locale, 1) })}</span>
            </div>
          </div>
          <div className={s.bars} style={{ gridTemplateColumns: `repeat(${trend.length}, minmax(0, 1fr))` }}>
            <div className={s.tline} style={{ bottom: `${(0.9 / max) * 100}%`, borderColor: "#F59E0B" }} />
            <div className={s.tline} style={{ bottom: `${(1.5 / max) * 100}%`, borderColor: "#EF4444" }} />
            {trend.map((x) => {
              const v = x.cardDisputeRatio === null ? null : x.cardDisputeRatio * 100;
              const sel = x.periodMonth === period.periodMonth;
              const color = v === null ? "#E5E7EB" : v >= 1.5 ? "#FDA29B" : v >= 0.9 ? "#FEC84B" : "#B2CCFF";
              return (
                <button
                  type="button"
                  key={x.periodMonth}
                  className={s.barCol}
                  onClick={() => onSelect(x.periodMonth)}
                  aria-label={`${formatMonth(x.periodMonth, locale)}: ${formatRatio(x.cardDisputeRatio, locale)}`}
                >
                  <span className={`${s.tiny} ${s.num}`} style={{ textAlign: "center", color: sel ? "#1D4ED8" : "#475467", fontWeight: 600, marginBottom: 2 }}>
                    {v !== null && (v >= 0.9 || sel) ? formatRatio(x.cardDisputeRatio, locale) : ""}
                  </span>
                  <span
                    className={s.bar}
                    style={{
                      height: `${v === null ? 0 : (v / max) * 100}%`,
                      background: sel ? "#1D4ED8" : color,
                      outline: sel ? "2px solid #C7D7FE" : "none",
                      outlineOffset: 2,
                    }}
                  />
                </button>
              );
            })}
          </div>
          <div className={s.mlabels} style={{ gridTemplateColumns: `repeat(${trend.length}, minmax(0, 1fr))` }}>
            {trend.map((x) => {
              const sel = x.periodMonth === period.periodMonth;
              return (
                <span key={x.periodMonth} className={s.tiny} style={{ textAlign: "center", color: sel ? "#0B1220" : "#98A2B3", fontWeight: sel ? 700 : 500 }}>
                  <span className={s.mlabLong}>{monthShort(x.periodMonth, "short")}</span>
                  <span className={s.mlabShort}>{monthShort(x.periodMonth, "narrow")}</span>
                </span>
              );
            })}
          </div>
          <span className={`${s.sub} ${s.small} ${s.pretty}`}>{ip("trendNote")}</span>
        </div>
      )}

      {/* ── Checkpoints + Right now ───────────────────────────────── */}
      <div className={s.twoc}>
        <div className={s.card}>
          <div className={`${s.pad} ${s.col}`} style={{ gap: 2, paddingBottom: 12 }}>
            <span className={s.h2}>{ip("checkpointsTitle", { month })}</span>
            <span className={`${s.sub} ${s.small}`}>{ip("checkpointsSub")}</span>
          </div>
          {checkpoints.map((c, i) => {
            const values = formatCheckpointValues(c.values, locale);
            return (
              <div className={s.cp} key={c.id}>
                <span className={s.stripe} style={{ background: SEV[c.severity].dot }} />
                <div className={s.col} style={{ gap: 3, flex: 1, minWidth: 0 }}>
                  <div className={s.row} style={{ gap: 8, justifyContent: "space-between", flexWrap: "nowrap" }}>
                    <span className={s.pretty} style={{ fontWeight: 600 }}>{t(c.titleKey as never, values as never)}</span>
                    <span className={s.row} style={{ gap: 6, flex: "none", flexWrap: "nowrap" }}>
                      {i < 3 && <span className={s.inEmail}>{ip("inEmail")}</span>}
                      <span className={s.chip} style={{ background: SEV[c.severity].bg, color: SEV[c.severity].fg }}>{sevLabel(c.severity)}</span>
                    </span>
                  </div>
                  <span className={`${s.sub} ${s.pretty}`}>{t(c.bodyKey as never, values as never)}</span>
                  {c.source && (
                    <a className={s.tiny} style={{ color: "#98A2B3" }} href={c.source.url} target="_blank" rel="noopener noreferrer">
                      {c.source.label}
                    </a>
                  )}
                </div>
              </div>
            );
          })}
          {checkpoints.length === 0 && (
            <div className={s.cp}>
              <span className={`${s.sub} ${s.small}`}>{ip("checkpointsNone")}</span>
            </div>
          )}
        </div>

        <div className={s.live}>
          <div className={s.row} style={{ padding: "14px 18px 4px", justifyContent: "space-between" }}>
            <span className={s.h2}>{ip("liveTitle")}</span>
            <span className={`${s.tiny} ${s.sub}`}>{ip("liveSub")}</span>
          </div>
          <div className={s.liveCell}>
            <span className={`${s.sub} ${s.small}`}>{ip("liveNeedAction")}</span>
            <span className={`${s.mid} ${s.num}`}>{liveState ? formatCount(liveState.needsAction, locale) : "—"}</span>
            <span className={`${s.sub} ${s.small}`}>{ip("liveNeedActionSub")}</span>
          </div>
          <div className={s.liveCell}>
            <span className={`${s.sub} ${s.small}`}>{ip("liveWithBank")}</span>
            <span className={`${s.mid} ${s.num}`}>{liveState ? formatCount(liveState.awaitingBank, locale) : "—"}</span>
            <span className={`${s.sub} ${s.small}`}>{ip("liveWithBankSub")}</span>
          </div>
          <div className={s.liveCell}>
            <span className={`${s.sub} ${s.small}`}>{ip("liveNearest")}</span>
            <span className={s.mid}>
              {liveState?.nearestDueAt ? shortDate(liveState.nearestDueAt) : ip("liveNoneDue")}
            </span>
          </div>
        </div>
      </div>

      {/* ── How orders were protected ─────────────────────────────── */}
      {op && (
        <div className={s.card}>
          <div className={`${s.pad} ${s.col}`} style={{ gap: 2, paddingBottom: 12 }}>
            <span className={s.h2}>{ip("protectTitle", { month })}</span>
            <span className={`${s.sub} ${s.small}`}>{ip("protectSub")}</span>
          </div>
          <div className={s.metrics}>
            <Metric label={ip("m3ds")} value={formatRatio(op.threeDsShare, locale, 1)} note={ip("m3dsNote")} />
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

      <span className={`${s.sub} ${s.small} ${s.pretty}`} style={{ textAlign: "center" }}>{ip("footer")}</span>
    </div>
  );
}

function ProgrammeRow(props: {
  name: string;
  qual: string;
  value: string;
  detail: string;
  threshold: string;
  floor: string;
  chip: React.ReactNode;
}) {
  return (
    <div className={s.prog}>
      <div className={s.col} style={{ gap: 2, minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>{props.name}</span>
        <span className={`${s.sub} ${s.small}`}>{props.qual}</span>
      </div>
      <div className={`${s.col} ${s.progWide}`} style={{ gap: 2 }}>
        <span className={`${s.mid} ${s.num}`}>{props.value}</span>
        <span className={`${s.sub} ${s.small} ${s.num}`}>{props.detail}</span>
      </div>
      <div className={`${s.col} ${s.progWide}`} style={{ gap: 2 }}>
        <span className={s.small}>{props.threshold}</span>
        <span className={`${s.sub} ${s.small}`}>{props.floor}</span>
      </div>
      <span style={{ justifySelf: "end" }}>{props.chip}</span>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className={s.metric}>
      <span className={`${s.sub} ${s.small}`}>{label}</span>
      <span className={`${s.mid} ${s.num}`} style={{ color: value === "—" ? "#98A2B3" : undefined }}>{value}</span>
      <span className={`${s.sub} ${s.small} ${s.pretty}`}>{note}</span>
    </div>
  );
}

