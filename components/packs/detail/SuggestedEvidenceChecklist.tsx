"use client";

import { CheckCircle, Circle } from "lucide-react";

export interface ChecklistItemFromApi {
  field: string;
  label: string;
  required: boolean;
  present: boolean;
}

interface SuggestedEvidenceChecklistProps {
  title: string;
  description: string;
  guideLabel: string;
  /** From API when available */
  checklist: ChecklistItemFromApi[] | null;
  /** Fallback labels when no checklist (key = message key, value = display label) */
  suggestedLabels: string[];
}

export function SuggestedEvidenceChecklist({
  title,
  description,
  guideLabel,
  checklist,
  suggestedLabels,
}: SuggestedEvidenceChecklistProps) {
  const items = checklist?.length
    ? checklist.map((c) => ({ label: c.label, present: c.present }))
    : suggestedLabels.map((label) => ({ label, present: false }));

  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 mb-6">
      <h3 className="font-semibold text-[#0B1220] mb-1">{title}</h3>
      <p className="text-sm text-[#667085] mb-3">{description}</p>
      <p className="text-sm text-[#1E40AF] font-medium mb-4">{guideLabel}</p>
      <ul className="space-y-2">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-center gap-3 text-sm text-[#0B1220]">
            {item.present ? (
              <CheckCircle className="w-5 h-5 text-[#22C55E] shrink-0" />
            ) : (
              <Circle className="w-5 h-5 text-[#94A3B8] shrink-0" />
            )}
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
