"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PackLimitBannerProps {
  remaining: number;
  onUpgrade?: () => void;
  onTopUp?: () => void;
}

/**
 * Shows when a shop is at or near their pack credit limit.
 * Renders inline (not a modal) to avoid blocking the workflow.
 */
export function PackLimitBanner({ remaining, onUpgrade, onTopUp }: PackLimitBannerProps) {
  if (remaining > 0) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-[#FBBF24] bg-[#FFFBEB] p-4">
      <AlertTriangle className="h-5 w-5 text-[#F59E0B] flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-sm font-medium text-[#92400E]">
          Pack limit reached
        </p>
        <p className="text-sm text-[#92400E]/80 mt-1">
          You have no remaining pack credits. Drafts are still unlimited&nbsp;&mdash;
          but exporting or submitting requires credits.
        </p>
        <div className="flex gap-2 mt-3">
          {onUpgrade && (
            <Button variant="primary" size="sm" onClick={onUpgrade}>
              Upgrade plan
            </Button>
          )}
          {onTopUp && (
            <Button variant="secondary" size="sm" onClick={onTopUp}>
              Buy top-up
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
