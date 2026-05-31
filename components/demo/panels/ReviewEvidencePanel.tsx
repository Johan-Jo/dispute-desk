"use client";

import { CheckCircle2 } from "lucide-react";
import type { DemoDispute } from "@/lib/demo/fixtures/types";

const GROUP_LABELS = {
  strong: { label: "Strong evidence", tone: "bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]" },
  moderate: { label: "Moderate evidence", tone: "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]" },
  supplemental: { label: "Supplemental", tone: "bg-[#E0F2FE] text-[#075985] border-[#BAE6FD]" },
} as const;

export function ReviewEvidencePanel({ dispute }: { dispute: DemoDispute }) {
  const groups = (["strong", "moderate", "supplemental"] as const).map((g) => ({
    key: g,
    label: GROUP_LABELS[g].label,
    tone: GROUP_LABELS[g].tone,
    items: dispute.evidence.filter((e) => e.group === g),
  }));

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white">
      <div className="px-5 py-4 border-b border-[#E5E7EB]">
        <h3 className="text-sm font-semibold text-[#0B1220]">Collected evidence ({dispute.evidence.length})</h3>
        <p className="text-xs text-[#6B7280] mt-0.5">Auto-pulled from Shopify, fulfillment, and customer history.</p>
      </div>
      <div className="divide-y divide-[#F1F2F4]">
        {groups
          .filter((g) => g.items.length > 0)
          .map((group) => (
            <div key={group.key} className="px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${group.tone}`}>
                  {group.label}
                </span>
                <span className="text-xs text-[#9CA3AF]">{group.items.length} {group.items.length === 1 ? "item" : "items"}</span>
              </div>
              <ul className="space-y-2.5">
                {group.items.map((item) => (
                  <li key={item.id} className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#10B981] mt-0.5 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-[#0B1220]">{item.label}</div>
                      <div className="text-xs text-[#6B7280] mt-0.5">{item.detail}</div>
                      <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] mt-1">{item.source}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>
    </div>
  );
}
