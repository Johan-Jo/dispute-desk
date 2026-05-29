"use client";

import { FileCheck, ChevronRight } from "lucide-react";
import { DEMO_PACK_TEMPLATES } from "@/lib/demo/fixtures/packs";
import { useDemoToast } from "./DemoToast";

export function DemoPacks() {
  const { show } = useDemoToast();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-[#0B1220]">Evidence packs</h1>
        <p className="text-sm text-[#6B7280] mt-0.5">Pre-built defence templates tuned for each dispute reason. DisputeDesk picks the right pack automatically when a chargeback opens.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {DEMO_PACK_TEMPLATES.map((p) => (
          <button
            type="button"
            key={p.id}
            onClick={() => show(`This is a demo — pack templates are read-only here. Install DisputeDesk to customise.`)}
            className="text-left rounded-xl border border-[#E5E7EB] bg-white p-5 hover:border-[#7C3AED] hover:shadow-md transition-all group"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#EDE9FE] flex items-center justify-center flex-shrink-0">
                <FileCheck className="w-5 h-5 text-[#7C3AED]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold text-[#0B1220]">{p.name}</div>
                  <ChevronRight className="w-4 h-4 text-[#9CA3AF] group-hover:text-[#7C3AED] transition-colors flex-shrink-0" />
                </div>
                <div className="text-xs text-[#6B7280] mt-1">Dispute reason: <span className="font-medium text-[#0B1220]">{p.reason}</span></div>
                <div className="text-xs text-[#6B7280]">{p.evidenceCount} evidence items</div>
                <div className="text-xs text-[#10B981] font-medium mt-2">{p.trackRecord}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
