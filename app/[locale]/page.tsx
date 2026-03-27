"use client";

import { useState } from "react";
import { Shield, ArrowRight, Check, Lock, FileText, BarChart3, Zap, RefreshCw, Menu, X, Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/ui/language-switcher";

type RoiMode = "conservative" | "base" | "aggressive";

const ROI_DATA: Record<RoiMode, { segments: { segment: string; popular?: boolean; disputes: string; plan: string; value: string; price: string; roi: string }[] }> = {
  conservative: {
    segments: [
      { segment: "Serious SMB", disputes: "5\u201310", plan: "Starter (15 packs)", value: "$80\u2013$300", price: "$29", roi: "~3\u201310\u00d7" },
      { segment: "Ops-led SMB / Mid", popular: true, disputes: "15\u201360", plan: "Growth (75 packs)", value: "$500\u2013$2,500", price: "$79", roi: "~6\u201332\u00d7" },
      { segment: "High-volume / Agency", disputes: "75\u2013300", plan: "Pro/Scale (300 packs)", value: "$2,500\u2013$12,000", price: "$149", roi: "~17\u201380\u00d7" },
    ],
  },
  base: {
    segments: [
      { segment: "Serious SMB", disputes: "5\u201310", plan: "Starter (15 packs)", value: "$120\u2013$450", price: "$29", roi: "~4\u201315\u00d7" },
      { segment: "Ops-led SMB / Mid", popular: true, disputes: "15\u201360", plan: "Growth (75 packs)", value: "$800\u2013$4,000", price: "$79", roi: "~10\u201350\u00d7" },
      { segment: "High-volume / Agency", disputes: "75\u2013300", plan: "Pro/Scale (300 packs)", value: "$4,000\u2013$20,000+", price: "$149", roi: "~25\u2013130\u00d7" },
    ],
  },
  aggressive: {
    segments: [
      { segment: "Serious SMB", disputes: "5\u201310", plan: "Starter (15 packs)", value: "$180\u2013$700", price: "$29", roi: "~6\u201324\u00d7" },
      { segment: "Ops-led SMB / Mid", popular: true, disputes: "15\u201360", plan: "Growth (75 packs)", value: "$1,200\u2013$6,000", price: "$79", roi: "~15\u201376\u00d7" },
      { segment: "High-volume / Agency", disputes: "75\u2013300", plan: "Pro/Scale (300 packs)", value: "$6,000\u2013$30,000+", price: "$149", roi: "~40\u2013200\u00d7" },
    ],
  },
};

export default function MarketingLandingPage() {
  const t = useTranslations("marketing");
  const [mobileNav, setMobileNav] = useState(false);
  const [roiMode, setRoiMode] = useState<RoiMode>("base");

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-[#E5E7EB] sticky top-0 bg-white z-50">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#1D4ED8] rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-[#0B1220]">DisputeDesk</span>
          </div>

          <nav className="hidden md:flex items-center gap-8">
            <a href="#how-it-works" className="text-sm text-[#64748B] hover:text-[#0B1220] transition-colors">{t("nav.product")}</a>
            <a href="#how-it-works" className="text-sm text-[#64748B] hover:text-[#0B1220] transition-colors">{t("nav.howItWorks")}</a>
            <a href="#security" className="text-sm text-[#64748B] hover:text-[#0B1220] transition-colors">{t("nav.security")}</a>
            <a href="#pricing" className="text-sm text-[#64748B] hover:text-[#0B1220] transition-colors">{t("nav.pricing")}</a>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <LanguageSwitcher />
            <a href="/auth/sign-in" className="hidden sm:block">
              <Button variant="ghost" size="sm">{t("nav.signIn")}</Button>
            </a>
            <a href="/portal/connect-shopify" className="hidden sm:block">
              <Button variant="primary" size="sm">{t("nav.installOnShopify")}</Button>
            </a>
            <button
              onClick={() => setMobileNav(!mobileNav)}
              className="md:hidden w-10 h-10 flex items-center justify-center rounded-lg hover:bg-[#F1F5F9] text-[#64748B]"
            >
              {mobileNav ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile nav dropdown */}
        {mobileNav && (
          <div className="md:hidden border-t border-[#E5E7EB] bg-white px-4 py-4 space-y-3">
            <a href="#how-it-works" onClick={() => setMobileNav(false)} className="block text-sm text-[#64748B] hover:text-[#0B1220] py-2">{t("nav.product")}</a>
            <a href="#how-it-works" onClick={() => setMobileNav(false)} className="block text-sm text-[#64748B] hover:text-[#0B1220] py-2">{t("nav.howItWorks")}</a>
            <a href="#security" onClick={() => setMobileNav(false)} className="block text-sm text-[#64748B] hover:text-[#0B1220] py-2">{t("nav.security")}</a>
            <a href="#pricing" onClick={() => setMobileNav(false)} className="block text-sm text-[#64748B] hover:text-[#0B1220] py-2">{t("nav.pricing")}</a>
            <div className="pt-3 border-t border-[#E5E7EB] flex flex-col gap-2">
              <a href="/auth/sign-in"><Button variant="ghost" size="sm" className="w-full">{t("nav.signIn")}</Button></a>
              <a href="/portal/connect-shopify"><Button variant="primary" size="sm" className="w-full">{t("nav.installOnShopify")}</Button></a>
            </div>
          </div>
        )}
      </header>

      {/* Hero — palette + layout from Figma Make (DisputeDesk Shopify App Design) */}
      <section
        className="relative py-12 sm:py-20 lg:py-28 overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, var(--dd-hero-bg-start) 0%, var(--dd-hero-bg-mid) 40%, var(--dd-hero-bg-end) 100%)",
        }}
      >
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
          <div
            className="absolute top-20 left-4 sm:left-10 w-72 sm:w-96 h-72 sm:h-96 rounded-full mix-blend-screen filter blur-3xl opacity-[0.15] dd-hero-blob"
            style={{ backgroundColor: "var(--dd-hero-blob-a)" }}
          />
          <div
            className="absolute top-40 right-4 sm:right-10 w-72 sm:w-96 h-72 sm:h-96 rounded-full mix-blend-screen filter blur-3xl opacity-[0.12] dd-hero-blob dd-hero-blob-delay-2s"
            style={{ backgroundColor: "var(--dd-hero-blob-b)" }}
          />
          <div
            className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-72 sm:w-96 h-72 sm:h-96 rounded-full mix-blend-screen filter blur-3xl opacity-[0.1] dd-hero-blob dd-hero-blob-delay-4s"
            style={{ backgroundColor: "var(--dd-hero-blob-c)" }}
          />
        </div>

        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 sm:gap-12 items-center">
            <div>
              <p className="text-sm uppercase tracking-wide text-[#93C5FD] font-medium mb-3">
                {t("hero.tagline")}
              </p>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-bold mb-4 sm:mb-6 leading-tight tracking-tight bg-gradient-to-r from-[var(--dd-hero-gradient-from)] via-[var(--dd-hero-gradient-via)] to-[var(--dd-hero-gradient-to)] bg-clip-text text-transparent">
                {t("hero.headline")}
              </h1>
              <p className="text-lg sm:text-xl text-slate-300 mb-6 sm:mb-8 leading-relaxed">
                {t("hero.subheadline")}
              </p>

              <div className="space-y-3 sm:space-y-4 mb-6 sm:mb-8">
                <div className="flex items-start gap-3">
                  <Zap className="w-5 h-5 sm:w-6 sm:h-6 text-[#22C55E] flex-shrink-0 mt-0.5 sm:mt-1" />
                  <p className="text-sm sm:text-base text-slate-200">{t("hero.bullet1")}</p>
                </div>
                <div className="flex items-start gap-3">
                  <Check className="w-5 h-5 sm:w-6 sm:h-6 text-[#22C55E] flex-shrink-0 mt-0.5 sm:mt-1" />
                  <p className="text-sm sm:text-base text-slate-200">{t("hero.bullet2")}</p>
                </div>
                <div className="flex items-start gap-3">
                  <BarChart3 className="w-5 h-5 sm:w-6 sm:h-6 text-[#22C55E] flex-shrink-0 mt-0.5 sm:mt-1" />
                  <p className="text-sm sm:text-base text-slate-200">{t("hero.bullet3")}</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                <a href="/portal/connect-shopify">
                  <Button
                    variant="primary"
                    size="lg"
                    className="w-full sm:w-auto bg-white text-[#0B1220] hover:bg-slate-100 border-2 border-white shadow-xl shadow-black/25 focus:ring-white/60 [&_svg]:text-[#0B1220]"
                  >
                    {t("hero.installFree")}
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </a>
                <a href="#pricing">
                  <Button
                    variant="secondary"
                    size="lg"
                    className="w-full sm:w-auto bg-white/10 backdrop-blur-sm border-2 border-white/30 text-white hover:bg-white/20 hover:border-white/50 shadow-lg focus:ring-white/40"
                  >
                    {t("hero.viewPricing")}
                  </Button>
                </a>
              </div>

              <p className="text-xs sm:text-sm text-slate-400 mt-4 sm:mt-6 border-t border-white/15 pt-4 sm:pt-6">
                {t("hero.disclaimer")}
              </p>
            </div>

            {/* Product preview card — visible on all screens */}
            <div className="relative mt-8 lg:mt-0">
              <div className="absolute -inset-4 bg-gradient-to-r from-[#3B82F6]/30 via-[#60A5FA]/20 to-[#3B82F6]/30 rounded-3xl blur-3xl" />

              <div className="relative bg-white rounded-2xl shadow-2xl border border-[#E5E7EB] p-6 overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-[#1D4ED8]/5 to-transparent rounded-full -mr-32 -mt-32" />

                <div className="relative mb-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-[#0B1220]">{t("hero.queueTitle")}</h3>
                    <span className="text-xs text-[#64748B] bg-[#F6F8FB] px-2.5 py-1 rounded-full">{t("hero.queuePending", { count: 3 })}</span>
                  </div>
                  <div className="space-y-2.5">
                    {[
                      { id: "DP-2401", amount: "$145.00", icon: "\uD83D\uDCB3" },
                      { id: "DP-2402", amount: "$89.50", icon: "\uD83D\uDCE6" },
                      { id: "DP-2403", amount: "$312.00", icon: "\uD83D\uDD04" },
                    ].map((item) => (
                      <div key={item.id} className="flex items-center justify-between p-3 bg-gradient-to-r from-[#F6F8FB] to-white rounded-xl border border-[#E5E7EB]/50 hover:border-[#1D4ED8]/30 transition-all duration-200 hover:shadow-sm">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 bg-gradient-to-br from-[#DBEAFE] to-[#BFDBFE] rounded-lg flex items-center justify-center text-lg shadow-sm">
                            {item.icon}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-[#0B1220]">{item.id}</p>
                            <p className="text-xs text-[#64748B] font-medium">{item.amount}</p>
                          </div>
                        </div>
                        <div className="px-3 py-1.5 bg-gradient-to-r from-[#FEF3C7] to-[#FDE68A] text-[#92400E] text-xs font-semibold rounded-lg shadow-sm">
                          {t("hero.queueReview")}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="relative bg-gradient-to-br from-[#DBEAFE] via-[#DBEAFE] to-[#BFDBFE] rounded-xl p-5 border border-[#BFDBFE] shadow-inner">
                  <h4 className="font-semibold text-[#0B1220] mb-4 flex items-center gap-2">
                    <div className="w-6 h-6 bg-white/50 rounded-lg flex items-center justify-center">
                      <Check className="w-4 h-4 text-[#1D4ED8]" />
                    </div>
                    {t("hero.completenessTitle")}
                  </h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-2.5 bg-white/60 rounded-lg">
                      <span className="text-sm text-[#0B1220] font-medium">{t("hero.orderConfirmation")}</span>
                      <div className="w-5 h-5 bg-[#22C55E] rounded-md flex items-center justify-center shadow-sm">
                        <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-2.5 bg-white/60 rounded-lg">
                      <span className="text-sm text-[#0B1220] font-medium">{t("hero.shippingTracking")}</span>
                      <div className="w-5 h-5 bg-[#22C55E] rounded-md flex items-center justify-center shadow-sm">
                        <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-2.5 bg-white/40 rounded-lg border border-[#E5E7EB]/30">
                      <span className="text-sm text-[#64748B] font-medium">{t("hero.customerComm")}</span>
                      <div className="w-5 h-5 border-2 border-[#CBD5E1] rounded-md bg-white/50" />
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-white/40">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-[#0B1220]">{t("hero.completenessScore")}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 bg-white/50 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-[#3B82F6] to-[#1D4ED8] rounded-full" style={{ width: "67%" }} />
                        </div>
                        <span className="text-lg font-bold text-[#1D4ED8]">67%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-12 sm:py-16 lg:py-20">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-8">
          <div className="text-center mb-12 sm:mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-[#0B1220] mb-4">{t("howItWorks.title")}</h2>
            <p className="text-lg sm:text-xl text-[#64748B]">{t("howItWorks.subtitle")}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-[#DBEAFE] rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Shield className="w-8 h-8 text-[#1D4ED8]" />
              </div>
              <h3 className="text-xl font-semibold text-[#0B1220] mb-3">{t("howItWorks.step1Title")}</h3>
              <p className="text-[#64748B]">{t("howItWorks.step1Desc")}</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-[#DCFCE7] rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Zap className="w-8 h-8 text-[#22C55E]" />
              </div>
              <h3 className="text-xl font-semibold text-[#0B1220] mb-3">{t("howItWorks.step2Title")}</h3>
              <p className="text-[#64748B]">{t("howItWorks.step2Desc")}</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-[#FEF3C7] rounded-2xl flex items-center justify-center mx-auto mb-6">
                <RefreshCw className="w-8 h-8 text-[#F59E0B]" />
              </div>
              <h3 className="text-xl font-semibold text-[#0B1220] mb-3">{t("howItWorks.step3Title")}</h3>
              <p className="text-[#64748B]">{t("howItWorks.step3Desc")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="py-12 sm:py-16 lg:py-20 bg-[#F6F8FB]">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-8">
          <div className="text-center mb-12 sm:mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-[#0B1220] mb-4">{t("security.title")}</h2>
            <p className="text-lg sm:text-xl text-[#64748B]">{t("security.subtitle")}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
            <div className="bg-white rounded-xl p-6 border border-[#E5E7EB]">
              <Lock className="w-8 h-8 text-[#1D4ED8] mb-4" />
              <h3 className="text-lg font-semibold text-[#0B1220] mb-2">{t("security.encryptedTitle")}</h3>
              <p className="text-sm text-[#64748B]">{t("security.encryptedDesc")}</p>
            </div>
            <div className="bg-white rounded-xl p-6 border border-[#E5E7EB]">
              <BarChart3 className="w-8 h-8 text-[#1D4ED8] mb-4" />
              <h3 className="text-lg font-semibold text-[#0B1220] mb-2">{t("security.auditTitle")}</h3>
              <p className="text-sm text-[#64748B]">{t("security.auditDesc")}</p>
            </div>
            <div className="bg-white rounded-xl p-6 border border-[#E5E7EB]">
              <FileText className="w-8 h-8 text-[#1D4ED8] mb-4" />
              <h3 className="text-lg font-semibold text-[#0B1220] mb-2">{t("security.signedTitle")}</h3>
              <p className="text-sm text-[#64748B]">{t("security.signedDesc")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-12 sm:py-16 lg:py-20">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-8">
          <div className="text-center mb-6">
            <h2 className="text-3xl sm:text-4xl font-bold text-[#0B1220] mb-4">{t("pricing.title")}</h2>
            <p className="text-lg sm:text-xl text-[#64748B] max-w-2xl mx-auto">{t("pricing.subtitle")}</p>
          </div>
          <p className="text-center text-sm text-[#94A3B8] mb-8 sm:mb-12">{t("pricing.trialInfo")}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8 sm:mb-12">
            {/* Free */}
            <div className="bg-white rounded-xl p-6 border border-[#E5E7EB]">
              <h3 className="text-lg font-semibold text-[#0B1220] mb-1">{t("pricing.freeName")}</h3>
              <div className="mb-5"><span className="text-3xl font-bold text-[#0B1220]">$0</span></div>
              <ul className="space-y-2.5 mb-6">
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.freeF1")}</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.freeF2")}</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.freeF3")}</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.freeF4")}</li>
              </ul>
              <a href="/auth/sign-up"><Button variant="secondary" className="w-full">{t("pricing.getStarted")}</Button></a>
            </div>

            {/* Starter */}
            <div className="bg-white rounded-xl p-6 border border-[#E5E7EB]">
              <h3 className="text-lg font-semibold text-[#0B1220] mb-1">{t("pricing.starterName")}</h3>
              <div className="mb-5"><span className="text-3xl font-bold text-[#0B1220]">$29</span><span className="text-[#64748B] text-sm">/mo</span></div>
              <ul className="space-y-2.5 mb-6">
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.starterF1")}</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.starterF2")}</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.starterF3")}</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.starterF4")}</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.starterF5")}</li>
              </ul>
              <a href="/portal/connect-shopify"><Button variant="secondary" className="w-full">{t("pricing.startTrial")}</Button></a>
            </div>

            {/* Growth */}
            <div className="bg-[#1D4ED8] rounded-xl p-6 text-white relative">
              <div className="absolute top-3 right-3 bg-white text-[#1D4ED8] text-xs font-semibold px-2 py-0.5 rounded">{t("pricing.popular")}</div>
              <h3 className="text-lg font-semibold mb-1">{t("pricing.growthName")}</h3>
              <div className="mb-5"><span className="text-3xl font-bold">$79</span><span className="opacity-80 text-sm">/mo</span></div>
              <ul className="space-y-2.5 mb-6">
                <li className="flex items-start gap-2 text-sm"><Check className="w-4 h-4 flex-shrink-0 mt-0.5" />{t("pricing.growthF1")}</li>
                <li className="flex items-start gap-2 text-sm"><Check className="w-4 h-4 flex-shrink-0 mt-0.5" />{t("pricing.growthF2")}</li>
                <li className="flex items-start gap-2 text-sm"><Check className="w-4 h-4 flex-shrink-0 mt-0.5" />{t("pricing.growthF3")}</li>
                <li className="flex items-start gap-2 text-sm"><Check className="w-4 h-4 flex-shrink-0 mt-0.5" />{t("pricing.growthF4")}</li>
                <li className="flex items-start gap-2 text-sm"><Check className="w-4 h-4 flex-shrink-0 mt-0.5" />{t("pricing.growthF5")}</li>
              </ul>
              <a href="/portal/connect-shopify"><Button variant="secondary" className="w-full bg-white text-[#1D4ED8] hover:bg-[#F6F8FB]">{t("pricing.startTrial")}</Button></a>
            </div>

            {/* Scale */}
            <div className="bg-white rounded-xl p-6 border border-[#E5E7EB]">
              <h3 className="text-lg font-semibold text-[#0B1220] mb-1">{t("pricing.scaleName")}</h3>
              <div className="mb-5"><span className="text-3xl font-bold text-[#0B1220]">$149</span><span className="text-[#64748B] text-sm">/mo</span></div>
              <ul className="space-y-2.5 mb-6">
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.scaleF1")}</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.scaleF2")}</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.scaleF3")}</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.scaleF4")}</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.scaleF5")}</li>
              </ul>
              <a href="/portal/connect-shopify"><Button variant="secondary" className="w-full">{t("pricing.startTrial")}</Button></a>
            </div>
          </div>
        </div>
      </section>

      {/* ROI Snapshot */}
      <section className="py-12 sm:py-16 lg:py-20 bg-[#F6F8FB]">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-8">
          <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden">
            {/* Header */}
            <div className="p-6 sm:p-8 pb-0">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
                <div>
                  <h2 className="text-2xl font-bold text-[#0B1220]">{t("roi.title")}</h2>
                  <p className="text-[#64748B] mt-1">{t("roi.subtitle")}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="inline-flex rounded-lg border border-[#E5E7EB] overflow-hidden">
                    {(["conservative", "base", "aggressive"] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setRoiMode(mode)}
                        className={`px-4 py-2 text-sm font-medium transition-colors ${
                          roiMode === mode
                            ? "bg-[#0B1220] text-white"
                            : "bg-white text-[#64748B] hover:text-[#0B1220]"
                        }`}
                      >
                        {t(`roi.mode${mode.charAt(0).toUpperCase() + mode.slice(1)}`)}
                      </button>
                    ))}
                  </div>
                  <a href="#pricing" className="hidden sm:flex items-center gap-1 text-sm font-medium text-[#1D4ED8] hover:underline whitespace-nowrap">
                    {t("roi.calculateCta")}
                    <ArrowRight className="w-4 h-4" />
                  </a>
                </div>
              </div>

              {/* Info banner */}
              <div className="flex items-start gap-2.5 bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg px-4 py-3 mt-5 mb-6">
                <Info className="w-4 h-4 text-[#1D4ED8] flex-shrink-0 mt-0.5" />
                <p className="text-sm text-[#1D4ED8]">
                  <strong>{t("roi.bannerBold")}</strong>{" "}
                  <span className="font-normal">{t("roi.bannerRest")}</span>
                </p>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-t border-b border-[#E5E7EB]">
                    <th className="text-left px-6 sm:px-8 py-3 text-[10px] sm:text-xs font-medium text-[#64748B] uppercase tracking-wider">{t("roi.colSegment")}</th>
                    <th className="text-center px-4 py-3 text-[10px] sm:text-xs font-medium text-[#64748B] uppercase tracking-wider hidden sm:table-cell">{t("roi.colDisputes")}</th>
                    <th className="text-center px-4 py-3 text-[10px] sm:text-xs font-medium text-[#64748B] uppercase tracking-wider hidden md:table-cell">{t("roi.colPlan")}</th>
                    <th className="text-center px-4 py-3 text-[10px] sm:text-xs font-medium text-[#64748B] uppercase tracking-wider">{t("roi.colValue")}</th>
                    <th className="text-center px-4 py-3 text-[10px] sm:text-xs font-medium text-[#64748B] uppercase tracking-wider">{t("roi.colPrice")}</th>
                    <th className="text-center px-4 py-3 text-[10px] sm:text-xs font-medium text-[#64748B] uppercase tracking-wider">{t("roi.colRoi")}</th>
                  </tr>
                </thead>
                <tbody>
                  {ROI_DATA[roiMode].segments.map((row, i) => (
                    <tr key={i} className="border-b border-[#E5E7EB] last:border-b-0">
                      <td className="px-6 sm:px-8 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-[#0B1220]">{row.segment}</span>
                          {row.popular && (
                            <span className="text-[10px] font-medium text-[#1D4ED8] bg-[#EFF6FF] border border-[#BFDBFE] px-2 py-0.5 rounded-full whitespace-nowrap">
                              {t("roi.mostPopular")}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-center px-4 py-4 text-sm text-[#64748B] hidden sm:table-cell">{row.disputes}</td>
                      <td className="text-center px-4 py-4 text-sm text-[#64748B] hidden md:table-cell">{row.plan}</td>
                      <td className="text-center px-4 py-4 text-sm font-medium text-[#0B1220]">{row.value}</td>
                      <td className="text-center px-4 py-4 text-sm font-semibold text-[#0B1220]">{row.price}</td>
                      <td className="text-center px-4 py-4">
                        <span className="text-sm font-semibold text-[#22C55E]">{row.roi}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer note */}
            <div className="px-6 sm:px-8 py-4 border-t border-[#E5E7EB]">
              <p className="text-xs text-[#94A3B8]">{t("roi.disclaimer")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#0B1220] text-white py-8 sm:py-12">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8 mb-6 sm:mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-[#1D4ED8] rounded-lg flex items-center justify-center">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <span className="text-lg font-bold">DisputeDesk</span>
              </div>
              <p className="text-sm text-gray-400">{t("footer.tagline")}</p>
            </div>
            <div>
              <h3 className="font-semibold mb-4">{t("footer.product")}</h3>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#how-it-works" className="hover:text-white transition-colors">{t("footer.features")}</a></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">{t("nav.pricing")}</a></li>
                <li><a href="#security" className="hover:text-white transition-colors">{t("nav.security")}</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4">{t("footer.company")}</h3>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#how-it-works" className="hover:text-white transition-colors">{t("footer.about")}</a></li>
                <li><a href="mailto:support@disputedesk.com" className="hover:text-white transition-colors">{t("footer.contact")}</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4">{t("footer.legal")}</h3>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="/terms" className="hover:text-white transition-colors">{t("footer.terms")}</a></li>
                <li><a href="/privacy" className="hover:text-white transition-colors">{t("footer.privacy")}</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-8 text-sm text-gray-400 text-center">
            <p>{t("footer.copyright")}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
