"use client";

import { CheckCircle2, Clock } from "lucide-react";
import { SETUP_STEPS, isPrerequisiteMet } from "@/lib/setup/constants";
import type { StepId, StepsMap } from "@/lib/setup/types";

interface PortalStepCardsRowProps {
  currentStepId: StepId;
  stepsMap: StepsMap;
  onStepClick: (stepId: StepId) => void;
}

export function PortalStepCardsRow({
  currentStepId,
  stepsMap,
  onStepClick,
}: PortalStepCardsRowProps) {
  return (
    <div className="min-w-0 pb-1">
      <div className="flex gap-2 flex-wrap">
        {SETUP_STEPS.map((step) => {
          const state = stepsMap[step.id];
          const status = state?.status ?? "todo";
          const isActive = currentStepId === step.id;
          const isCompleted = status === "done";
          const isLocked = !isPrerequisiteMet(step.id, stepsMap ?? {});
          const isDisabled = isLocked && !isCompleted;

          return (
            <button
              key={step.id}
              type="button"
              disabled={isDisabled}
              onClick={() => !isDisabled && onStepClick(step.id)}
              className={
                isDisabled
                  ? "flex flex-col items-center text-center py-3 px-3 rounded-lg flex-1 min-w-[100px] max-w-[130px] opacity-50 cursor-not-allowed bg-[#F6F6F7]"
                  : isActive
                    ? "flex flex-col items-center text-center py-3 px-3 rounded-lg flex-1 min-w-[100px] max-w-[130px] cursor-pointer bg-[#EFF6FF] border-2 border-[#1D4ED8]"
                    : isCompleted
                      ? "flex flex-col items-center text-center py-3 px-3 rounded-lg flex-1 min-w-[100px] max-w-[130px] cursor-pointer bg-[#ECFDF5] border-2 border-[#10B981]"
                      : "flex flex-col items-center text-center py-3 px-3 rounded-lg flex-1 min-w-[100px] max-w-[130px] cursor-pointer bg-[#F6F6F7] border-2 border-[#E5E7EB]"
              }
            >
              <div
                className={
                  isCompleted
                    ? "w-9 h-9 rounded-full flex items-center justify-center mb-2 bg-[#10B981] text-white"
                    : isActive
                      ? "w-9 h-9 rounded-full flex items-center justify-center mb-2 bg-[#1D4ED8] text-white"
                      : "w-9 h-9 rounded-full flex items-center justify-center mb-2 bg-[#E5E7EB] text-[#64748B]"
                }
              >
                {isCompleted ? (
                  <CheckCircle2 className="w-5 h-5" />
                ) : (
                  <span className="font-semibold text-sm">{step.index}</span>
                )}
              </div>
              <span className="text-sm font-semibold text-[#0B1220]">
                {step.title}
              </span>
              <div className="flex items-center gap-1 mt-1 text-[#64748B]">
                <Clock className="w-3.5 h-3.5" />
                <span className="text-xs">{step.timeEstimate}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
