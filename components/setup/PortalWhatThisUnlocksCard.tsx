"use client";

import { CheckCircle2, Clock } from "lucide-react";
import { STEP_BY_ID } from "@/lib/setup/constants";
import type { StepId } from "@/lib/setup/types";

interface PortalWhatThisUnlocksCardProps {
  stepId: StepId;
}

export function PortalWhatThisUnlocksCard({ stepId }: PortalWhatThisUnlocksCardProps) {
  const step = STEP_BY_ID[stepId];
  if (!step) return null;

  return (
    <div className="bg-[#EFF6FF] border border-[#1D4ED8] rounded-xl p-6 sticky top-6">
      <h3 className="text-base font-semibold text-[#0B1220] mb-4">
        What this unlocks
      </h3>
      <ul className="space-y-3 mb-4">
        {step.unlocks.map((item, i) => (
          <li key={i} className="flex gap-2 items-start text-sm text-[#667085]">
            <CheckCircle2 className="w-4 h-4 text-[#10B981] flex-shrink-0 mt-0.5" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <hr className="border-[#E5E7EB] my-4" />
      <div className="flex items-center gap-2 text-sm text-[#64748B]">
        <Clock className="w-4 h-4" />
        <span>Estimated: {step.timeEstimate}</span>
      </div>
    </div>
  );
}
