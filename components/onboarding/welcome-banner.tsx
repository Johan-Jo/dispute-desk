"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, X } from "lucide-react";
import { useOnboarding } from "./onboarding-provider";
import { useDemoMode } from "@/lib/demo-mode";

export function WelcomeBanner() {
  const isDemo = useDemoMode();
  const { hasCompletedOnboarding, hasDismissedBanner, startTour, dismissBanner } =
    useOnboarding();
  const [sessionDismissed, setSessionDismissed] = useState(false);

  if (isDemo) {
    if (sessionDismissed) return null;
  } else {
    if (hasCompletedOnboarding || hasDismissedBanner) return null;
  }

  const handleDismiss = () => {
    setSessionDismissed(true);
    dismissBanner();
  };

  return (
    <div className="relative mb-6 bg-gradient-to-r from-[#1D4ED8] via-[#2563EB] to-[#3B82F6] rounded-xl p-6 overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 opacity-10 pointer-events-none">
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-white rounded-full blur-3xl" />
        <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-white rounded-full blur-3xl" />
      </div>

      <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-5 h-5 text-white" />
            <h3 className="text-lg font-semibold text-white">
              Welcome to DisputeDesk!
            </h3>
          </div>
          <p className="text-blue-100 mb-4 sm:mb-0">
            Take a quick 2-minute tour to learn how to manage chargebacks like a
            pro.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={startTour}
            className="bg-white text-[#1D4ED8] hover:bg-blue-50"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Start Tour
          </Button>
          <button
            onClick={handleDismiss}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
