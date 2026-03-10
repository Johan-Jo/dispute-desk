"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";

interface TemplateOriginCardProps {
  startedFromTemplateLabel: string;
  templateName: string;
  basedOnLabel: string;
  description: string;
  browseTemplatesHref: string;
  browseTemplatesLabel: string;
  templateBadgeLabel: string;
}

export function TemplateOriginCard({
  startedFromTemplateLabel,
  templateName,
  basedOnLabel,
  description,
  browseTemplatesHref,
  browseTemplatesLabel,
  templateBadgeLabel,
}: TemplateOriginCardProps) {
  return (
    <div className="bg-[#EFF6FF] rounded-xl border border-[#BFDBFE] p-5 mb-6">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-semibold text-[#1E40AF]">
          {startedFromTemplateLabel}
        </span>
        <Badge variant="info" className="text-xs">
          {templateName || templateBadgeLabel}
        </Badge>
      </div>
      <p className="font-medium text-[#0B1220] mb-1">
        {basedOnLabel}
      </p>
      <p className="text-sm text-[#667085] mb-3">{description}</p>
      <Link
        href={browseTemplatesHref}
        className="text-sm font-medium text-[#1D4ED8] hover:underline"
      >
        {browseTemplatesLabel}
      </Link>
    </div>
  );
}
