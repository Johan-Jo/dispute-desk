"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Plus, Edit, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { useCompleteSetupStep } from "@/lib/setup/useCompleteSetupStep";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDemoMode } from "@/lib/demo-mode";
import { useActiveShopId } from "@/lib/portal/activeShopContext";
import { DemoNotice } from "@/components/ui/demo-notice";

interface Rule {
  id: string;
  shop_id: string;
  name: string | null;
  enabled: boolean;
  match: { reason?: string[]; status?: string[]; amount_range?: { min?: number; max?: number } };
  action: { mode: "auto_pack" | "review"; require_fields?: string[] };
  priority: number;
}

const DEMO_RULES = [
  { id: "R-001", nameKey: "demoRule1Name", triggerKey: "demoRule1Trigger", actionKey: "demoRule1Action", status: "active", executions: 23 },
  { id: "R-002", nameKey: "demoRule2Name", triggerKey: "demoRule2Trigger", actionKey: "demoRule2Action", status: "active", executions: 8 },
  { id: "R-003", nameKey: "demoRule3Name", triggerKey: "demoRule3Trigger", actionKey: "demoRule3Action", status: "active", executions: 15 },
  { id: "R-004", nameKey: "demoRule4Name", triggerKey: "demoRule4Trigger", actionKey: "demoRule4Action", status: "inactive", executions: 0 },
];

const DISPUTE_REASONS = [
  "PRODUCT_NOT_RECEIVED",
  "PRODUCT_UNACCEPTABLE",
  "FRAUDULENT",
  "CREDIT_NOT_PROCESSED",
  "SUBSCRIPTION_CANCELED",
  "DUPLICATE",
  "GENERAL",
];

const REASON_KEYS: Record<string, string> = {
  PRODUCT_NOT_RECEIVED: "productNotReceived",
  PRODUCT_UNACCEPTABLE: "productUnacceptable",
  FRAUDULENT: "fraudulent",
  CREDIT_NOT_PROCESSED: "creditNotProcessed",
  SUBSCRIPTION_CANCELED: "subscriptionCanceled",
  DUPLICATE: "duplicate",
  GENERAL: "general",
};

function matchSummary(
  match: Rule["match"],
  tRules: (key: string) => string,
  tReasons: { has: (key: string) => boolean; (key: string): string },
): string {
  const parts: string[] = [];
  if (match.reason?.length) {
    const translated = match.reason.map((r) => {
      const key = REASON_KEYS[r];
      return key && tReasons.has(key) ? tReasons(key) : r.replace(/_/g, " ");
    });
    parts.push(`${tRules("reason")}: ${translated.join(", ")}`);
  }
  if (match.status?.length) parts.push(`${tRules("statusLabel")}: ${match.status.join(", ")}`);
  if (match.amount_range) {
    const { min, max } = match.amount_range;
    if (min != null && max != null) parts.push(`$${min}–$${max}`);
    else if (min != null) parts.push(`≥ $${min}`);
    else if (max != null) parts.push(`≤ $${max}`);
  }
  return parts.length ? parts.join(" · ") : tRules("matchesAll");
}

export default function RulesSettingsPage() {
  useCompleteSetupStep("automation_rules");
  const t = useTranslations("rules");
  const tc = useTranslations("common");
  const tr = useTranslations("reasons");
  const isDemo = useDemoMode();

  const demoClick = () => {};
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [formName, setFormName] = useState("");
  const [formReasons, setFormReasons] = useState<string[]>([]);
  const [formMode, setFormMode] = useState<"auto_pack" | "review">("auto_pack");
  const [formMinAmount, setFormMinAmount] = useState("");
  const [formMaxAmount, setFormMaxAmount] = useState("");

  const shopId = useActiveShopId() ?? "";

  const [planBlocked, setPlanBlocked] = useState(false);

  const fetchRules = useCallback(async () => {
    if (isDemo || !shopId) { setLoading(false); return; }
    setLoading(true);
    const res = await fetch(`/api/rules?shop_id=${shopId}`);
    const data = await res.json();
    setRules(Array.isArray(data) ? data : []);
    setLoading(false);

    const usageRes = await fetch(`/api/billing/usage?shop_id=${shopId}`);
    const usageData = await usageRes.json();
    setPlanBlocked(!usageData.plan?.rules);
  }, [shopId, isDemo]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const handleCreate = async () => {
    if (isDemo) return;
    const match: Rule["match"] = {};
    if (formReasons.length) match.reason = formReasons;
    const min = formMinAmount ? parseFloat(formMinAmount) : undefined;
    const max = formMaxAmount ? parseFloat(formMaxAmount) : undefined;
    if (min != null || max != null) match.amount_range = { min, max };

    await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: shopId, name: formName || null, match, action: { mode: formMode }, priority: rules.length }),
    });

    setShowForm(false);
    setFormName(""); setFormReasons([]); setFormMode("auto_pack"); setFormMinAmount(""); setFormMaxAmount("");
    await fetchRules();
  };

  if (isDemo) {
    const firstRule = DEMO_RULES[0];
    const remainingRules = DEMO_RULES.slice(1);

    return (
      <div>
        <div data-onboarding="rules-header">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-[#0B1220] mb-2">{t("title")}</h1>
              <p className="text-[#667085]">{t("subtitleDemo")}</p>
            </div>
            <Button variant="primary" size="sm" onClick={() => setShowForm(!showForm)} data-onboarding="create-rule-button">
              <Plus className="w-4 h-4 mr-2" />
              {t("createRule")}
            </Button>
          </div>

          {isDemo && <DemoNotice />}

          {showForm && (
            <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 mb-6">
              <h3 className="font-semibold text-[#0B1220] mb-4">{t("newRule")}</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#667085] mb-1">{t("name")}</label>
                  <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={t("namePlaceholder")} className="w-full h-10 px-3 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5]" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#667085] mb-1">{t("matchReasons")}</label>
                  <div className="flex flex-wrap gap-2">
                    {DISPUTE_REASONS.map((r) => (
                      <button key={r} onClick={() => setFormReasons((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r])} className={`px-3 py-1 text-xs rounded-full border transition-colors ${formReasons.includes(r) ? "bg-[#1D4ED8] text-white border-[#1D4ED8]" : "bg-white text-[#667085] border-[#E5E7EB] hover:border-[#1D4ED8]"}`}>
                        {REASON_KEYS[r] ? tr(REASON_KEYS[r]) : r.replace(/_/g, " ")}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-[#94A3B8] mt-1">{t("matchReasonsHelp")}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[#667085] mb-1">{t("minAmount")}</label>
                    <input type="number" value={formMinAmount} onChange={(e) => setFormMinAmount(e.target.value)} placeholder="0" className="w-full h-10 px-3 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5]" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#667085] mb-1">{t("maxAmount")}</label>
                    <input type="number" value={formMaxAmount} onChange={(e) => setFormMaxAmount(e.target.value)} placeholder={t("noLimit")} className="w-full h-10 px-3 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5]" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#667085] mb-1">{t("action")}</label>
                  <div className="flex gap-3">
                    <button onClick={() => setFormMode("auto_pack")} className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${formMode === "auto_pack" ? "bg-[#1D4ED8] text-white border-[#1D4ED8]" : "bg-white text-[#667085] border-[#E5E7EB] hover:border-[#1D4ED8]"}`}>{t("autoPack")}</button>
                    <button onClick={() => setFormMode("review")} className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${formMode === "review" ? "bg-[#F59E0B] text-white border-[#F59E0B]" : "bg-white text-[#667085] border-[#E5E7EB] hover:border-[#F59E0B]"}`}>{t("review")}</button>
                  </div>
                </div>
                <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-3">
                  <p className="text-sm text-[#1D4ED8]">{tc("demoOnly")}</p>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>{tc("cancel")}</Button>
                  <Button variant="primary" size="sm" disabled title={tc("demoOnly")}>{t("createRule")}</Button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-4 mb-4" data-onboarding="rules-list">
            {[firstRule].map((rule) => (
            <div key={rule.id} className="bg-white rounded-lg border border-[#E5E7EB] p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3">
                    <h3 className="font-semibold text-[#0B1220]">{t(rule.nameKey)}</h3>
                    {rule.status === "active" ? (
                      <Badge variant="success">{t("active")}</Badge>
                    ) : (
                      <Badge variant="default">{t("inactive")}</Badge>
                    )}
                    <span className="text-sm text-[#667085]">{rule.id}</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <p className="text-xs text-[#667085] uppercase tracking-wider mb-1">{t("triggerCondition")}</p>
                      <p className="text-sm text-[#0B1220] font-medium">{t(rule.triggerKey)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[#667085] uppercase tracking-wider mb-1">{t("action")}</p>
                      <p className="text-sm text-[#0B1220] font-medium">{t(rule.actionKey)}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-[#667085]">{t("executions")}</p>
                    <p className="text-sm font-semibold text-[#0B1220]">{rule.executions}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button variant="ghost" size="sm" title={tc("demoOnly")} onClick={demoClick}>
                    {rule.status === "active" ? (
                      <ToggleRight className="w-5 h-5 text-[#10B981]" />
                    ) : (
                      <ToggleLeft className="w-5 h-5 text-[#667085]" />
                    )}
                  </Button>
                  <Button variant="ghost" size="sm" title={tc("demoOnly")} onClick={demoClick}><Edit className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="sm" title={tc("demoOnly")} onClick={demoClick}><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
            </div>
          ))}
          </div>
        </div>

        <div className="space-y-4">
          {remainingRules.map((rule) => (
            <div key={rule.id} className="bg-white rounded-lg border border-[#E5E7EB] p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3">
                    <h3 className="font-semibold text-[#0B1220]">{t(rule.nameKey)}</h3>
                    {rule.status === "active" ? (
                      <Badge variant="success">{t("active")}</Badge>
                    ) : (
                      <Badge variant="default">{t("inactive")}</Badge>
                    )}
                    <span className="text-sm text-[#667085]">{rule.id}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <p className="text-xs text-[#667085] uppercase tracking-wider mb-1">{t("triggerCondition")}</p>
                      <p className="text-sm text-[#0B1220] font-medium">{t(rule.triggerKey)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[#667085] uppercase tracking-wider mb-1">{t("action")}</p>
                      <p className="text-sm text-[#0B1220] font-medium">{t(rule.actionKey)}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-[#667085]">{t("executions")}</p>
                    <p className="text-sm font-semibold text-[#0B1220]">{rule.executions}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button variant="ghost" size="sm" title={tc("demoOnly")} onClick={demoClick}>
                    {rule.status === "active" ? (
                      <ToggleRight className="w-5 h-5 text-[#10B981]" />
                    ) : (
                      <ToggleLeft className="w-5 h-5 text-[#667085]" />
                    )}
                  </Button>
                  <Button variant="ghost" size="sm" title={tc("demoOnly")} onClick={demoClick}><Edit className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="sm" title={tc("demoOnly")} onClick={demoClick}><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6" data-onboarding="rules-header">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220]">{t("title")}</h1>
          <p className="text-sm text-[#667085]">{t("subtitle")}</p>
        </div>
        <Button variant="primary" size="sm" disabled={planBlocked} onClick={() => setShowForm(!showForm)} data-onboarding="create-rule-button">
          <Plus className="w-4 h-4 mr-1" />
          {t("addRule")}
        </Button>
      </div>

      {planBlocked && (
        <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-5 mb-6">
          <h4 className="font-semibold text-[#1E40AF] mb-1">{t("paidOnly")}</h4>
          <p className="text-sm text-[#1E40AF] mb-3">{t("paidOnlyMessage")}</p>
          <a href="/portal/billing" className="inline-block px-4 py-2 bg-[#1D4ED8] text-white text-sm font-medium rounded-lg hover:bg-[#1E40AF] transition-colors">
            {t("upgradePlan")}
          </a>
        </div>
      )}

      {showForm && !planBlocked && (
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 mb-6">
          <h3 className="font-semibold text-[#0B1220] mb-4">{t("newRule")}</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#667085] mb-1">{t("name")}</label>
              <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={t("namePlaceholder")} className="w-full h-10 px-3 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5]" />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#667085] mb-1">{t("matchReasons")}</label>
              <div className="flex flex-wrap gap-2">
                {DISPUTE_REASONS.map((r) => (
                  <button key={r} onClick={() => setFormReasons((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r])} className={`px-3 py-1 text-xs rounded-full border transition-colors ${formReasons.includes(r) ? "bg-[#1D4ED8] text-white border-[#1D4ED8]" : "bg-white text-[#667085] border-[#E5E7EB] hover:border-[#1D4ED8]"}`}>
                    {REASON_KEYS[r] ? tr(REASON_KEYS[r]) : r.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
              <p className="text-xs text-[#94A3B8] mt-1">{t("matchReasonsHelp")}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#667085] mb-1">{t("minAmount")}</label>
                <input type="number" value={formMinAmount} onChange={(e) => setFormMinAmount(e.target.value)} placeholder="0" className="w-full h-10 px-3 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5]" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#667085] mb-1">{t("maxAmount")}</label>
                <input type="number" value={formMaxAmount} onChange={(e) => setFormMaxAmount(e.target.value)} placeholder={t("noLimit")} className="w-full h-10 px-3 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5]" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#667085] mb-1">{t("action")}</label>
              <div className="flex gap-3">
                <button onClick={() => setFormMode("auto_pack")} className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${formMode === "auto_pack" ? "bg-[#1D4ED8] text-white border-[#1D4ED8]" : "bg-white text-[#667085] border-[#E5E7EB] hover:border-[#1D4ED8]"}`}>{t("autoPack")}</button>
                <button onClick={() => setFormMode("review")} className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${formMode === "review" ? "bg-[#F59E0B] text-white border-[#F59E0B]" : "bg-white text-[#667085] border-[#E5E7EB] hover:border-[#F59E0B]"}`}>{t("review")}</button>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>{tc("cancel")}</Button>
              <Button variant="primary" size="sm" onClick={handleCreate}>{t("createRule")}</Button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
        {loading ? (
          <div className="px-4 py-12 text-center text-[#667085]">{tc("loading")}</div>
        ) : rules.length === 0 ? (
          <div className="px-4 py-12 text-center text-[#667085]">{t("noRules")}</div>
        ) : (
          <div className="divide-y divide-[#E5E7EB]">
            {rules.map((rule, idx) => (
              <div key={rule.id} className={`flex items-center gap-4 px-4 py-3 ${!rule.enabled ? "opacity-50" : ""}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-[#94A3B8]">#{idx + 1}</span>
                    <span className="font-medium text-[#0B1220] text-sm truncate">{rule.name || t("unnamedRule")}</span>
                    <Badge variant={rule.action.mode === "auto_pack" ? "success" : "warning"}>
                      {rule.action.mode === "auto_pack" ? t("autoPack") : t("review")}
                    </Badge>
                  </div>
                  <p className="text-xs text-[#667085]">{matchSummary(rule.match, t, tr as any)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-[#94A3B8] mt-3">{t("footer")}</p>
    </div>
  );
}
