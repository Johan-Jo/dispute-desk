"use client";

import type { ContentType } from "@/lib/resources/workflow";
import { getContentTypeLabel } from "@/lib/resources/workflow";

interface ContentTypeBadgeProps {
  type: ContentType;
  className?: string;
}

export function ContentTypeBadge({ type, className = "" }: ContentTypeBadgeProps) {
  return (
    <span
      className={`text-xs px-2 py-1 bg-[#F6F8FB] border border-[#E1E3E5] rounded text-[#0B1220] whitespace-nowrap ${className}`}
    >
      {getContentTypeLabel(type)}
    </span>
  );
}
