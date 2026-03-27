"use client";

import type { Priority } from "@/lib/resources/workflow";
import { getPriorityDisplay } from "@/lib/resources/workflow";

interface PriorityBadgeProps {
  priority: Priority;
  className?: string;
}

export function PriorityBadge({ priority, className = "" }: PriorityBadgeProps) {
  const display = getPriorityDisplay(priority);
  return (
    <span
      className={`text-xs px-2 py-1 rounded border font-medium ${className}`}
      style={{
        color: display.color,
        backgroundColor: display.bgColor,
        borderColor: display.borderColor,
      }}
    >
      {display.label}
    </span>
  );
}
