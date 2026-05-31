"use client";

import { X, ArrowRight } from "lucide-react";
import type { DemoDispute } from "@/lib/demo/fixtures/types";

interface SubmissionSummaryDrawerProps {
  dispute: DemoDispute;
  onClose: () => void;
}

export function SubmissionSummaryDrawer({ dispute, onClose }: SubmissionSummaryDrawerProps) {
  return (
    <div className="fixed inset-0 z-50 bg-[#0B1220]/40 flex justify-end" onClick={onClose}>
      <div
        className="bg-white w-full max-w-lg h-full overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-[#E5E7EB] px-5 py-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-[#0B1220]">Submission summary</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close summary"
            className="text-[#9CA3AF] hover:text-[#0B1220] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          <section>
            <div className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">Bank rebuttal narrative</div>
            <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-4 text-sm text-[#0B1220] leading-relaxed">
              {dispute.bankRebuttalNarrative}
            </div>
            <p className="text-xs text-[#6B7280] mt-2 italic">
              Optimised for the bank reviewer — confident, factual, no merchant confessions or hedging language.
            </p>
          </section>

          <section>
            <div className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">Shopify evidence field mapping</div>
            <p className="text-xs text-[#6B7280] mb-3">
              DisputeDesk maps each piece of collected evidence to the correct Shopify evidence slot so nothing is dumped into &quot;Uncategorised text&quot; unnecessarily.
            </p>
            <div className="space-y-2">
              {dispute.shopifyFieldMap.map((m, idx) => (
                <div key={idx} className="rounded-lg border border-[#E5E7EB] p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-[#0B1220]">
                    <span>{m.slot}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#9CA3AF]" />
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {m.sourceFields.map((f, i) => (
                      <li key={i} className="text-xs text-[#4B5563] pl-1">→ {f}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">What the merchant still controls</div>
            <ul className="space-y-1.5 text-sm text-[#0B1220]">
              <li className="flex items-start gap-2"><span className="text-[#7C3AED]">•</span> Review before save (automation mode = review)</li>
              <li className="flex items-start gap-2"><span className="text-[#7C3AED]">•</span> Edit the bank rebuttal narrative if you want to add context</li>
              <li className="flex items-start gap-2"><span className="text-[#7C3AED]">•</span> Attach additional files (photos, emails, custom documents)</li>
              <li className="flex items-start gap-2"><span className="text-[#7C3AED]">•</span> Final &quot;Save to Shopify&quot; click is always merchant-initiated unless auto-mode is enabled for Strong cases</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
