"use client";

import { X, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import type { DemoDispute } from "@/lib/demo/fixtures/types";

interface CaseStrengthDrawerProps {
  dispute: DemoDispute;
  onClose: () => void;
}

const ICON_BY_TONE = {
  positive: { Icon: CheckCircle2, color: "text-[#10B981]" },
  negative: { Icon: XCircle, color: "text-[#EF4444]" },
  neutral: { Icon: MinusCircle, color: "text-[#9CA3AF]" },
};

export function CaseStrengthDrawer({ dispute, onClose }: CaseStrengthDrawerProps) {
  const scoreColor =
    dispute.strengthScore >= 80
      ? "text-[#10B981]"
      : dispute.strengthScore >= 50
        ? "text-[#F59E0B]"
        : "text-[#EF4444]";

  return (
    <div className="fixed inset-0 z-50 bg-[#0B1220]/40 flex justify-end" onClick={onClose}>
      <div
        className="bg-white w-full max-w-md h-full overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-[#E5E7EB] px-5 py-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-[#0B1220]">Case strength breakdown</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close strength breakdown"
            className="text-[#9CA3AF] hover:text-[#0B1220] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Score */}
          <div className="rounded-xl border border-[#E5E7EB] p-4 text-center">
            <div className={`text-4xl font-bold ${scoreColor}`}>{dispute.strengthScore}%</div>
            <div className="text-xs text-[#6B7280] mt-1 uppercase tracking-wider">Strength score</div>
            <div className="text-sm text-[#0B1220] font-medium mt-2">{dispute.strengthCaption}</div>
          </div>

          {/* Breakdown */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-3">Signal-by-signal breakdown</div>
            <ul className="space-y-3">
              {dispute.strengthBreakdown.map((b, idx) => {
                const { Icon, color } = ICON_BY_TONE[b.tone];
                return (
                  <li key={idx} className="flex items-start gap-2.5">
                    <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${color}`} />
                    <div>
                      <div className="text-sm font-medium text-[#0B1220]">{b.label}</div>
                      <div className="text-xs text-[#6B7280] mt-0.5">{b.detail}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] p-3 text-xs text-[#4B5563]">
            <span className="font-semibold text-[#0B1220]">How is strength calculated?</span>{" "}
            DisputeDesk weights each evidence signal based on how the card networks evaluate it. AVS + CVV + 3-D Secure carry the highest weight for fraud claims; tracked delivery + signature dominate &quot;product not received&quot; cases. Coverage and fatal-loss gates short-circuit the calculation.
          </div>
        </div>
      </div>
    </div>
  );
}
