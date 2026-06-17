"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check, Store, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { MarketingSiteHeader } from "@/components/marketing/MarketingSiteHeader";
import { MarketingSiteFooter } from "@/components/marketing/MarketingSiteFooter";
import { Link } from "@/i18n/navigation";
import {
  COMPARE_TABLE_ROWS,
  compareChartTiers,
  getCompetitorById,
  type Competitor,
} from "@/lib/compare/competitors";

const SLATE_GRADIENT =
  "linear-gradient(135deg, var(--dd-hero-bg-start) 0%, var(--dd-hero-bg-mid) 40%, var(--dd-hero-bg-end) 100%)";
const SERIF = "var(--font-crimson-pro), 'Instrument Serif', Georgia, serif";
const MONO = "var(--font-jetbrains-mono), 'JetBrains Mono', ui-monospace, monospace";
const CONTAINER = "max-w-[1200px] mx-auto px-6";
const NARROW = "max-w-[1100px] mx-auto px-6";

function normalizeShopDomain(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const domain = trimmed.endsWith(".myshopify.com") ? trimmed : `${trimmed}.myshopify.com`;
  const [subdomain] = domain.split(".");
  if (!/^[a-z0-9-]+$/.test(subdomain)) return null;
  return domain;
}

function MonoLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-[11px] uppercase tracking-[0.14em] text-[#1D4ED8] mb-3"
      style={{ fontFamily: MONO }}
    >
      {children}
    </p>
  );
}

export function CompareLandingClient({
  base = "",
  competitorId,
}: {
  base?: string;
  competitorId: string;
}) {
  const t = useTranslations("compare");
  const tm = useTranslations("marketing");
  const [showInstall, setShowInstall] = useState(false);
  const [shopInput, setShopInput] = useState("");
  const [shopError, setShopError] = useState<string | null>(null);

  const c = getCompetitorById(competitorId) as Competitor;
  const name = t(`competitors.${competitorId}.name`);
  const prevention = c.model === "prevention";
  const tiers = compareChartTiers(c);

  const openInstall = () => {
    setShopError(null);
    setShowInstall(true);
  };
  const closeInstall = () => {
    setShowInstall(false);
    setShopError(null);
  };
  const submitInstall = () => {
    const domain = normalizeShopDomain(shopInput);
    if (!domain) {
      setShopError(tm("pricing.shopError"));
      return;
    }
    window.location.href = `/api/auth/shopify?shop=${encodeURIComponent(domain)}`;
  };

  useEffect(() => {
    if (!showInstall) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeInstall();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showInstall]);

  const heroBullets = t.raw("page.heroBullets") as string[];
  const doesWell = t.raw(`competitors.${competitorId}.doesWell`) as string[];
  const whyAlt = t.raw(`competitors.${competitorId}.whyAlt`) as string[];
  const faqs = t.raw("page.faqs") as { q: string; a: string }[];

  const headline = prevention
    ? t("page.headlinePrevention")
    : t("page.headlineFee", { save: c.saveBig });
  const saveLabel = prevention ? t("page.saveLabelPrevention") : t("page.saveLabelFee");
  const saveSub = prevention
    ? t("page.saveSubPrevention")
    : t("page.saveSubFee", { perMo: c.perMo ?? "" });
  const chartNote = prevention
    ? t("page.chartNotePrevention", { name })
    : t("page.chartNoteFee", { name });

  return (
    <div className="min-h-screen bg-white text-[#0B1220]">
      <MarketingSiteHeader />

      {/* Hero */}
      <section
        className="relative overflow-hidden py-16 sm:py-[72px]"
        style={{ background: SLATE_GRADIENT }}
      >
        <div className={`${CONTAINER} relative z-[1]`}>
          <div
            className="inline-flex items-center gap-3 mb-5 text-[11px] uppercase tracking-[0.14em]"
            style={{ fontFamily: MONO, color: "rgba(244,238,226,0.65)" }}
          >
            <span className="w-9 h-px bg-[#f4eee2] opacity-60" />
            <span className="bg-[#f4eee2] text-[#1e293b] px-2 py-[3px] font-semibold tracking-[0.1em]">
              {t("page.badge")}
            </span>
          </div>

          <h1
            className="m-0 max-w-[880px] text-[#f4eee2]"
            style={{
              fontFamily: SERIF,
              fontWeight: 400,
              fontSize: "clamp(38px,5.2vw,68px)",
              lineHeight: 1.12,
              letterSpacing: "-0.025em",
            }}
          >
            {t("page.heroTitle", { name })}{" "}
            <em
              className="not-italic sm:italic"
              style={{
                fontStyle: "italic",
                backgroundImage: "linear-gradient(135deg,#60a5fa,#3b82f6 50%,#2563eb)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
                color: "transparent",
              }}
            >
              {t("page.heroEmphasis")}
            </em>
          </h1>

          <div className="h-px bg-[#f4eee2] opacity-50 my-7 max-w-[560px]" />

          <p
            className="text-[17px] leading-relaxed m-0 mb-7 max-w-[580px]"
            style={{ color: "rgba(244,238,226,0.82)" }}
          >
            {t("page.heroIntro", { name })}
          </p>

          <ul className="list-none p-0 m-0 mb-8 max-w-[560px] border-t border-[#f4eee2]/10">
            {heroBullets.map((b, i) => (
              <li
                key={i}
                className="grid grid-cols-[28px_1fr] gap-3.5 items-baseline py-[13px] border-b border-[#f4eee2]/10 text-[16px]"
                style={{ fontFamily: SERIF, color: "rgba(244,238,226,0.88)" }}
              >
                <span className="text-center text-[#60a5fa]" style={{ fontFamily: SERIF, fontStyle: "italic" }}>
                  §
                </span>
                <span>{b}</span>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-3.5">
            <Button
              variant="primary"
              size="lg"
              onClick={openInstall}
              className="gap-2 shadow-[0_12px_30px_-8px_rgba(29,78,216,0.45)]"
            >
              {t("page.ctaInstallFree")}
              <ArrowRight className="w-[18px] h-[18px]" />
            </Button>
            <a href="#comparison">
              <span className="inline-flex items-center h-12 px-6 rounded-lg text-[15px] font-medium text-white border border-white/30 bg-white/10 backdrop-blur-sm">
                {t("page.ctaSeeComparison")}
              </span>
            </a>
          </div>
          <p
            className="mt-[18px] text-[12px] tracking-[0.04em]"
            style={{ fontFamily: MONO, color: "rgba(244,238,226,0.6)" }}
          >
            {t("page.heroTrust")}
          </p>
        </div>
      </section>

      {/* The bottom line — price knockout */}
      <section className="pt-[60px] pb-3">
        <div className={NARROW}>
          <MonoLabel>{t("page.bottomLineLabel")}</MonoLabel>
          <h2
            className="m-0 mb-6"
            style={{
              fontFamily: SERIF,
              fontWeight: 400,
              fontSize: "clamp(30px,3.8vw,48px)",
              lineHeight: 1.08,
              letterSpacing: "-0.02em",
            }}
          >
            {headline}
          </h2>

          <div className="bg-[#0B1220] rounded-[20px] p-7 sm:px-9">
            <span
              className="inline-block text-[12px] uppercase tracking-[0.06em] text-[#94a3b8] mb-[22px]"
              style={{ fontFamily: MONO }}
            >
              {t("page.scenario")}
            </span>
            <div className="grid md:grid-cols-[1.25fr_1fr] gap-9 items-center">
              <div>
                <div className="flex items-center justify-between gap-4 py-4 border-t border-white/10">
                  <span className="flex flex-col">
                    <span className="text-[15px]" style={{ color: "rgba(244,238,226,0.86)" }}>
                      {t(`competitors.${competitorId}.priceThemLabel`)}
                    </span>
                    <span className="text-[11px] text-[#64748b] mt-[3px]" style={{ fontFamily: MONO }}>
                      {t(`competitors.${competitorId}.priceThemSub`)}
                    </span>
                  </span>
                  <span className="text-[22px] font-bold text-[#f87171] whitespace-nowrap" style={{ fontFamily: MONO }}>
                    {c.themCost}
                    <span className="text-[12px] text-[#94a3b8] font-normal">{t("page.perMoSuffix")}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 py-4 border-t border-b border-white/10">
                  <span className="flex flex-col">
                    <span className="text-[15px] font-semibold text-[#f4eee2]">{t("page.usPlanLabel")}</span>
                    <span className="text-[11px] text-[#64748b] mt-[3px]" style={{ fontFamily: MONO }}>
                      {t("page.usPlanSub")}
                    </span>
                  </span>
                  <span className="text-[22px] font-bold text-[#60a5fa] whitespace-nowrap" style={{ fontFamily: MONO }}>
                    $129
                    <span className="text-[12px] text-[#94a3b8] font-normal">{t("page.perMoSuffix")}</span>
                  </span>
                </div>
                <p className="text-[13.5px] leading-relaxed mt-4 mb-0" style={{ color: "rgba(244,238,226,0.65)" }}>
                  {t(`competitors.${competitorId}.priceNote`)}
                </p>
              </div>
              <div className="text-center border-t md:border-t-0 md:border-l border-white/10 pt-6 md:pt-0 md:pl-8">
                <p className="text-[11px] uppercase tracking-[0.1em] text-[#94a3b8] m-0 mb-1.5" style={{ fontFamily: MONO }}>
                  {saveLabel}
                </p>
                <p
                  className="text-[#22C55E] m-0"
                  style={{ fontFamily: SERIF, fontSize: "clamp(48px,6.4vw,78px)", lineHeight: 0.95 }}
                >
                  {c.saveBig}
                </p>
                <p className="text-[14px] mt-2.5 mb-0" style={{ color: "rgba(244,238,226,0.7)" }}>
                  {saveSub}
                </p>
              </div>
            </div>
          </div>
          <p className="text-[13px] text-[#94A3B8] mt-3.5 leading-relaxed max-w-[820px]">
            {t("page.priceFootnote")}
          </p>
          <div className="mt-[22px]">
            <Button variant="primary" size="lg" onClick={openInstall} className="gap-2">
              {t("page.priceCta")}
              <ArrowRight className="w-[17px] h-[17px]" />
            </Button>
          </div>
        </div>
      </section>

      {/* 01 — What competitor does well */}
      <section className="py-[72px]">
        <div className={CONTAINER}>
          <MonoLabel>{t("page.s1Label")}</MonoLabel>
          <h2 className="m-0 mb-3.5" style={{ fontFamily: SERIF, fontWeight: 400, fontSize: "clamp(30px,3.6vw,44px)", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
            {t("page.s1Title", { name })}
          </h2>
          <p className="text-[17px] leading-relaxed text-[#64748B] max-w-[640px] m-0 mb-9">{t("page.s1Intro", { name })}</p>
          <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
            {doesWell.map((item, i) => (
              <div key={i} className="bg-white border border-[#E5E7EB] rounded-xl p-[22px] shadow-[0_1px_2px_rgba(0,0,0,0.04)] flex gap-3.5 items-start">
                <span className="shrink-0 w-7 h-7 rounded-lg bg-[#EFF6FF] flex items-center justify-center">
                  <Check className="w-[15px] h-[15px] text-[#1D4ED8]" strokeWidth={2.5} />
                </span>
                <span className="text-[15px] leading-snug text-[#0B1220]">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 02 — Why an alternative */}
      <section className="py-[72px] bg-[#F6F8FB] border-t border-b border-[#E5E7EB]">
        <div className={CONTAINER}>
          <MonoLabel>{t("page.s2Label")}</MonoLabel>
          <h2 className="m-0 mb-3.5" style={{ fontFamily: SERIF, fontWeight: 400, fontSize: "clamp(30px,3.6vw,44px)", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
            {t("page.s2Title")}
          </h2>
          <p className="text-[17px] leading-relaxed text-[#64748B] max-w-[640px] m-0 mb-9">{t("page.s2Intro")}</p>
          <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
            {whyAlt.map((item, i) => (
              <div key={i} className="bg-white border border-[#E5E7EB] rounded-xl p-[22px] flex gap-3.5 items-start">
                <span className="shrink-0 w-7 h-7 rounded-lg bg-[#FEF2F2] flex items-center justify-center">
                  <X className="w-[15px] h-[15px] text-[#EF4444]" strokeWidth={2.5} />
                </span>
                <span className="text-[15px] leading-snug text-[#0B1220]">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 03 — Comparison table */}
      <section id="comparison" className="py-[72px]">
        <div className={NARROW}>
          <MonoLabel>{t("page.s3Label")}</MonoLabel>
          <h2 className="m-0 mb-[30px]" style={{ fontFamily: SERIF, fontWeight: 400, fontSize: "clamp(30px,3.6vw,44px)", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
            {t("page.s3Title", { name })}
          </h2>
          <div className="border border-[#E5E7EB] rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
            <div className="grid grid-cols-[1.2fr_1fr_1fr]">
              <div className="px-[22px] py-[18px] bg-[#0B1220]" />
              <div className="px-[22px] py-[18px] bg-[#0B1220] text-[12px] uppercase tracking-[0.08em] text-[#94a3b8] text-center" style={{ fontFamily: MONO }}>
                {name}
              </div>
              <div className="px-[22px] py-[18px] bg-[#1D4ED8] text-[12px] uppercase tracking-[0.08em] text-white font-semibold text-center" style={{ fontFamily: MONO }}>
                DisputeDesk
              </div>
            </div>
            {COMPARE_TABLE_ROWS.map((row) => (
              <div key={row} className="grid grid-cols-[1.2fr_1fr_1fr] border-t border-[#E5E7EB]">
                <div className="px-[22px] py-[18px] text-[13px] font-semibold text-[#0B1220] bg-[#F6F8FB]">
                  {t(`page.tableCats.${row}`)}
                </div>
                <div className="px-[22px] py-[18px] text-[14px] leading-snug text-[#64748B] text-center flex items-center justify-center">
                  {t(`competitors.${competitorId}.table.${row}`)}
                </div>
                <div className="px-[22px] py-[18px] text-[14px] leading-snug text-[#0B1220] font-medium text-center bg-[#F5F8FF] flex items-center justify-center">
                  {t(`page.us.${row}`)}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[13px] text-[#94A3B8] mt-4 leading-snug">{t("page.tableNote", { name })}</p>
        </div>
      </section>

      {/* 04 — Which one is right for you */}
      <section className="py-[72px] bg-[#F6F8FB] border-t border-b border-[#E5E7EB]">
        <div className={NARROW}>
          <MonoLabel>{t("page.s4Label")}</MonoLabel>
          <h2 className="m-0 mb-[30px]" style={{ fontFamily: SERIF, fontWeight: 400, fontSize: "clamp(30px,3.6vw,44px)", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
            {t("page.s4Title")}
          </h2>
          <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-[30px]">
              <h3 className="m-0 mb-3.5 text-[24px] text-[#0B1220]" style={{ fontFamily: SERIF, fontWeight: 400 }}>
                {t("page.betterThemTitle", { name })}
              </h3>
              <p className="text-[15px] leading-relaxed text-[#64748B] m-0">{t(`competitors.${competitorId}.betterWhen`)}</p>
            </div>
            <div className="bg-[#0B1220] border border-[#0B1220] rounded-2xl p-[30px]">
              <h3 className="m-0 mb-3.5 text-[24px] text-[#f4eee2]" style={{ fontFamily: SERIF, fontWeight: 400 }}>
                {t("page.betterUsTitle")}
              </h3>
              <p className="text-[15px] leading-relaxed m-0" style={{ color: "rgba(244,238,226,0.82)" }}>
                {t("page.betterUsBody")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 05 — Cost as you grow chart */}
      <section className="py-[72px]">
        <div className={NARROW}>
          <MonoLabel>{t("page.s5Label")}</MonoLabel>
          <h2 className="m-0 mb-3.5" style={{ fontFamily: SERIF, fontWeight: 400, fontSize: "clamp(30px,3.6vw,44px)", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
            {t("page.s5Title")}
          </h2>
          <p className="text-[17px] leading-relaxed text-[#64748B] max-w-[640px] m-0 mb-8">{t("page.s5Intro")}</p>
          <div className="bg-white border border-[#E5E7EB] rounded-[20px] p-8 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
            <div className="flex flex-wrap items-center gap-5 mb-7">
              <span className="inline-flex items-center gap-2 text-[14px] font-semibold text-[#0B1220]">
                <span className="w-3 h-3 rounded-[3px] bg-[#ef4444]" />
                {name}
              </span>
              <span className="inline-flex items-center gap-2 text-[14px] font-semibold text-[#0B1220]">
                <span className="w-3 h-3 rounded-[3px] bg-[#1D4ED8]" />
                DisputeDesk
              </span>
              <span className="text-[11px] uppercase tracking-[0.08em] text-[#94A3B8] ml-auto" style={{ fontFamily: MONO }}>
                {t("page.chartCostLabel")}
              </span>
            </div>
            <div className="flex items-end justify-around gap-4">
              {tiers.map((tier, i) => (
                <div key={i} className="flex flex-col items-center gap-3.5 flex-1">
                  <div className="flex items-end justify-center gap-3 h-[185px]">
                    <div className="flex flex-col items-center justify-end h-full gap-1.5">
                      <span className="text-[13px] font-bold text-[#ef4444]" style={{ fontFamily: MONO }}>{tier.them}</span>
                      <div className="w-10 rounded-t-md" style={{ height: tier.themH, background: "linear-gradient(180deg,#f87171,#ef4444)" }} />
                    </div>
                    <div className="flex flex-col items-center justify-end h-full gap-1.5">
                      <span className="text-[13px] font-bold text-[#1D4ED8]" style={{ fontFamily: MONO }}>{tier.us}</span>
                      <div className="w-10 rounded-t-md" style={{ height: tier.usH, background: "linear-gradient(180deg,#3b82f6,#1D4ED8)" }} />
                    </div>
                  </div>
                  <span className="text-[12px] text-[#64748B] border-t border-[#E5E7EB] pt-3 w-full text-center" style={{ fontFamily: MONO }}>
                    {tier.label} {t("page.chartTierSuffix")}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[14px] leading-relaxed text-[#475569] mt-6 pt-5 border-t border-[#F1F5F9]">{chartNote}</p>
          </div>
        </div>
      </section>

      {/* 06 — Workflow steps */}
      <section className="py-[72px] bg-[#F6F8FB] border-t border-b border-[#E5E7EB]">
        <div className={NARROW}>
          <MonoLabel>{t("page.s6Label")}</MonoLabel>
          <h2 className="m-0 mb-9" style={{ fontFamily: SERIF, fontWeight: 400, fontSize: "clamp(30px,3.6vw,44px)", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
            {t("page.s6Title")}
          </h2>
          <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
            {[
              { n: "01", color: "#1D4ED8", bg: "#EFF6FF", title: t("page.step1Title"), body: t("page.step1Body") },
              { n: "02", color: "#22C55E", bg: "#F0FDF4", title: t("page.step2Title"), body: t("page.step2Body") },
              { n: "03", color: "#F59E0B", bg: "#FFFBEB", title: t("page.step3Title"), body: t("page.step3Body") },
            ].map((step) => (
              <div key={step.n} className="bg-white border border-[#E5E7EB] rounded-2xl p-7">
                <span
                  className="inline-flex text-[12px] font-semibold tracking-[0.08em] rounded-lg px-3 py-1.5 mb-[18px]"
                  style={{ fontFamily: MONO, color: step.color, background: step.bg }}
                >
                  {step.n}
                </span>
                <h3 className="text-[18px] font-semibold m-0 mb-2 text-[#0B1220]">{step.title}</h3>
                <p className="text-[14px] leading-relaxed text-[#64748B] m-0">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 07 — FAQ */}
      <section className="py-[72px]">
        <div className="max-w-[820px] mx-auto px-6">
          <MonoLabel>{t("page.s7Label")}</MonoLabel>
          <h2 className="m-0 mb-[30px]" style={{ fontFamily: SERIF, fontWeight: 400, fontSize: "clamp(30px,3.6vw,44px)", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
            {t("page.s7Title")}
          </h2>
          <div className="flex flex-col gap-3.5">
            {faqs.map((_, i) => (
              <div key={i} className="bg-white border border-[#E5E7EB] rounded-xl px-6 py-[22px]">
                <h3 className="text-[16px] font-semibold m-0 mb-2 text-[#0B1220]">{t(`page.faqs.${i}.q`, { name })}</h3>
                <p className="text-[15px] leading-relaxed text-[#64748B] m-0">{t(`page.faqs.${i}.a`, { name })}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Keep reading */}
      <section className="pb-[72px]">
        <div className={NARROW}>
          <div className="bg-[#F6F8FB] border border-[#E5E7EB] rounded-2xl p-9">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[#64748B] m-0 mb-[18px]" style={{ fontFamily: MONO }}>
              {t("page.keepReading")}
            </p>
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
              <Link href="/compare" className="no-underline flex items-center justify-between gap-3 bg-white border border-[#E5E7EB] rounded-[10px] px-[18px] py-4 text-[14px] font-medium text-[#0B1220]">
                {t("page.linkAllComparisons")} <span className="text-[#1D4ED8]">→</span>
              </Link>
              <Link href="/resources" className="no-underline flex items-center justify-between gap-3 bg-white border border-[#E5E7EB] rounded-[10px] px-[18px] py-4 text-[14px] font-medium text-[#0B1220]">
                {t("page.linkResources")} <span className="text-[#1D4ED8]">→</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative overflow-hidden py-[72px]" style={{ background: SLATE_GRADIENT }}>
        <div className="max-w-[820px] mx-auto px-6 text-center">
          <h2
            className="m-0 mb-4 text-[#f4eee2]"
            style={{ fontFamily: SERIF, fontWeight: 400, fontSize: "clamp(32px,4vw,52px)", lineHeight: 1.1, letterSpacing: "-0.02em" }}
          >
            {t("page.finalTitle")}
          </h2>
          <p className="text-[17px] leading-relaxed mx-auto mb-7 max-w-[560px]" style={{ color: "rgba(244,238,226,0.82)" }}>
            {t("page.finalBody")}
          </p>
          <Button variant="primary" size="lg" onClick={openInstall} className="h-[52px] px-7 gap-2 text-[16px] shadow-[0_12px_30px_-8px_rgba(29,78,216,0.45)]">
            {t("page.finalCta")}
            <ArrowRight className="w-[18px] h-[18px]" />
          </Button>
        </div>
      </section>

      <MarketingSiteFooter base={base} />

      {/* Trademark disclaimer strip (below footer, like the design) */}
      <div className="bg-[#0B1220] text-[#94a3b8] text-[12px] text-center px-6 pb-8 -mt-2">
        {t("page.trademarkNote")}
      </div>

      {/* Install modal */}
      {showInstall && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="compare-install-title"
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#0B1220]/70 backdrop-blur-sm"
          onClick={closeInstall}
        >
          <div
            className="relative w-full max-w-lg bg-white rounded-xl border border-[#E5E7EB] shadow-2xl p-6 sm:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeInstall}
              aria-label="Close"
              className="absolute top-4 right-4 w-8 h-8 rounded-lg flex items-center justify-center text-[#64748B] hover:text-[#0B1220] hover:bg-[#F6F8FB] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-[#1D4ED8] rounded-lg flex items-center justify-center">
                <Store className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 id="compare-install-title" className="text-lg font-semibold text-[#0B1220]">
                  {tm("pricing.installTitle")}
                </h3>
                <p className="text-sm text-[#64748B]">{tm("pricing.installSubtitle")}</p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={shopInput}
                onChange={(e) => {
                  setShopInput(e.target.value);
                  setShopError(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && submitInstall()}
                placeholder={tm("pricing.shopPlaceholder")}
                className="flex-1 px-4 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-sm text-[#0B1220] placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/40 focus:border-[#1D4ED8]"
                autoFocus
              />
              <Button variant="primary" onClick={submitInstall}>
                {tm("pricing.installButton")}
              </Button>
            </div>
            {shopError && <p className="text-sm text-[#EF4444] mt-2">{shopError}</p>}
            <p className="text-xs text-[#94A3B8] mt-3">{tm("pricing.installHint")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
