"use client";

import { useState } from "react";
import { ChevronDown, Search, Bell } from "lucide-react";
import { InstallCTA } from "./InstallCTA";

export function DemoTopBar() {
  const [storeMenuOpen, setStoreMenuOpen] = useState(false);

  return (
    <div className="h-14 bg-[#1A1A1A] text-white flex items-center px-4 gap-4 border-b border-[#0B0B0B]">
      {/* Left: Shopify wordmark + store switcher + demo tag */}
      <div className="flex items-center gap-3">
        <span className="font-semibold text-[15px] tracking-tight">Shopify</span>
        <button
          type="button"
          onClick={() => setStoreMenuOpen((v) => !v)}
          className="flex items-center gap-1.5 text-sm text-[#E5E7EB] hover:text-white px-2 py-1 rounded hover:bg-[#2A2A2A] transition-colors"
        >
          <span>Demo store</span>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
        <span className="text-[10px] uppercase tracking-wider bg-[#FBBF24]/20 text-[#FBBF24] px-2 py-0.5 rounded font-semibold">
          Demo · not Shopify
        </span>
        {storeMenuOpen && (
          <div className="absolute top-12 left-32 z-50 bg-white text-[#0B1220] rounded-lg shadow-lg w-72 py-2">
            <div className="px-3 py-2 text-xs text-[#6B7280] uppercase tracking-wider">Demo</div>
            <div className="px-3 py-2 text-sm font-medium">Demo store</div>
            <div className="border-t border-[#E5E7EB] mt-1 pt-2 px-3 pb-2">
              <a
                href={process.env.NEXT_PUBLIC_SHOPIFY_APP_STORE_URL?.trim() || "https://disputedesk.app/install"}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[#1D4ED8] hover:underline"
              >
                Connect your store →
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Center: search */}
      <div className="flex-1 max-w-2xl mx-auto">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
          <input
            type="text"
            placeholder="Search orders, products, customers…"
            readOnly
            className="w-full bg-[#2A2A2A] text-white text-sm pl-9 pr-3 py-1.5 rounded-md border border-transparent focus:border-[#3B82F6] focus:outline-none placeholder:text-[#9CA3AF]"
          />
        </div>
      </div>

      {/* Right: notifications + install CTA */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Notifications"
          className="p-1.5 rounded hover:bg-[#2A2A2A] text-[#E5E7EB] hover:text-white transition-colors"
        >
          <Bell className="w-4 h-4" />
        </button>
        <InstallCTA variant="topbar" />
      </div>
    </div>
  );
}
