"use client";

import { ReactNode } from "react";

interface StepCardProps {
  stepNumber: number;
  title: string;
  children: ReactNode;
}

export function StepCard({ stepNumber, title, children }: StepCardProps) {
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-6 mb-6">
      <div className="flex items-start gap-3 mb-4">
        <span
          className="flex-shrink-0 w-8 h-8 rounded-full bg-[#1D4ED8] text-white text-sm font-semibold flex items-center justify-center"
          aria-hidden
        >
          {stepNumber}
        </span>
        <h2 className="text-lg font-semibold text-[#0B1220] mt-0.5">{title}</h2>
      </div>
      <div className="pl-11 text-sm text-[#667085] space-y-2">{children}</div>
    </div>
  );
}
