import { AlertCircle, Info, CheckCircle, XCircle } from "lucide-react";

export interface InfoBannerProps {
  variant?: "info" | "warning" | "success" | "danger";
  title?: string;
  children: React.ReactNode;
  onDismiss?: () => void;
}

const VARIANTS = {
  info: {
    bg: "bg-[#EFF6FF]",
    border: "border-[#BFDBFE]",
    text: "text-[#1E40AF]",
    Icon: Info,
  },
  warning: {
    bg: "bg-[#FFFBEB]",
    border: "border-[#FDE68A]",
    text: "text-[#92400E]",
    Icon: AlertCircle,
  },
  success: {
    bg: "bg-[#ECFDF5]",
    border: "border-[#A7F3D0]",
    text: "text-[#065F46]",
    Icon: CheckCircle,
  },
  danger: {
    bg: "bg-[#FEF2F2]",
    border: "border-[#FECACA]",
    text: "text-[#991B1B]",
    Icon: XCircle,
  },
} as const;

export function InfoBanner({
  variant = "info",
  title,
  children,
  onDismiss,
}: InfoBannerProps) {
  const v = VARIANTS[variant];

  return (
    <div className={`${v.bg} ${v.border} border rounded-lg p-4`}>
      <div className="flex gap-3">
        <div className={v.text}>
          <v.Icon className="w-5 h-5" />
        </div>
        <div className="flex-1">
          {title && (
            <h4 className={`font-semibold ${v.text} mb-1`}>{title}</h4>
          )}
          <div className={`text-sm ${v.text}`}>{children}</div>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className={`${v.text} hover:opacity-70 transition-opacity`}
          >
            <XCircle className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}
