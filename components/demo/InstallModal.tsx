"use client";

import { useEffect, useState } from "react";
import {
  X,
  Store,
  PlugZap,
  SearchCheck,
  ShieldCheck,
  ArrowRight,
  Globe,
  Lock,
  CreditCard,
} from "lucide-react";
import { trackDemoInstallClickAndRedirect } from "@/lib/analytics/demoInstallClick";

/**
 * Demo install modal — mirrors the marketing hero install popup
 * (components/marketing/MarketingLandingPageClient.tsx). The merchant
 * types their Shopify store handle, we redirect to /api/auth/shopify
 * which starts the OAuth flow and drops them straight into the
 * Shopify Admin authorize screen for DisputeDesk.
 *
 * Plain English (not i18n) because the demo route is English-only.
 * Logic mirrors normalizeShopDomain + handleInstallSubmit from the
 * marketing client so behaviour stays in lockstep.
 */

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

interface InstallModalProps {
  open: boolean;
  onClose: () => void;
}

export function InstallModal({ open, onClose }: InstallModalProps) {
  const [shopInput, setShopInput] = useState("");
  const [shopError, setShopError] = useState<string | null>(null);

  const close = () => {
    onClose();
    setShopError(null);
  };

  const handleSubmit = () => {
    const domain = normalizeShopDomain(shopInput);
    if (!domain) {
      setShopError("Enter a valid store name, e.g. yourstore or yourstore.myshopify.com");
      return;
    }
    // Fire a demo-only GA4 event (NOT the `start_shopify_install` Google Ads
    // conversion) so demo install clicks never inflate paid-ads conversions,
    // then redirect. This tracks the App Store "Live demo" → install midpoint
    // as plain analytics; mark `demo_install_click` as a conversion in GA4 only
    // if you want it, and never import it into Google Ads.
    trackDemoInstallClickAndRedirect(
      domain,
      `/api/auth/shopify?shop=${encodeURIComponent(domain)}`,
    );
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="demo-install-modal-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#0F172A]/[0.58] backdrop-blur-[3px]"
      onClick={close}
    >
      <div
        className="relative w-full max-w-[452px] bg-white rounded-2xl shadow-[0_28px_70px_rgba(15,23,42,0.32)] px-[30px] pt-[30px] pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
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
              id="demo-install-modal-title"
              className="text-[23px] font-bold text-[#0F172A] tracking-[-0.02em] leading-tight"
            >
              Install DisputeDesk
            </h3>
            <p className="text-[13.5px] text-[#5B6472] mt-0.5">
              See where you&apos;re losing money to chargebacks — free.
            </p>
          </div>
        </div>

        {/* Steps */}
        <div className="flex items-start justify-between my-5 px-2.5 py-4 bg-[#F6F9FD] border border-[#EAF0F8] rounded-xl">
          <div className="flex-1 flex flex-col items-center gap-2 text-center">
            <div className="w-9 h-9 rounded-[10px] bg-[#E7F0FE] text-[#1F6FEB] flex items-center justify-center">
              <PlugZap className="w-[18px] h-[18px]" />
            </div>
            <span className="text-xs font-semibold text-[#1F2937] leading-[1.35]">
              Connect
              <br />
              your store
            </span>
          </div>
          <ArrowRight className="w-[15px] h-[15px] text-[#C2CCD9] mt-[11px]" strokeWidth={2.5} />
          <div className="flex-1 flex flex-col items-center gap-2 text-center">
            <div className="w-9 h-9 rounded-[10px] bg-[#E3F7EF] text-[#0A8A5B] flex items-center justify-center">
              <SearchCheck className="w-[18px] h-[18px]" />
            </div>
            <span className="text-xs font-semibold text-[#1F2937] leading-[1.35]">
              Free analysis
              <br />
              in ~15 min
            </span>
          </div>
          <ArrowRight className="w-[15px] h-[15px] text-[#C2CCD9] mt-[11px]" strokeWidth={2.5} />
          <div className="flex-1 flex flex-col items-center gap-2 text-center">
            <div className="w-9 h-9 rounded-[10px] bg-[#E7F0FE] text-[#1F6FEB] flex items-center justify-center">
              <ShieldCheck className="w-[18px] h-[18px]" />
            </div>
            <span className="text-xs font-semibold text-[#1F2937] leading-[1.35]">
              Protected +
              <br />
              revenue back
            </span>
          </div>
        </div>

        {/* Input + Install */}
        <div className="flex items-stretch gap-2.5">
          <div className="flex-1 flex items-center h-12 box-border border-[1.5px] border-[#1F6FEB] rounded-[10px] px-3.5 bg-white shadow-[0_0_0_3px_rgba(31,111,235,0.14)] focus-within:shadow-[0_0_0_3px_rgba(31,111,235,0.24)]">
            <Globe className="w-[15px] h-[15px] text-[#6B7480] mr-[9px] flex-none" />
            <input
              type="text"
              value={shopInput}
              onChange={(e) => {
                setShopInput(e.target.value);
                setShopError(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="yourstore.myshopify.com"
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-[14.5px] text-[#0F172A] placeholder-[#7A8493]"
              autoFocus
            />
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            className="flex-none h-12 box-border px-6 rounded-[10px] bg-gradient-to-b from-[#3B82F6] to-[#1F6FEB] shadow-[0_4px_12px_rgba(31,111,235,0.32),inset_0_1px_0_rgba(255,255,255,0.35)] text-white text-[15px] font-semibold cursor-pointer hover:brightness-105 transition"
          >
            Install
          </button>
        </div>
        {shopError && <p className="text-[12.5px] text-[#EF4444] mt-2">{shopError}</p>}

        {/* Reassurance */}
        <div className="flex items-start gap-2 mt-[13px] text-[12.5px] text-[#5B6472] leading-[1.45]">
          <Lock className="w-3.5 h-3.5 text-[#0A8A5B] mt-px flex-none" />
          <span>You&apos;ll be redirected to Shopify to approve access.</span>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 mt-4 pt-4 border-t border-[#EEF0F4]">
          <div className="flex items-center gap-[7px] text-[12.5px] text-[#5B6472]">
            <CreditCard className="w-[15px] h-[15px] text-[#1F6FEB]" />
            14-day free trial · no card
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
            Built for Shopify
          </div>
        </div>
      </div>
    </div>
  );
}
