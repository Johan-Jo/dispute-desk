"use client";

import { useState, useEffect, useCallback } from "react";
import { CheckCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface PlanInfo {
  id: string;
  name: string;
  price: number;
  packsPerMonth: number | null;
  autoPack: boolean;
  rules: boolean;
}

interface UsageInfo {
  packsUsed: number;
  packsLimit: number | null;
  packsRemaining: number | null;
}

const ALL_PLANS = [
  {
    id: "free",
    name: "Free",
    price: 0,
    features: ["3 packs/month", "Manual generation only", "PDF export", "Save to Shopify"],
  },
  {
    id: "starter",
    name: "Starter",
    price: 29,
    features: ["50 packs/month", "Auto-pack on sync", "Custom rules", "PDF export", "Save to Shopify"],
  },
  {
    id: "pro",
    name: "Pro",
    price: 79,
    features: ["Unlimited packs", "Auto-pack on sync", "Custom rules", "PDF export", "Save to Shopify", "Priority support"],
  },
];

export default function BillingPage() {
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);

  const shopId = typeof window !== "undefined"
    ? document.cookie.match(/active_shop_id=([^;]+)/)?.[1] ?? ""
    : "";

  const fetchUsage = useCallback(async () => {
    if (!shopId) return;
    setLoading(true);
    const res = await fetch(`/api/billing/usage?shop_id=${shopId}`);
    const data = await res.json();
    setPlan(data.plan);
    setUsage(data.usage);
    setLoading(false);
  }, [shopId]);

  useEffect(() => { fetchUsage(); }, [fetchUsage]);

  const handleUpgrade = async (planId: string) => {
    setUpgrading(planId);
    const res = await fetch("/api/billing/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: shopId, plan_id: planId }),
    });
    const data = await res.json();
    if (data.confirmationUrl) {
      window.location.href = data.confirmationUrl;
    }
    setUpgrading(null);
  };

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-[#0B1220] mb-6">Billing</h1>
        <div className="text-center py-12 text-[#667085]">Loading billing info...</div>
      </div>
    );
  }

  const usagePercent =
    usage?.packsLimit ? Math.min(100, Math.round((usage.packsUsed / usage.packsLimit) * 100)) : 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#0B1220]">Billing</h1>
        <p className="text-sm text-[#667085]">Manage your plan and usage</p>
      </div>

      {/* Usage Meter */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 mb-6">
        <h3 className="font-semibold text-[#0B1220] mb-3">Usage This Month</h3>
        {usage?.packsLimit != null ? (
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-[#667085]">{usage.packsUsed} of {usage.packsLimit} packs used</span>
              <span className="font-medium text-[#0B1220]">{usage.packsRemaining} remaining</span>
            </div>
            <div className="w-full bg-[#E5E7EB] rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${usagePercent >= 90 ? "bg-[#EF4444]" : usagePercent >= 70 ? "bg-[#F59E0B]" : "bg-[#1D4ED8]"}`}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-[#667085]">Unlimited packs — no limit on your Pro plan.</p>
        )}
      </div>

      {/* Plans Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {ALL_PLANS.map((p) => {
          const isCurrent = plan?.id === p.id;
          const isUpgrade = p.price > (plan?.price ?? 0);
          return (
            <div
              key={p.id}
              className={`bg-white rounded-lg border p-5 ${isCurrent ? "border-[#1D4ED8] ring-1 ring-[#1D4ED8]" : "border-[#E5E7EB]"}`}
            >
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-[#0B1220]">{p.name}</h4>
                {isCurrent && <Badge variant="success">Current</Badge>}
              </div>
              <p className="text-2xl font-bold text-[#0B1220] mb-4">
                {p.price === 0 ? "Free" : `$${p.price}/mo`}
              </p>
              <ul className="space-y-2 mb-4">
                {p.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-[#667085]">
                    <CheckCircle className="w-4 h-4 text-[#22C55E] shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              {isCurrent ? (
                <div className="text-center text-sm text-[#667085] py-2">Your current plan</div>
              ) : isUpgrade ? (
                <Button
                  variant="primary"
                  className="w-full"
                  disabled={upgrading === p.id}
                  onClick={() => handleUpgrade(p.id)}
                >
                  {upgrading === p.id ? "Redirecting..." : `Upgrade to ${p.name}`}
                </Button>
              ) : (
                <div className="text-center text-xs text-[#94A3B8] py-2">
                  Contact support to downgrade
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-[#94A3B8] mt-4">
        All paid plans include a 7-day free trial. Downgrades take effect at the next billing cycle.
        Your data is always retained.
      </p>
    </div>
  );
}
