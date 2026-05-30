"use client";

import { useEffect, useState } from "react";
import { X, Store } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    window.location.href = `/api/auth/shopify?shop=${encodeURIComponent(domain)}`;
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
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#0B1220]/70 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="relative w-full max-w-lg bg-white rounded-xl border border-[#E5E7EB] shadow-2xl p-6 sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
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
            <h3 id="demo-install-modal-title" className="text-lg font-semibold text-[#0B1220]">
              Install DisputeDesk
            </h3>
            <p className="text-sm text-[#64748B]">Enter your Shopify store to get started</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={shopInput}
            onChange={(e) => { setShopInput(e.target.value); setShopError(null); }}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="yourstore.myshopify.com"
            className="flex-1 px-4 py-2.5 rounded-lg border border-[#E5E7EB] bg-white text-sm text-[#0B1220] placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/40 focus:border-[#1D4ED8]"
            autoFocus
          />
          <Button variant="primary" onClick={handleSubmit}>
            Install
          </Button>
        </div>
        {shopError && <p className="text-sm text-[#EF4444] mt-2">{shopError}</p>}
        <p className="text-xs text-[#94A3B8] mt-3">You&apos;ll be redirected to Shopify to authorize the app. Free plan — no credit card required.</p>
      </div>
    </div>
  );
}
