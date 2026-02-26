"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle, CreditCard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDemoMode } from "@/lib/demo-mode";
import { PLANS, type PlanId } from "@/lib/billing/plans";

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

const DEMO_PLAN_IDS: PlanId[] = ["free", "starter", "growth", "scale"];
const DEMO_CURRENT_PLAN: PlanId = "starter";

const DEMO_INVOICES = [
  { id: "INV-001", date: "Feb 1, 2026", amount: "$29.00", status: "Paid" },
  { id: "INV-002", date: "Jan 1, 2026", amount: "$29.00", status: "Paid" },
  { id: "INV-003", date: "Dec 1, 2025", amount: "$29.00", status: "Paid" },
];

const TOP_UPS = [
  { sku: "topup_25", label: "+25 packs", price: "$19" },
  { sku: "topup_100", label: "+100 packs", price: "$59" },
];

function UsageMeter({ label, used, limit, unit }: { label: string; used: number; limit: number | string; unit: string }) {
  const numericLimit = typeof limit === "number" ? limit : 0;
  const percent = numericLimit > 0 ? Math.min(100, Math.round((used / numericLimit) * 100)) : 0;
  return (
    <div className="flex-1">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-[#667085]">{label}</span>
        <span className="font-medium text-[#0B1220]">{used.toLocaleString()} / {typeof limit === "number" ? limit.toLocaleString() : limit} {unit}</span>
      </div>
      <div className="w-full bg-[#E5E7EB] rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all ${percent >= 90 ? "bg-[#EF4444]" : percent >= 70 ? "bg-[#F59E0B]" : "bg-[#1D4ED8]"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function DemoBilling() {
  const t = useTranslations("billing");
  const tt = useTranslations("table");
  const tc = useTranslations("common");
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#0B1220]">{t("title")}</h1>
        <p className="text-sm text-[#667085]">{t("demoSubtitle")}</p>
      </div>

      {/* Current plan */}
      <div className="bg-white rounded-lg border border-[#1D4ED8] ring-1 ring-[#1D4ED8] p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-[#0B1220]">{PLANS[DEMO_CURRENT_PLAN].name}</h3>
              <Badge variant="success">{t("currentPlan")}</Badge>
            </div>
            <p className="text-sm text-[#667085]">{t("currentPlanDesc")}</p>
          </div>
          <Button variant="secondary" size="sm" title={tc("demoOnly")}>{t("manageSubscription")}</Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <UsageMeter label={t("evidencePacks")} used={5} limit={PLANS[DEMO_CURRENT_PLAN].packsPerMonth} unit={t("packsUnit")} />
        </div>
      </div>

      {/* Plan comparison */}
      <h3 className="font-semibold text-[#0B1220] mb-4">{t("plans")}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {DEMO_PLAN_IDS.map((planId) => {
          const plan = PLANS[planId];
          const isCurrent = planId === DEMO_CURRENT_PLAN;
          const isUpgrade = plan.price > PLANS[DEMO_CURRENT_PLAN].price;
          const label = plan.price === 0 ? "$0" : `$${plan.price}/mo`;
          return (
            <div
              key={planId}
              className={`bg-white rounded-lg border p-5 ${isCurrent ? "border-[#1D4ED8] ring-1 ring-[#1D4ED8]" : "border-[#E5E7EB]"}`}
            >
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-[#0B1220]">{plan.name}</h4>
                {isCurrent && <Badge variant="success">{t("currentPlan")}</Badge>}
              </div>
              <p className="text-2xl font-bold text-[#0B1220] mb-4">{label}</p>
              <ul className="space-y-2 mb-6">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-[#667085]">
                    <CheckCircle className="w-4 h-4 text-[#22C55E] flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              {isCurrent ? (
                <div className="text-center text-sm text-[#667085] py-2">{t("yourCurrentPlan")}</div>
              ) : isUpgrade ? (
                <Button variant="primary" className="w-full" title={tc("demoOnly")}>
                  {t("upgradeTo", { plan: plan.name })}
                </Button>
              ) : (
                <div className="text-center text-xs text-[#94A3B8] py-2">{t("contactToDowngrade")}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Payment Method */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-[#0B1220]">{t("paymentMethod")}</h3>
          <Button variant="ghost" size="sm" title={tc("demoOnly")}>{t("update")}</Button>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-12 h-8 bg-[#1E3A5F] rounded flex items-center justify-center">
            <CreditCard className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-medium text-[#0B1220]">{t("visaEnding", { last4: "4242" })}</p>
            <p className="text-xs text-[#667085]">{t("expires", { date: "12/2027" })}</p>
          </div>
        </div>
      </div>

      {/* Recent Invoices */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E5E7EB]">
          <h3 className="font-semibold text-[#0B1220]">{t("recentInvoices")}</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-[#F7F8FA]">
            <tr>
              <th className="text-left px-6 py-3 text-xs font-medium text-[#667085]">{tt("invoice")}</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-[#667085]">{tt("date")}</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-[#667085]">{tt("amount")}</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-[#667085]">{tt("status")}</th>
              <th className="text-right px-6 py-3 text-xs font-medium text-[#667085]">{tt("actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {DEMO_INVOICES.map((inv) => (
              <tr key={inv.id} className="hover:bg-[#F7F8FA] transition-colors">
                <td className="px-6 py-3 font-medium text-[#0B1220]">{inv.id}</td>
                <td className="px-6 py-3 text-[#667085]">{inv.date}</td>
                <td className="px-6 py-3 text-[#0B1220]">{inv.amount}</td>
                <td className="px-6 py-3"><Badge variant="success">{t("paid")}</Badge></td>
                <td className="px-6 py-3 text-right">
                  <Button variant="ghost" size="sm" title={tc("demoOnly")}>{t("download")}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function BillingPage() {
  const t = useTranslations("billing");
  const tt = useTranslations("table");
  const tc = useTranslations("common");
  const isDemo = useDemoMode();
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);

  const shopId = typeof window !== "undefined"
    ? (document.cookie.match(/dd_active_shop=([^;]+)/)?.[1] ?? document.cookie.match(/active_shop_id=([^;]+)/)?.[1] ?? "")
    : "";

  const fetchUsage = useCallback(async () => {
    if (isDemo || !shopId) { setLoading(false); return; }
    setLoading(true);
    const res = await fetch(`/api/billing/usage?shop_id=${shopId}`);
    const data = await res.json();
    setPlan(data.plan);
    setUsage(data.usage);
    setLoading(false);
  }, [shopId, isDemo]);

  useEffect(() => { fetchUsage(); }, [fetchUsage]);

  if (isDemo) return <DemoBilling />;

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

  if (loading || !shopId) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-[#0B1220] mb-6">{t("title")}</h1>
        <div className="text-center py-12 text-[#667085]">{!shopId ? t("connectStore") : tc("loading")}</div>
      </div>
    );
  }

  const usagePercent =
    usage?.packsLimit ? Math.min(100, Math.round((usage.packsUsed / usage.packsLimit) * 100)) : 0;

  const REAL_PLANS = DEMO_PLAN_IDS.map((id) => {
    const p = PLANS[id];
    return { id: p.id, name: p.name, price: p.price, label: p.price === 0 ? "$0" : `$${p.price}/mo`, features: p.features };
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#0B1220]">{t("title")}</h1>
        <p className="text-sm text-[#667085]">{t("subtitle")}</p>
      </div>

      <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 mb-6">
        <h3 className="font-semibold text-[#0B1220] mb-3">{t("usageThisMonth")}</h3>
        {usage?.packsLimit != null ? (
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-[#667085]">{t("packsUsed", { used: usage.packsUsed, limit: usage.packsLimit })}</span>
              <span className="font-medium text-[#0B1220]">{t("packsRemaining", { count: usage.packsRemaining })}</span>
            </div>
            <div className="w-full bg-[#E5E7EB] rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${usagePercent >= 90 ? "bg-[#EF4444]" : usagePercent >= 70 ? "bg-[#F59E0B]" : "bg-[#1D4ED8]"}`}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-[#667085]">{t("noPackCredits")}</p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {REAL_PLANS.map((p) => {
          const isCurrent = plan?.id === p.id;
          const isUpgrade = p.price > (plan?.price ?? 0);
          return (
            <div
              key={p.id}
              className={`bg-white rounded-lg border p-5 ${isCurrent ? "border-[#1D4ED8] ring-1 ring-[#1D4ED8]" : "border-[#E5E7EB]"}`}
            >
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-[#0B1220]">{p.name}</h4>
                {isCurrent && <Badge variant="success">{t("currentPlan")}</Badge>}
              </div>
              <p className="text-2xl font-bold text-[#0B1220] mb-4">{p.label}</p>
              <ul className="space-y-2 mb-4">
                {p.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-[#667085]">
                    <CheckCircle className="w-4 h-4 text-[#22C55E] shrink-0" />
                    {t(f)}
                  </li>
                ))}
              </ul>
              {isCurrent ? (
                <div className="text-center text-sm text-[#667085] py-2">{t("yourCurrentPlan")}</div>
              ) : isUpgrade ? (
                <Button variant="primary" className="w-full" disabled={upgrading === p.id} onClick={() => handleUpgrade(p.id)}>
                  {upgrading === p.id ? t("redirecting") : t("upgradeTo", { plan: p.name })}
                </Button>
              ) : (
                <div className="text-center text-xs text-[#94A3B8] py-2">{t("contactToDowngrade")}</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-[#F7F8FA] rounded-lg border border-[#E5E7EB] p-5 mt-6">
        <h3 className="font-semibold text-[#0B1220] mb-2">{t("topUps")}</h3>
        <p className="text-sm text-[#667085] mb-3">{t("topUpsDesc")}</p>
        <div className="flex gap-3">
          {TOP_UPS.map((t) => (
            <button
              key={t.sku}
              onClick={async () => {
                const res = await fetch("/api/billing/topup", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ shop_id: shopId, sku: t.sku }),
                });
                const data = await res.json();
                if (data.confirmationUrl) window.location.href = data.confirmationUrl;
              }}
              className="bg-white rounded-lg px-4 py-2 border border-[#E5E7EB] hover:border-[#1D4ED8] transition-colors text-sm"
            >
              <span className="font-medium text-[#0B1220]">{t.label}</span>{" "}
              <span className="text-[#667085]">{t.price}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-[#94A3B8] mt-4">
        {t("trialNote")}
      </p>
    </div>
  );
}
