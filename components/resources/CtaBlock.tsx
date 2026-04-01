"use client";

import { Shield } from "lucide-react";
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

export function CtaCard({
  title,
  body,
  ctaLabel,
  ctaHref,
  secondaryCtaLabel,
  secondaryCtaHref,
  contentId,
  locale,
}: {
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  contentId?: string;
  locale?: string;
}) {
  return (
    <div className="mt-16 p-8 bg-white border-2 border-[#1D4ED8] rounded-2xl text-center">
      <Shield className="w-12 h-12 text-[#1D4ED8] mx-auto mb-4" />
      <h3 className="text-2xl font-bold text-[#0B1220] mb-3">{title}</h3>
      <p className="text-[#64748B] mb-6 max-w-2xl mx-auto">{body}</p>
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <a
          href={ctaHref}
          className="inline-flex items-center justify-center rounded-lg bg-[#1D4ED8] text-white px-6 py-3 text-sm font-medium hover:bg-[#1E40AF] transition-colors"
          onClick={() =>
            trackResourceEvent({
              event: "resource_cta_click",
              contentId,
              locale,
              ctaId: "card_cta",
            })
          }
        >
          {ctaLabel}
        </a>
        {secondaryCtaLabel && secondaryCtaHref ? (
          <a
            href={secondaryCtaHref}
            className="inline-flex items-center justify-center rounded-lg border border-[#E5E7EB] px-6 py-3 text-sm font-medium text-[#0B1220] hover:bg-[#F8FAFC] transition-colors"
            onClick={() =>
              trackResourceEvent({
                event: "resource_cta_click",
                contentId,
                locale,
                ctaId: "card_see_plans",
              })
            }
          >
            {secondaryCtaLabel}
          </a>
        ) : null}
      </div>
    </div>
  );
}
