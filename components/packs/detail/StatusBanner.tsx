"use client";

type Variant = "draft" | "template" | "saved" | "ready" | "submitted" | "info";

interface StatusBannerProps {
  variant: Variant;
  message: string;
}

const variantStyles: Record<Variant, string> = {
  draft: "bg-[#F8FAFC] border-[#E2E8F0] text-[#475569]",
  template: "bg-[#EFF6FF] border-[#BFDBFE] text-[#1E40AF]",
  saved: "bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]",
  ready: "bg-[#EFF6FF] border-[#BFDBFE] text-[#1E40AF]",
  submitted: "bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]",
  info: "bg-[#EFF6FF] border-[#BFDBFE] text-[#1E40AF]",
};

export function StatusBanner({ variant, message }: StatusBannerProps) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 text-sm ${variantStyles[variant]}`}
      role="status"
    >
      {message}
    </div>
  );
}
