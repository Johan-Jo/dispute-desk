const DEFAULT_COLORS: Record<string, { bg: string; text: string }> = {
  active: { bg: "bg-[#D1FAE5]", text: "text-[#065F46]" },
  mapped: { bg: "bg-[#D1FAE5]", text: "text-[#065F46]" },
  success: { bg: "bg-[#D1FAE5]", text: "text-[#065F46]" },
  completed: { bg: "bg-[#D1FAE5]", text: "text-[#065F46]" },
  running: { bg: "bg-[#DBEAFE]", text: "text-[#1E40AF]" },
  queued: { bg: "bg-[#DBEAFE]", text: "text-[#1E40AF]" },
  draft: { bg: "bg-[#F1F5F9]", text: "text-[#475569]" },
  archived: { bg: "bg-[#F1F5F9]", text: "text-[#475569]" },
  inactive: { bg: "bg-[#F1F5F9]", text: "text-[#475569]" },
  uninstalled: { bg: "bg-[#FEE2E2]", text: "text-[#991B1B]" },
  failed: { bg: "bg-[#FEE2E2]", text: "text-[#991B1B]" },
  unmapped: { bg: "bg-[#FEE2E2]", text: "text-[#991B1B]" },
  "deprecated-target": { bg: "bg-[#FEE2E2]", text: "text-[#991B1B]" },
  warning: { bg: "bg-[#FEF3C7]", text: "text-[#92400E]" },
  enterprise: { bg: "bg-[#EDE9FE]", text: "text-[#6B21A8]" },
  professional: { bg: "bg-[#DBEAFE]", text: "text-[#1E40AF]" },
  starter: { bg: "bg-[#D1FAE5]", text: "text-[#065F46]" },
  trial: { bg: "bg-[#F1F5F9]", text: "text-[#475569]" },
  free: { bg: "bg-[#F1F5F9]", text: "text-[#475569]" },
};

interface StatusPillProps {
  status: string;
  label?: string;
  colorMap?: Record<string, { bg: string; text: string }>;
}

export function StatusPill({ status, label, colorMap }: StatusPillProps) {
  const colors =
    colorMap?.[status] ??
    DEFAULT_COLORS[status.toLowerCase()] ?? {
      bg: "bg-[#F1F5F9]",
      text: "text-[#475569]",
    };

  const displayLabel = label ?? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");

  return (
    <span
      className={`inline-flex px-2.5 py-1 ${colors.bg} ${colors.text} text-xs font-semibold rounded-full`}
    >
      {displayLabel}
    </span>
  );
}
