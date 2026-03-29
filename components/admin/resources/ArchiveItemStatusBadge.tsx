"use client";

import type { ElementType } from "react";
import {
  CheckCircle,
  FileText,
  Lightbulb,
  ListTodo,
} from "lucide-react";
import { getArchiveItemStatusDisplay } from "@/lib/resources/archiveItemStatus";

const ICONS: Record<string, ElementType> = {
  idea: Lightbulb,
  backlog: ListTodo,
  brief_ready: FileText,
  converted: CheckCircle,
};

interface ArchiveItemStatusBadgeProps {
  status: string;
  className?: string;
  showIcon?: boolean;
}

export function ArchiveItemStatusBadge({
  status,
  className = "",
  showIcon = true,
}: ArchiveItemStatusBadgeProps) {
  const display = getArchiveItemStatusDisplay(status);
  const Icon = ICONS[status] ?? FileText;

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border font-medium ${className}`}
      style={{
        color: display.color,
        backgroundColor: display.bgColor,
        borderColor: display.borderColor,
      }}
    >
      {showIcon && <Icon className="w-3 h-3" />}
      {display.label}
    </span>
  );
}
