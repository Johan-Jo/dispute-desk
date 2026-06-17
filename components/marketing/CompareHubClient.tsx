"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { MarketingSiteHeader } from "@/components/marketing/MarketingSiteHeader";
import { MarketingSiteFooter } from "@/components/marketing/MarketingSiteFooter";
import { Link } from "@/i18n/navigation";
import { COMPETITORS } from "@/lib/compare/competitors";
import { SHOPIFY_INSTALL_URL } from "@/lib/marketing/shopifyInstallUrl";

const SLATE_GRADIENT =
  "linear-gradient(135deg, var(--dd-hero-bg-start) 0%, var(--dd-hero-bg-mid) 40%, var(--dd-hero-bg-end) 100%)";
const SERIF = "var(--font-crimson-pro), 'Instrument Serif', Georgia, serif";
const MONO = "var(--font-jetbrains-mono), 'JetBrains Mono', ui-monospace, monospace";
const CONTAINER = "max-w-[1200px] mx-auto px-6";

export function CompareHubClient({ base = "" }: { base?: string }) {
  const t = useTranslations("compare");

  return (
    <div className="min-h-screen bg-white text-[#0B1220]">
      <MarketingSiteHeader />

      {/* Hero */}
      <section className="relative overflow-hidden py-16 sm:py-[72px]" style={{ background: SLATE_GRADIENT }}>
        <div className={CONTAINER}>
          <div
            className="inline-flex items-center gap-3 mb-5 text-[11px] uppercase tracking-[0.14em]"
            style={{ fontFamily: MONO, color: "rgba(244,238,226,0.65)" }}
          >
            <span className="w-9 h-px bg-[#f4eee2] opacity-60" />
            <span className="bg-[#f4eee2] text-[#1e293b] px-2 py-[3px] font-semibold tracking-[0.1em]">
              {t("hub.badge")}
            </span>
          </div>
          <h1
            className="m-0 max-w-[880px] text-[#f4eee2]"
            style={{ fontFamily: SERIF, fontWeight: 400, fontSize: "clamp(38px,5vw,64px)", lineHeight: 1.12, letterSpacing: "-0.025em" }}
          >
            {t("hub.title")}
          </h1>
          <p className="text-[18px] leading-relaxed mt-6 max-w-[640px]" style={{ color: "rgba(244,238,226,0.82)" }}>
            {t("hub.subtitle")}
          </p>
        </div>
      </section>

      {/* Alternatives grid */}
      <section className="py-[72px]">
        <div className={CONTAINER}>
          <p className="text-[11px] uppercase tracking-[0.14em] text-[#1D4ED8] m-0 mb-3" style={{ fontFamily: MONO }}>
            {t("hub.sectionAlternatives")}
          </p>
          <p className="text-[17px] leading-relaxed text-[#64748B] max-w-[640px] m-0 mb-9">
            {t("hub.sectionAlternativesDesc")}
          </p>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
            {COMPETITORS.map((c) => (
              <Link
                key={c.id}
                href={`/compare/${c.slug}`}
                className="group no-underline bg-white border border-[#E5E7EB] rounded-2xl p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-[#1D4ED8] hover:shadow-[0_12px_30px_-12px_rgba(29,78,216,0.25)] transition-all flex flex-col"
              >
                <span className="text-[11px] uppercase tracking-[0.1em] text-[#94A3B8]" style={{ fontFamily: MONO }}>
                  {t("hub.vs")}
                </span>
                <span className="text-[22px] mt-1 text-[#0B1220]" style={{ fontFamily: SERIF, fontWeight: 400 }}>
                  {t(`competitors.${c.id}.name`)}
                </span>
                <span className="text-[14px] leading-snug text-[#64748B] mt-2">
                  {t(`competitors.${c.id}.focus`)}
                </span>
                <span className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[#1D4ED8] mt-4">
                  {t("hub.altCardCta")}
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden py-[72px]" style={{ background: SLATE_GRADIENT }}>
        <div className="max-w-[820px] mx-auto px-6 text-center">
          <h2
            className="m-0 mb-4 text-[#f4eee2]"
            style={{ fontFamily: SERIF, fontWeight: 400, fontSize: "clamp(30px,4vw,48px)", lineHeight: 1.1, letterSpacing: "-0.02em" }}
          >
            {t("hub.ctaTitle")}
          </h2>
          <p className="text-[17px] leading-relaxed mx-auto mb-7 max-w-[560px]" style={{ color: "rgba(244,238,226,0.82)" }}>
            {t("hub.ctaBody")}
          </p>
          <a href={SHOPIFY_INSTALL_URL}>
            <Button variant="primary" size="lg" className="gap-2 shadow-[0_12px_30px_-8px_rgba(29,78,216,0.45)]">
              {t("hub.ctaButton")}
              <ArrowRight className="w-[18px] h-[18px]" />
            </Button>
          </a>
        </div>
      </section>

      <MarketingSiteFooter base={base} />
    </div>
  );
}
