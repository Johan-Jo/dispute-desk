"use client";

import {
  CheckCircle,
  Clock,
  Eye,
  Edit,
  Globe,
  FileText,
  Send,
  Archive,
  Lightbulb,
  ListTodo,
  Scale,
} from "lucide-react";
import type { WorkflowStatus } from "@/lib/resources/workflow";
import { getStatusDisplay } from "@/lib/resources/workflow";

const STATUS_ICONS: Record<WorkflowStatus, React.ElementType> = {
  idea: Lightbulb,
  backlog: ListTodo,
  "brief-ready": FileText,
  drafting: Edit,
  "in-translation": Globe,
  "in-editorial-review": Eye,
  "in-legal-review": Scale,
  approved: CheckCircle,
  scheduled: Clock,
  published: CheckCircle,
  archived: Archive,
};

interface WorkflowStatusBadgeProps {
  status: WorkflowStatus;
  className?: string;
  showIcon?: boolean;
}

export function WorkflowStatusBadge({
  status,
  className = "",
  showIcon = true,
}: WorkflowStatusBadgeProps) {
  const display = getStatusDisplay(status);
  const Icon = STATUS_ICONS[status] ?? FileText;

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
