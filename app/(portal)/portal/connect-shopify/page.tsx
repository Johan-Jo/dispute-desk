"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { AuthCard } from "@/components/ui/auth-card";
import { OAuthButton } from "@/components/ui/oauth-button";

export default function ConnectShopifyPage() {
  const [shopDomain, setShopDomain] = useState("");

  const handleConnect = () => {
    if (!shopDomain) return;
    const domain = shopDomain.includes(".myshopify.com")
      ? shopDomain
      : `${shopDomain}.myshopify.com`;
    window.location.href =
      `/api/auth/shopify?shop=${encodeURIComponent(domain)}` +
      `&source=portal&return_to=${encodeURIComponent("/portal/select-store")}`;
  };

  return (
    <div className="max-w-md mx-auto py-8">
      <h2 className="text-2xl font-bold text-[#0B1220] mb-2">
        Connect your Shopify store
      </h2>
      <p className="text-sm text-[#667085] mb-6">
        Sync disputes and orders to start managing evidence
      </p>

      <div className="bg-[#EFF6FF] border border-[#C7D2FE] rounded-lg p-4 mb-6">
        <h4 className="font-semibold text-[#0B1220] mb-2">
          What we&apos;ll access:
        </h4>
        <ul className="space-y-2 text-sm text-[#667085]">
          <li className="flex items-start gap-2">
            <ArrowRight className="w-4 h-4 text-[#4F46E5] flex-shrink-0 mt-0.5" />
            Read disputes and orders (read-only)
          </li>
          <li className="flex items-start gap-2">
            <ArrowRight className="w-4 h-4 text-[#4F46E5] flex-shrink-0 mt-0.5" />
            View tracking and fulfillment data
          </li>
          <li className="flex items-start gap-2">
            <ArrowRight className="w-4 h-4 text-[#4F46E5] flex-shrink-0 mt-0.5" />
            Access customer email (for evidence)
          </li>
        </ul>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[#0B1220] mb-2">
            Store domain
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="my-store"
              value={shopDomain}
              onChange={(e) => setShopDomain(e.target.value)}
              className="flex-1 h-10 px-3 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
            />
            <span className="text-sm text-[#64748B]">.myshopify.com</span>
          </div>
        </div>

        <OAuthButton provider="shopify" onClick={handleConnect} disabled={!shopDomain}>
          Connect Shopify Store
        </OAuthButton>
      </div>

      <p className="text-xs text-[#667085] text-center mt-4">
        Your store data is encrypted and never shared with third parties.
      </p>
    </div>
  );
}
