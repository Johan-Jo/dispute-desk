"use client";

import { Shield, ArrowRight, Check, Lock, FileText, BarChart3, Zap, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/ui/language-switcher";

export default function MarketingLandingPage() {
  const t = useTranslations("marketing");

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-[#E5E7EB] sticky top-0 bg-white z-50">
        <div className="max-w-[1440px] mx-auto px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#1D4ED8] rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold text-[#0B1220]">DisputeDesk</h1>
          </div>

          <nav className="hidden md:flex items-center gap-8">
            <a href="#product" className="text-sm text-[#64748B] hover:text-[#0B1220] transition-colors">{t("nav.product")}</a>
            <a href="#how-it-works" className="text-sm text-[#64748B] hover:text-[#0B1220] transition-colors">{t("nav.howItWorks")}</a>
            <a href="#security" className="text-sm text-[#64748B] hover:text-[#0B1220] transition-colors">{t("nav.security")}</a>
            <a href="#pricing" className="text-sm text-[#64748B] hover:text-[#0B1220] transition-colors">{t("nav.pricing")}</a>
          </nav>

          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <a href="/auth/sign-in">
              <Button variant="ghost" size="sm">{t("nav.signIn")}</Button>
            </a>
            <a href="/portal/connect-shopify">
              <Button variant="primary" size="sm">{t("nav.installOnShopify")}</Button>
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="py-20 lg:py-28" style={{ background: "linear-gradient(180deg, #EFF6FF 0%, #FFFFFF 60%)" }}>
        <div className="max-w-[1440px] mx-auto px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-sm uppercase tracking-wide text-[#1D4ED8] font-medium mb-3">
                {t("hero.tagline")}
              </p>
              <h1 className="text-5xl lg:text-6xl font-bold text-[#0B1220] mb-6 leading-tight">
                {t("hero.headline")}
              </h1>
              <p className="text-xl text-[#64748B] mb-8 leading-relaxed">
                {t("hero.subheadline")}
              </p>

              <div className="space-y-4 mb-8">
                <div className="flex items-start gap-3">
                  <Zap className="w-6 h-6 text-[#22C55E] flex-shrink-0 mt-1" />
                  <p className="text-[#0B1220]">{t("hero.bullet1")}</p>
                </div>
                <div className="flex items-start gap-3">
                  <Check className="w-6 h-6 text-[#22C55E] flex-shrink-0 mt-1" />
                  <p className="text-[#0B1220]">{t("hero.bullet2")}</p>
                </div>
                <div className="flex items-start gap-3">
                  <BarChart3 className="w-6 h-6 text-[#22C55E] flex-shrink-0 mt-1" />
                  <p className="text-[#0B1220]">{t("hero.bullet3")}</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                <a href="/portal/connect-shopify">
                  <Button variant="primary" size="lg">
                    {t("hero.installFree")}
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </a>
                <a href="#pricing">
                  <Button variant="secondary" size="lg">{t("hero.viewPricing")}</Button>
                </a>
              </div>

              <p className="text-sm text-[#64748B] mt-6 border-t border-[#E5E7EB] pt-6">
                {t("hero.disclaimer")}
              </p>
            </div>

            {/* Product preview card */}
            <div className="relative hidden lg:block">
              <div className="absolute -inset-1 bg-gradient-to-r from-[#1D4ED8]/20 to-[#22C55E]/20 rounded-3xl blur-xl" />

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
                          <div className="h-full bg-gradient-to-r from-[#1D4ED8] to-[#0EA5E9] rounded-full" style={{ width: "67%" }} />
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
      <section id="how-it-works" className="py-20">
        <div className="max-w-[1200px] mx-auto px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-[#0B1220] mb-4">{t("howItWorks.title")}</h2>
            <p className="text-xl text-[#64748B]">{t("howItWorks.subtitle")}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
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
      <section id="security" className="py-20 bg-[#F6F8FB]">
        <div className="max-w-[1200px] mx-auto px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-[#0B1220] mb-4">{t("security.title")}</h2>
            <p className="text-xl text-[#64748B]">{t("security.subtitle")}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
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
      <section id="pricing" className="py-20">
        <div className="max-w-[1200px] mx-auto px-8">
          <div className="text-center mb-6">
            <h2 className="text-4xl font-bold text-[#0B1220] mb-4">{t("pricing.title")}</h2>
            <p className="text-xl text-[#64748B] max-w-2xl mx-auto">{t("pricing.subtitle")}</p>
          </div>
          <p className="text-center text-sm text-[#94A3B8] mb-12">{t("pricing.trialInfo")}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
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

          {/* Top-ups */}
          <div className="bg-[#F6F8FB] rounded-xl p-8 border border-[#E5E7EB]">
            <h3 className="text-lg font-semibold text-[#0B1220] mb-2">{t("pricing.topUpsTitle")}</h3>
            <p className="text-sm text-[#64748B] mb-4">{t("pricing.topUpsDesc")}</p>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex items-center gap-3 bg-white rounded-lg px-5 py-3 border border-[#E5E7EB]">
                <span className="font-semibold text-[#0B1220]">{t("pricing.topUp25")}</span>
                <span className="text-[#64748B]">$19</span>
              </div>
              <div className="flex items-center gap-3 bg-white rounded-lg px-5 py-3 border border-[#E5E7EB]">
                <span className="font-semibold text-[#0B1220]">{t("pricing.topUp100")}</span>
                <span className="text-[#64748B]">$59</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#0B1220] text-white py-12">
        <div className="max-w-[1200px] mx-auto px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
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
                <li><a href="#product" className="hover:text-white transition-colors">{t("footer.features")}</a></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">{t("nav.pricing")}</a></li>
                <li><a href="#security" className="hover:text-white transition-colors">{t("nav.security")}</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4">{t("footer.company")}</h3>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">{t("footer.about")}</a></li>
                <li><a href="#" className="hover:text-white transition-colors">{t("footer.contact")}</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4">{t("footer.legal")}</h3>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">{t("footer.terms")}</a></li>
                <li><a href="#" className="hover:text-white transition-colors">{t("footer.privacy")}</a></li>
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
