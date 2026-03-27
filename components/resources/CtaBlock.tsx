"use client";

import { trackResourceEvent } from "@/lib/resources/analytics";

export function CtaBlock({
  label,
  href,
  contentId,
  locale,
  ctaId,
  variant = "primary",
}: {
  label: string;
  href: string;
  contentId?: string;
  locale?: string;
  ctaId?: string;
  variant?: "primary" | "secondary";
}) {
  const cls =
    variant === "primary"
      ? "inline-flex items-center justify-center rounded-lg bg-[#1D4ED8] text-white px-5 py-2.5 text-sm font-medium hover:bg-[#1E40AF]"
      : "inline-flex items-center justify-center rounded-lg border border-[#E5E7EB] px-5 py-2.5 text-sm font-medium text-[#0B1220] hover:bg-[#F8FAFC]";

  return (
    <a
      href={href}
      className={cls}
      onClick={() =>
        trackResourceEvent({
          event: "resource_cta_click",
          contentId,
          locale,
          ctaId,
        })
      }
    >
      {label}
    </a>
  );
}
