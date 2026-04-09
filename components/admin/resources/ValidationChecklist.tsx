"use client";

import { CheckCircle, AlertTriangle } from "lucide-react";

export interface ChecklistItem {
  id: string;
  label: string;
  completed: boolean;
  required?: boolean;
}

interface ValidationChecklistProps {
  items: ChecklistItem[];
  className?: string;
}

export function ValidationChecklist({ items, className = "" }: ValidationChecklistProps) {
  const completedCount = items.filter((i) => i.completed).length;
  const requiredItems = items.filter((i) => i.required);
  const completedRequiredCount = requiredItems.filter((i) => i.completed).length;
  const allRequiredComplete = completedRequiredCount === requiredItems.length;

  return (
    <div className={`bg-white rounded-lg border border-[#E1E3E5] overflow-hidden ${className}`}>
      <div className="p-4 border-b border-[#E1E3E5] bg-[#F8FAFC]">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-[#0F172A] flex items-center gap-2">
            <CheckCircle
              className={`w-4 h-4 ${allRequiredComplete ? "text-[#22C55E]" : "text-[#667085]"}`}
            />
            Publishing Checklist
          </h3>
          <span className="text-xs font-semibold text-[#667085]">
            {completedCount}/{items.length}
          </span>
        </div>
        <div className="h-2 bg-white rounded-full overflow-hidden border border-[#E1E3E5]">
          <div
            className={`h-full transition-all ${
              completedCount === items.length ? "bg-[#22C55E]" : "bg-[#1D4ED8]"
            }`}
            style={{ width: `${(completedCount / items.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="p-4 space-y-2.5">
        {items.map((item) => (
          <label
            key={item.id}
            className={`flex items-start gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
              item.completed ? "bg-[#F0FDF4] hover:bg-[#DCFCE7]" : "hover:bg-[#F8FAFC]"
            }`}
          >
            <input
              type="checkbox"
              checked={item.completed}
              readOnly
              className="mt-0.5 w-4 h-4 rounded border-[#E1E3E5] text-[#22C55E] focus:ring-[#22C55E]"
            />
            <div className="flex-1">
              <span
                className={`text-sm ${
                  item.completed
                    ? "text-[#15803D] line-through"
                    : "text-[#0F172A] font-medium"
                }`}
              >
                {item.label}
              </span>
              {item.required && !item.completed && (
                <span className="ml-2 text-xs text-[#DC2626]">Required</span>
              )}
            </div>
            {item.completed && <CheckCircle className="w-4 h-4 text-[#22C55E] flex-shrink-0" />}
          </label>
        ))}
      </div>

      {!allRequiredComplete && (
        <div className="px-4 pb-4">
          <div className="p-3 bg-[#FEF3C7] border border-[#FDE68A] rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-[#92400E] flex-shrink-0 mt-0.5" />
            <div className="text-xs text-[#92400E]">
              <span className="font-semibold">
                Complete {requiredItems.length - completedRequiredCount} required{" "}
                {requiredItems.length - completedRequiredCount === 1 ? "item" : "items"}
              </span>{" "}
              before publishing
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
