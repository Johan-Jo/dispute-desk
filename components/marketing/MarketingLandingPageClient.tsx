"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Shield, ArrowRight, Check, Lock, FileText, BarChart3, Zap, RefreshCw, Info, Store, X, PlugZap, SearchCheck, ShieldCheck, Globe, CreditCard } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { MarketingSiteHeader } from "@/components/marketing/MarketingSiteHeader";
import { MarketingSiteFooter } from "@/components/marketing/MarketingSiteFooter";
import { HeroVideo } from "@/components/marketing/HeroVideo";
import { MARKETING_PAGE_CONTAINER_CLASS } from "@/lib/marketing/pageContainer";
import { trackStartShopifyInstallAndRedirect } from "@/lib/analytics/startShopifyInstall";

type RoiMode = "conservative" | "base" | "aggressive";

const ROI_DATA: Record<RoiMode, { segments: { segment: string; popular?: boolean; disputes: string; plan: string; value: string; price: string; roi: string }[] }> = {
  conservative: {
    segments: [
      { segment: "Serious SMB", disputes: "5\u201310", plan: "Starter (20 packs)", value: "$80\u2013$300", price: "$29", roi: "~3\u201310\u00d7" },
      { segment: "Ops-led SMB / Mid", popular: true, disputes: "15\u201360", plan: "Growth (100 packs)", value: "$500\u2013$2,500", price: "$129", roi: "~4\u201319\u00d7" },
      { segment: "High-volume / Agency", disputes: "75\u2013300", plan: "Scale (400 packs)", value: "$2,500\u2013$12,000", price: "$299", roi: "~8\u201340\u00d7" },
    ],
  },
  base: {
    segments: [
      { segment: "Serious SMB", disputes: "5\u201310", plan: "Starter (20 packs)", value: "$120\u2013$450", price: "$29", roi: "~4\u201315\u00d7" },
      { segment: "Ops-led SMB / Mid", popular: true, disputes: "15\u201360", plan: "Growth (100 packs)", value: "$800\u2013$4,000", price: "$129", roi: "~6\u201331\u00d7" },
      { segment: "High-volume / Agency", disputes: "75\u2013300", plan: "Scale (400 packs)", value: "$4,000\u2013$20,000+", price: "$299", roi: "~13\u201367\u00d7" },
    ],
  },
  aggressive: {
    segments: [
      { segment: "Serious SMB", disputes: "5\u201310", plan: "Starter (20 packs)", value: "$180\u2013$700", price: "$29", roi: "~6\u201324\u00d7" },
      { segment: "Ops-led SMB / Mid", popular: true, disputes: "15\u201360", plan: "Growth (100 packs)", value: "$1,200\u2013$6,000", price: "$129", roi: "~9\u201346\u00d7" },
      { segment: "High-volume / Agency", disputes: "75\u2013300", plan: "Scale (400 packs)", value: "$6,000\u2013$30,000+", price: "$299", roi: "~20\u2013100\u00d7" },
    ],
  },
};


// Render the hero headline with the final sentence italicized + gradient-clipped
// (e.g. "Win more chargebacks. Keep more revenue." → italic emphasis on the second sentence).
// Matches the editorial Hero DisputeDesk Brand.html mock without changing the source copy.
function renderHeroHeadline(headline: string): ReactNode {
  const trimmed = headline.trim().replace(/\.$/, "");
  const lastPeriod = trimmed.lastIndexOf(".");
  if (lastPeriod <= 0) {
    return <em>{trimmed}</em>;
  }
  const first = trimmed.slice(0, lastPeriod).trim();
  const second = trimmed.slice(lastPeriod + 1).trim();
  return (
    <>
      {first}
      <br />
      <em>{second}</em>
    </>
  );
}

function DossierCheck() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function normalizeShopDomain(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const domain = trimmed.endsWith(".myshopify.com")
    ? trimmed
    : `${trimmed}.myshopify.com`;
  const [subdomain] = domain.split(".");
  if (!/^[a-z0-9-]+$/.test(subdomain)) return null;
  return domain;
}

export function MarketingLandingPageClient({
  base = "",
  hubArticles,
}: {
  base?: string;
  hubArticles?: ReactNode;
}) {
  const t = useTranslations("marketing");
  const [roiMode, setRoiMode] = useState<RoiMode>("base");
  const [showInstall, setShowInstall] = useState(false);
  const [shopInput, setShopInput] = useState("");
  const [shopError, setShopError] = useState<string | null>(null);
  // The plan the visitor clicked (null = generic "Get Started" / Free). Carried
  // through OAuth so the callback deep-links to the in-app upgrade screen.
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  const closeInstall = () => {
    setShowInstall(false);
    setShopError(null);
  };

  const handlePricingCta = (plan?: string) => {
    // Always open the direct-install pop-up (shop domain → OAuth), bypassing
    // the Shopify App Store page. This also lets us carry the chosen plan
    // through install (see handleInstallSubmit).
    setSelectedPlan(plan ?? null);
    setShowInstall(true);
  };

  const handleInstallSubmit = () => {
    const domain = normalizeShopDomain(shopInput);
    if (!domain) {
      setShopError(t("pricing.shopError"));
      return;
    }
    const planQuery =
      selectedPlan && selectedPlan !== "free"
        ? `&plan=${encodeURIComponent(selectedPlan)}`
        : "";
    const redirectUrl = `/api/auth/shopify?shop=${encodeURIComponent(domain)}${planQuery}`;
    // Fire the start_shopify_install GA4/Google Ads conversion (install intent),
    // then redirect to Shopify OAuth. Redirect is guaranteed even if gtag is blocked.
    trackStartShopifyInstallAndRedirect(domain, redirectUrl);
  };

  useEffect(() => {
    if (!showInstall) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeInstall();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [showInstall]);

  return (
    <div className="min-h-screen bg-white">
      <MarketingSiteHeader />

      {/* Hero — editorial dossier layout from Hero DisputeDesk Brand.html */}
      <section
        className="dd-brand-hero relative pt-10 pb-12 sm:pt-14 sm:pb-20 lg:pt-16 lg:pb-24 overflow-hidden"
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

        <div className={`${MARKETING_PAGE_CONTAINER_CLASS} relative z-10`}>
          <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-10 sm:gap-12 lg:gap-16 items-start">
            <div className="pt-2">
              <span className="dd-eyebrow">
                <span className="dd-pill">{t("hero.tagline")}</span>
              </span>

              <h1 className="dd-headline">{renderHeroHeadline(t("hero.headline"))}</h1>

              <div className="dd-rule" />

              <p className="dd-lede">{t("hero.subheadline")}</p>

              <ul className="dd-checks">
                <li>
                  <span className="dd-marker">§</span>
                  <span>{t("hero.bullet1")}</span>
                </li>
                <li>
                  <span className="dd-marker">§</span>
                  <span>{t("hero.bullet2")}</span>
                </li>
                <li>
                  <span className="dd-marker">§</span>
                  <span>{t("hero.bullet3")}</span>
                </li>
              </ul>

              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-6">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => handlePricingCta()}
                  className="w-full sm:w-auto bg-white text-[#0B1220] hover:bg-slate-100 border-2 border-white shadow-xl shadow-black/25 focus:ring-white/60 [&_svg]:text-[#0B1220]"
                >
                  {t("hero.installFree")}
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
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

            </div>

            {/* Right: cream paper dossier graphic */}
            <div className="dd-dossier-wrap mt-8 lg:mt-0">
              <div className="dd-dossier">
                <div className="dd-dossier-head">
                  <span className="dd-vol">{t("hero.dossierLabel")} {"\u00B7"} DP-2402</span>
                  <span className="dd-hash">a4f2{"\u00B7"}9c3d{"\u00B7"}b201</span>
                </div>

                <h2 className="dd-dossier-title">
                  {t("hero.dossierTitlePrefix")}<br />{t("hero.dossierTitleFiledUnder")} <em>Visa 10.4</em>
                </h2>
                <div className="dd-dossier-meta">
                  <span>USD 890.50</span>
                  <span>{t("hero.dossierSealedAt")}</span>
                </div>

                <div className="dd-dossier-row">
                  <span className="dd-mark"><DossierCheck /></span>
                  <span className="dd-name">{t("hero.orderConfirmation")}</span>
                  <span className="dd-src">{t("hero.srcShopify")}</span>
                </div>
                <div className="dd-dossier-row">
                  <span className="dd-mark"><DossierCheck /></span>
                  <span className="dd-name">{t("hero.rowPaymentAuth")}</span>
                  <span className="dd-src">{t("hero.srcAvsCvv")}</span>
                </div>
                <div className="dd-dossier-row">
                  <span className="dd-mark"><DossierCheck /></span>
                  <span className="dd-name">{t("hero.rowPurchaseHistory")}</span>
                  <span className="dd-src">{t("hero.srcPriorsCount", { count: 6 })}</span>
                </div>
                <div className="dd-dossier-row">
                  <span className="dd-mark"><DossierCheck /></span>
                  <span className="dd-name">{t("hero.shippingTracking")}</span>
                  <span className="dd-src">{t("hero.srcCarrier")}</span>
                </div>
                <div className="dd-dossier-row dd-missing">
                  <span className="dd-mark">{"\u00B7"}</span>
                  <span className="dd-name">{t("hero.customerComm")}</span>
                  <span className="dd-src">{t("hero.srcOptional")}</span>
                </div>

                <div className="dd-dossier-foot">
                  <span className="dd-complete">
                    <span className="dd-num">80%</span>{" \u00B7 "}{t("hero.dossierFields", { filled: 4, total: 5 })}
                  </span>
                  <span className="dd-stamp">
                    <DossierCheck />
                    {t("hero.dossierStamp")}
                  </span>
                </div>
              </div>

              <div className="dd-wax" aria-hidden>
                <div className="dd-wax-inner">
                  {t("hero.waxFiled")}
                  <small>DD {"\u00B7"} 5{"\u00B7"}17</small>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-12 sm:py-16 lg:py-20">
        <div className={MARKETING_PAGE_CONTAINER_CLASS}>
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

      {/* Product demo video — lazy YouTube facade below How It Works */}
      <HeroVideo />

      {/* Security */}
      <section id="security" className="py-12 sm:py-16 lg:py-20 bg-[#F6F8FB]">
        <div className={MARKETING_PAGE_CONTAINER_CLASS}>
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
        <div className={MARKETING_PAGE_CONTAINER_CLASS}>
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
              <Button variant="secondary" className="w-full" onClick={() => handlePricingCta("free")}>{t("pricing.getStarted")}</Button>
            </div>

            {/* Starter */}
            <div className="bg-white rounded-xl p-6 border border-[#E5E7EB]">
              <h3 className="text-lg font-semibold text-[#0B1220] mb-1">{t("pricing.starterName")}</h3>
              <div className="mb-5"><span className="text-3xl font-bold text-[#0B1220]">$29</span><span className="text-[#64748B] text-sm">/mo</span></div>
              <p className="text-xs text-[#0B1220] bg-[#F1F5F9] rounded-md px-3 py-2 mb-5 leading-snug">{t("pricing.starterRoi")}</p>
              <ul className="space-y-2.5 mb-6">
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.starterF1")}</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.starterF2")}</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.starterF3")}</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.starterF4")}</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.starterF5")}</li>
              </ul>
              <Button variant="secondary" className="w-full" onClick={() => handlePricingCta("starter")}>{t("pricing.startTrial")}</Button>
            </div>

            {/* Growth */}
            <div className="bg-[#1D4ED8] rounded-xl p-6 text-white relative">
              <div className="absolute top-3 right-3 bg-white text-[#1D4ED8] text-xs font-semibold px-2 py-0.5 rounded">{t("pricing.popular")}</div>
              <h3 className="text-lg font-semibold mb-1">{t("pricing.growthName")}</h3>
              <div className="mb-5"><span className="text-3xl font-bold">$129</span><span className="opacity-80 text-sm">/mo</span></div>
              <p className="text-xs text-white bg-white/15 rounded-md px-3 py-2 mb-5 leading-snug">{t("pricing.growthRoi")}</p>
              <ul className="space-y-2.5 mb-6">
                <li className="flex items-start gap-2 text-sm"><Check className="w-4 h-4 flex-shrink-0 mt-0.5" />{t("pricing.growthF1")}</li>
                <li className="flex items-start gap-2 text-sm"><Check className="w-4 h-4 flex-shrink-0 mt-0.5" />{t("pricing.growthF2")}</li>
                <li className="flex items-start gap-2 text-sm"><Check className="w-4 h-4 flex-shrink-0 mt-0.5" />{t("pricing.growthF3")}</li>
                <li className="flex items-start gap-2 text-sm"><Check className="w-4 h-4 flex-shrink-0 mt-0.5" />{t("pricing.growthF4")}</li>
                <li className="flex items-start gap-2 text-sm"><Check className="w-4 h-4 flex-shrink-0 mt-0.5" />{t("pricing.growthF5")}</li>
              </ul>
              <Button variant="secondary" className="w-full bg-white text-[#1D4ED8] hover:bg-[#F6F8FB]" onClick={() => handlePricingCta("growth")}>{t("pricing.startTrial")}</Button>
            </div>

            {/* Scale */}
            <div className="bg-white rounded-xl p-6 border border-[#E5E7EB]">
              <h3 className="text-lg font-semibold text-[#0B1220] mb-1">{t("pricing.scaleName")}</h3>
              <div className="mb-5"><span className="text-3xl font-bold text-[#0B1220]">$299</span><span className="text-[#64748B] text-sm">/mo</span></div>
              <p className="text-xs text-[#0B1220] bg-[#F1F5F9] rounded-md px-3 py-2 mb-5 leading-snug">{t("pricing.scaleRoi")}</p>
              <ul className="space-y-2.5 mb-6">
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.scaleF1")}</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.scaleF2")}</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.scaleF3")}</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />{t("pricing.scaleF4")}</li>
              </ul>
              <Button variant="secondary" className="w-full" onClick={() => handlePricingCta("scale")}>{t("pricing.startTrial")}</Button>
            </div>
          </div>

          <p className="text-center text-xs text-[#94A3B8] max-w-3xl mx-auto leading-relaxed">{t("pricing.roiFootnote")}</p>

        </div>
      </section>

      {/* Latest from the Resources Hub */}
      {hubArticles}

      {/* ROI Snapshot */}
      <section className="py-12 sm:py-16 lg:py-20 bg-white">
        <div className={MARKETING_PAGE_CONTAINER_CLASS}>
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

            {/* Mobile: stacked cards (one per segment) */}
            <div className="sm:hidden border-t border-[#E5E7EB]">
              {ROI_DATA[roiMode].segments.map((row, i) => (
                <div key={i} className="px-5 py-4 border-b border-[#E5E7EB] last:border-b-0">
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <span className="font-semibold text-sm text-[#0B1220]">{row.segment}</span>
                    {row.popular && (
                      <span className="text-[10px] font-medium text-[#1D4ED8] bg-[#EFF6FF] border border-[#BFDBFE] px-2 py-0.5 rounded-full whitespace-nowrap">
                        {t("roi.mostPopular")}
                      </span>
                    )}
                  </div>
                  <dl className="grid grid-cols-2 gap-y-2 gap-x-3 text-sm">
                    <dt className="text-[#64748B] text-xs uppercase tracking-wider">{t("roi.colValue")}</dt>
                    <dd className="text-right font-medium text-[#0B1220]">{row.value}</dd>
                    <dt className="text-[#64748B] text-xs uppercase tracking-wider">{t("roi.colPrice")}</dt>
                    <dd className="text-right font-semibold text-[#0B1220]">{row.price}</dd>
                    <dt className="text-[#64748B] text-xs uppercase tracking-wider">{t("roi.colRoi")}</dt>
                    <dd className="text-right font-semibold text-[#22C55E]">{row.roi}</dd>
                  </dl>
                </div>
              ))}
            </div>

            {/* Tablet+ : full table */}
            <div className="hidden sm:block overflow-x-auto">
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

      <MarketingSiteFooter base={base} />

      {/* Install modal — opens when pricing/hero CTA is clicked (pre-App Store listing) */}
      {showInstall && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="install-modal-title"
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#0F172A]/[0.58] backdrop-blur-[3px]"
          onClick={closeInstall}
        >
          <div
            className="relative w-full max-w-[560px] bg-white rounded-2xl shadow-[0_28px_70px_rgba(15,23,42,0.32)] px-8 sm:px-10 pt-8 pb-7"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeInstall}
              aria-label="Close"
              className="absolute top-[18px] right-[18px] w-[30px] h-[30px] rounded-lg flex items-center justify-center text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F6F8FB] transition-colors"
            >
              <X className="w-[18px] h-[18px]" />
            </button>

            {/* Header */}
            <div className="flex items-center gap-[13px]">
              <div className="w-[46px] h-[46px] flex-none rounded-xl bg-gradient-to-b from-[#3B82F6] to-[#1F6FEB] shadow-[0_4px_12px_rgba(31,111,235,0.35),inset_0_1px_0_rgba(255,255,255,0.4)] flex items-center justify-center text-white">
                <Store className="w-6 h-6" />
              </div>
              <div>
                <h3
                  id="install-modal-title"
                  className="text-[23px] font-bold text-[#0F172A] tracking-[-0.02em] leading-tight"
                >
                  {t("pricing.installTitle")}
                </h3>
                <p className="text-[13.5px] text-[#5B6472] mt-0.5">{t("pricing.installSubtitle")}</p>
              </div>
            </div>

            {/* Steps */}
            <div className="flex items-start justify-between gap-2 my-6 px-5 py-4 bg-[#F6F9FD] border border-[#EAF0F8] rounded-xl">
              <div className="flex-1 flex flex-col items-center gap-2 text-center">
                <div className="w-10 h-10 rounded-[10px] bg-[#E7F0FE] text-[#1F6FEB] flex items-center justify-center">
                  <PlugZap className="w-[18px] h-[18px]" />
                </div>
                <span className="text-[12.5px] font-semibold text-[#1F2937] leading-[1.35]">{t("pricing.installStepConnect")}</span>
              </div>
              <ArrowRight className="w-4 h-4 text-[#C2CCD9] mt-3 flex-none" strokeWidth={2.5} />
              <div className="flex-1 flex flex-col items-center gap-2 text-center">
                <div className="w-10 h-10 rounded-[10px] bg-[#E3F7EF] text-[#0A8A5B] flex items-center justify-center">
                  <SearchCheck className="w-[18px] h-[18px]" />
                </div>
                <span className="text-[12.5px] font-semibold text-[#1F2937] leading-[1.35]">{t("pricing.installStepAnalysis")}</span>
              </div>
              <ArrowRight className="w-4 h-4 text-[#C2CCD9] mt-3 flex-none" strokeWidth={2.5} />
              <div className="flex-1 flex flex-col items-center gap-2 text-center">
                <div className="w-10 h-10 rounded-[10px] bg-[#E7F0FE] text-[#1F6FEB] flex items-center justify-center">
                  <ShieldCheck className="w-[18px] h-[18px]" />
                </div>
                <span className="text-[12.5px] font-semibold text-[#1F2937] leading-[1.35]">{t("pricing.installStepProtected")}</span>
              </div>
            </div>

            {/* Input + Install */}
            <div className="flex items-stretch gap-2.5">
              <div className="flex-1 flex items-center h-12 box-border border-[1.5px] border-[#1F6FEB] rounded-[10px] px-3.5 bg-white shadow-[0_0_0_3px_rgba(31,111,235,0.14)] focus-within:shadow-[0_0_0_3px_rgba(31,111,235,0.24)]">
                <Globe className="w-[15px] h-[15px] text-[#6B7480] mr-[9px] flex-none" />
                <input
                  type="text"
                  value={shopInput}
                  onChange={(e) => { setShopInput(e.target.value); setShopError(null); }}
                  onKeyDown={(e) => e.key === "Enter" && handleInstallSubmit()}
                  placeholder={t("pricing.shopPlaceholder")}
                  className="flex-1 min-w-0 bg-transparent border-none outline-none text-[14.5px] text-[#0F172A] placeholder-[#7A8493]"
                  autoFocus
                />
              </div>
              <button
                type="button"
                onClick={handleInstallSubmit}
                className="flex-none h-12 box-border px-6 rounded-[10px] bg-gradient-to-b from-[#3B82F6] to-[#1F6FEB] shadow-[0_4px_12px_rgba(31,111,235,0.32),inset_0_1px_0_rgba(255,255,255,0.35)] text-white text-[15px] font-semibold cursor-pointer hover:brightness-105 transition"
              >
                {t("pricing.installButton")}
              </button>
            </div>
            {shopError && <p className="text-[12.5px] text-[#EF4444] mt-2">{shopError}</p>}

            {/* Reassurance */}
            <div className="flex items-start gap-2 mt-[13px] text-[12.5px] text-[#5B6472] leading-[1.45]">
              <Lock className="w-3.5 h-3.5 text-[#0A8A5B] mt-px flex-none" />
              <span>{t("pricing.installReassure")}</span>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-4 mt-4 pt-4 border-t border-[#EEF0F4]">
              <div className="flex items-center gap-[7px] text-[12.5px] text-[#5B6472]">
                <CreditCard className="w-[15px] h-[15px] text-[#1F6FEB]" />
                {t("pricing.installTrialNote")}
              </div>
              <div className="flex-1" />
              <div className="flex items-center gap-[7px] text-[12.5px] font-medium text-[#0B1220] bg-[#D9ECFB] px-3 py-1.5 rounded-full">
                <svg viewBox="0 0 120 120" width="16" height="16" className="block flex-none">
                  <polygon points="20,46 60,14 100,46" fill="#1f7cae" />
                  <polygon points="40,46 60,14 80,46" fill="#9ad4f1" />
                  <polygon points="47,46 60,25 73,46" fill="#cbe9fb" />
                  <polygon points="20,46 100,46 60,108" fill="#15598c" />
                  <polygon points="20,46 60,46 60,108" fill="#0e4a72" />
                  <polygon points="47,46 73,46 60,108" fill="#114f7c" />
                </svg>
                {t("pricing.installBadge")}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
