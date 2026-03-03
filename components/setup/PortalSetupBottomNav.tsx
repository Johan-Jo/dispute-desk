"use client";

import { Button } from "@/components/ui/button";

interface PortalSetupBottomNavProps {
  onBack?: () => void;
  onSaveAndContinue: () => void;
  onSkip?: () => void;
  isFirst: boolean;
  isLast: boolean;
  saving?: boolean;
}

export function PortalSetupBottomNav({
  onBack,
  onSaveAndContinue,
  onSkip,
  isFirst,
  isLast,
  saving,
}: PortalSetupBottomNavProps) {
  return (
    <div className="border-t border-[#E5E7EB] pt-4 mt-6">
      <div className="flex justify-between items-center gap-3">
        <div>
          {!isFirst && onBack && (
            <Button variant="secondary" onClick={onBack}>
              ← Back
            </Button>
          )}
        </div>
        <div className="flex gap-3">
          {!isLast && onSkip && (
            <Button variant="ghost" onClick={onSkip}>
              Skip for now
            </Button>
          )}
          <Button
            variant="primary"
            onClick={onSaveAndContinue}
            disabled={saving}
          >
            {saving ? "Saving…" : isLast ? "Finish Setup" : "Save & Continue →"}
          </Button>
        </div>
      </div>
    </div>
  );
}
