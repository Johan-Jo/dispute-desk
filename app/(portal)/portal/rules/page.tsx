"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown, ToggleLeft, ToggleRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Rule {
  id: string;
  shop_id: string;
  name: string | null;
  enabled: boolean;
  match: { reason?: string[]; status?: string[]; amount_range?: { min?: number; max?: number } };
  action: { mode: "auto_pack" | "review"; require_fields?: string[] };
  priority: number;
}

const DISPUTE_REASONS = [
  "PRODUCT_NOT_RECEIVED",
  "PRODUCT_UNACCEPTABLE",
  "FRAUDULENT",
  "CREDIT_NOT_PROCESSED",
  "SUBSCRIPTION_CANCELED",
  "DUPLICATE",
  "GENERAL",
];

function matchSummary(match: Rule["match"]): string {
  const parts: string[] = [];
  if (match.reason?.length) parts.push(`Reason: ${match.reason.join(", ")}`);
  if (match.status?.length) parts.push(`Status: ${match.status.join(", ")}`);
  if (match.amount_range) {
    const { min, max } = match.amount_range;
    if (min != null && max != null) parts.push(`$${min}–$${max}`);
    else if (min != null) parts.push(`≥ $${min}`);
    else if (max != null) parts.push(`≤ $${max}`);
  }
  return parts.length ? parts.join(" · ") : "Matches all disputes";
}

export default function RulesSettingsPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formReasons, setFormReasons] = useState<string[]>([]);
  const [formMode, setFormMode] = useState<"auto_pack" | "review">("auto_pack");
  const [formMinAmount, setFormMinAmount] = useState("");
  const [formMaxAmount, setFormMaxAmount] = useState("");

  const shopId = typeof window !== "undefined"
    ? document.cookie.match(/active_shop_id=([^;]+)/)?.[1] ?? ""
    : "";

  const [planBlocked, setPlanBlocked] = useState(false);

  const fetchRules = useCallback(async () => {
    if (!shopId) return;
    setLoading(true);
    const res = await fetch(`/api/rules?shop_id=${shopId}`);
    const data = await res.json();
    setRules(Array.isArray(data) ? data : []);
    setLoading(false);

    const usageRes = await fetch(`/api/billing/usage?shop_id=${shopId}`);
    const usageData = await usageRes.json();
    setPlanBlocked(!usageData.plan?.rules);
  }, [shopId]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const handleCreate = async () => {
    const match: Rule["match"] = {};
    if (formReasons.length) match.reason = formReasons;
    const min = formMinAmount ? parseFloat(formMinAmount) : undefined;
    const max = formMaxAmount ? parseFloat(formMaxAmount) : undefined;
    if (min != null || max != null) match.amount_range = { min, max };

    await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shop_id: shopId,
        name: formName || null,
        match,
        action: { mode: formMode },
        priority: rules.length,
      }),
    });

    setShowForm(false);
    setFormName("");
    setFormReasons([]);
    setFormMode("auto_pack");
    setFormMinAmount("");
    setFormMaxAmount("");
    await fetchRules();
  };

  const handleToggle = async (rule: Rule) => {
    await fetch(`/api/rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    await fetchRules();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/rules/${id}`, { method: "DELETE" });
    await fetchRules();
  };

  const handleReorder = async (index: number, direction: "up" | "down") => {
    const newRules = [...rules];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newRules.length) return;
    [newRules[index], newRules[swapIndex]] = [newRules[swapIndex], newRules[index]];
    setRules(newRules);

    await fetch("/api/rules/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ordered_ids: newRules.map((r) => r.id) }),
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220]">Rules</h1>
          <p className="text-sm text-[#667085]">
            Configure how disputes are routed — auto-pack or review queue.
            First matching rule wins.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={planBlocked}
          onClick={() => setShowForm(!showForm)}
        >
          <Plus className="w-4 h-4 mr-1" />
          Add Rule
        </Button>
      </div>

      {planBlocked && (
        <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-5 mb-6">
          <h4 className="font-semibold text-[#1E40AF] mb-1">Available on Starter and above</h4>
          <p className="text-sm text-[#1E40AF] mb-3">
            Custom rules require a paid plan. Upgrade to automate your dispute workflow.
          </p>
          <a
            href="/portal/billing"
            className="inline-block px-4 py-2 bg-[#1D4ED8] text-white text-sm font-medium rounded-lg hover:bg-[#1E40AF] transition-colors"
          >
            Upgrade Plan
          </a>
        </div>
      )}

      {showForm && !planBlocked && (
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 mb-6">
          <h3 className="font-semibold text-[#0B1220] mb-4">New Rule</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#667085] mb-1">Name (optional)</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. High-value auto-pack"
                className="w-full h-10 px-3 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#667085] mb-1">Match Reasons</label>
              <div className="flex flex-wrap gap-2">
                {DISPUTE_REASONS.map((r) => (
                  <button
                    key={r}
                    onClick={() =>
                      setFormReasons((prev) =>
                        prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]
                      )
                    }
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                      formReasons.includes(r)
                        ? "bg-[#1D4ED8] text-white border-[#1D4ED8]"
                        : "bg-white text-[#667085] border-[#E5E7EB] hover:border-[#1D4ED8]"
                    }`}
                  >
                    {r.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
              <p className="text-xs text-[#94A3B8] mt-1">Leave empty to match all reasons.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#667085] mb-1">Min Amount ($)</label>
                <input
                  type="number"
                  value={formMinAmount}
                  onChange={(e) => setFormMinAmount(e.target.value)}
                  placeholder="0"
                  className="w-full h-10 px-3 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#667085] mb-1">Max Amount ($)</label>
                <input
                  type="number"
                  value={formMaxAmount}
                  onChange={(e) => setFormMaxAmount(e.target.value)}
                  placeholder="No limit"
                  className="w-full h-10 px-3 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#667085] mb-1">Action</label>
              <div className="flex gap-3">
                <button
                  onClick={() => setFormMode("auto_pack")}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    formMode === "auto_pack"
                      ? "bg-[#1D4ED8] text-white border-[#1D4ED8]"
                      : "bg-white text-[#667085] border-[#E5E7EB] hover:border-[#1D4ED8]"
                  }`}
                >
                  Auto-Pack
                </button>
                <button
                  onClick={() => setFormMode("review")}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    formMode === "review"
                      ? "bg-[#F59E0B] text-white border-[#F59E0B]"
                      : "bg-white text-[#667085] border-[#E5E7EB] hover:border-[#F59E0B]"
                  }`}
                >
                  Send to Review
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleCreate}>Create Rule</Button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
        {loading ? (
          <div className="px-4 py-12 text-center text-[#667085]">Loading rules...</div>
        ) : rules.length === 0 ? (
          <div className="px-4 py-12 text-center text-[#667085]">
            No rules configured. All new disputes will go to the review queue by default.
          </div>
        ) : (
          <div className="divide-y divide-[#E5E7EB]">
            {rules.map((rule, idx) => (
              <div
                key={rule.id}
                className={`flex items-center gap-4 px-4 py-3 ${!rule.enabled ? "opacity-50" : ""}`}
              >
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => handleReorder(idx, "up")}
                    disabled={idx === 0}
                    className="text-[#94A3B8] hover:text-[#0B1220] disabled:opacity-30"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleReorder(idx, "down")}
                    disabled={idx === rules.length - 1}
                    className="text-[#94A3B8] hover:text-[#0B1220] disabled:opacity-30"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-[#94A3B8]">#{idx + 1}</span>
                    <span className="font-medium text-[#0B1220] text-sm truncate">
                      {rule.name || "Unnamed Rule"}
                    </span>
                    <Badge variant={rule.action.mode === "auto_pack" ? "success" : "warning"}>
                      {rule.action.mode === "auto_pack" ? "Auto-Pack" : "Review"}
                    </Badge>
                  </div>
                  <p className="text-xs text-[#667085]">{matchSummary(rule.match)}</p>
                </div>

                <button
                  onClick={() => handleToggle(rule)}
                  className="text-[#667085] hover:text-[#0B1220]"
                  title={rule.enabled ? "Disable" : "Enable"}
                >
                  {rule.enabled ? (
                    <ToggleRight className="w-5 h-5 text-[#22C55E]" />
                  ) : (
                    <ToggleLeft className="w-5 h-5" />
                  )}
                </button>

                <button
                  onClick={() => handleDelete(rule.id)}
                  className="text-[#94A3B8] hover:text-[#EF4444]"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-[#94A3B8] mt-3">
        Rules are evaluated top-to-bottom. First matching rule wins. Disputes matching no rule go to Review Queue.
      </p>
    </div>
  );
}
