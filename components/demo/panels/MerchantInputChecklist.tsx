"use client";

import { X, AlertCircle, Upload } from "lucide-react";
import type { DemoDispute } from "@/lib/demo/fixtures/types";

interface MerchantInputChecklistProps {
  dispute: DemoDispute;
  onClose: () => void;
}

export function MerchantInputChecklist({ dispute, onClose }: MerchantInputChecklistProps) {
  const items = dispute.merchantInputChecklist ?? [];

  return (
    <div className="fixed inset-0 z-50 bg-[#0B1220]/40 flex justify-end" onClick={onClose}>
      <div
        className="bg-white w-full max-w-lg h-full overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-[#E5E7EB] px-5 py-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-[#0B1220]">What we need from you</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close checklist"
            className="text-[#9CA3AF] hover:text-[#0B1220] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="flex items-start gap-2.5 bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-3">
            <AlertCircle className="w-5 h-5 text-[#1D4ED8] flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-[#1E3A8A]">Parked for review</div>
              <div className="text-xs text-[#1E40AF] mt-1 leading-relaxed">
                This case can&apos;t be auto-built to a strong defence. Add the items below and DisputeDesk will assemble and submit the pack for you.
              </div>
            </div>
          </div>

          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id} className="rounded-xl border border-[#E5E7EB] p-4">
                <div className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    disabled
                    className="mt-1 w-4 h-4 rounded border-[#D1D5DB] cursor-not-allowed"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[#0B1220]">{item.label}</span>
                      {item.required && (
                        <span className="text-[10px] uppercase tracking-wider bg-[#FEE2E2] text-[#991B1B] px-1.5 py-0.5 rounded font-semibold">
                          Required
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#6B7280] mt-1 leading-relaxed">{item.detail}</p>
                    <button
                      type="button"
                      className="mt-2 inline-flex items-center gap-1.5 h-7 px-2.5 text-xs rounded-md border border-[#E5E7EB] text-[#6B7280] hover:bg-[#F9FAFB] cursor-default"
                      title="Demo only"
                    >
                      <Upload className="w-3 h-3" />
                      Upload
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] p-3 text-xs text-[#4B5563]">
            <span className="font-semibold text-[#0B1220]">When you install DisputeDesk:</span>{" "}
            you&apos;ll get email alerts the moment a case parks for review, and the upload flow is one-click. No back-and-forth with support, no Shopify Admin scavenger hunts.
          </div>
        </div>
      </div>
    </div>
  );
}
