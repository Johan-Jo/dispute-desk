"use client";

import { createContext, useContext, useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { X, ArrowRight } from "lucide-react";
import { cn } from "@/components/ui/utils";

export interface TourStep {
  /** Step number (1-indexed). */
  step: number;
  /** Headline shown in the callout. */
  title: string;
  /** Body text in the callout. */
  body: string;
  /** Path the user must be on for this step. */
  path: string;
  /** Where to advance on "Next →". */
  nextPath: string | null;
  /** Whether the Next button reads "Install →" instead. */
  isFinalStep?: boolean;
}

export const TOUR_STEPS: TourStep[] = [
  {
    step: 1,
    title: "DisputeDesk detects the dispute",
    body: "When a customer files a chargeback in Shopify Payments, DisputeDesk receives the webhook within seconds and starts collecting evidence automatically.",
    path: "/demo/disputes/dp-2401",
    nextPath: "/demo/disputes/dp-2401",
  },
  {
    step: 2,
    title: "Evidence is collected automatically",
    body: "8 evidence signals were pulled from Shopify Payments, AfterShip, IPinfo, and the customer's order history — in 4 seconds, with zero merchant input.",
    path: "/demo/disputes/dp-2401",
    nextPath: "/demo/disputes/dp-2401",
  },
  {
    step: 3,
    title: "Case strength is calculated",
    body: "Strong, Moderate, or Weak — based on AVS/CVV matches, 3-D Secure status, fulfillment data, and customer history. Strong cases can auto-submit; weak ones park for review.",
    path: "/demo/disputes/dp-2401",
    nextPath: "/demo/disputes/dp-2401",
  },
  {
    step: 4,
    title: "Review what will be submitted",
    body: "Every evidence field is mapped to a Shopify evidence slot. The bank-optimised narrative is plain text — no jargon, no hedging, no merchant confessions.",
    path: "/demo/disputes/dp-2401",
    nextPath: "/demo/disputes",
  },
  {
    step: 5,
    title: "All disputes in one place",
    body: "Strong cases ready to submit. Covered cases (Shopify Protect). Fatal-loss cases blocked. Weak cases parked for your input. You always know what needs you.",
    path: "/demo/disputes",
    nextPath: "/demo/install",
  },
  {
    step: 6,
    title: "Install DisputeDesk to use this on your own store",
    body: "14-day free trial. No success fees. Connect in two clicks from the Shopify App Store.",
    path: "/demo/install",
    nextPath: null,
    isFinalStep: true,
  },
];

interface GuidedTourContextValue {
  currentStep: number;
  setStep: (step: number) => void;
  dismissed: boolean;
  dismiss: () => void;
  restart: () => void;
}

const GuidedTourContext = createContext<GuidedTourContextValue | null>(null);

export function GuidedTourProvider({ children }: { children: React.ReactNode }) {
  const [currentStep, setCurrentStep] = useState(1);
  const [dismissed, setDismissed] = useState(false);

  return (
    <GuidedTourContext.Provider
      value={{
        currentStep,
        setStep: setCurrentStep,
        dismissed,
        dismiss: () => setDismissed(true),
        restart: () => {
          setCurrentStep(1);
          setDismissed(false);
        },
      }}
    >
      {children}
    </GuidedTourContext.Provider>
  );
}

export function useGuidedTour(): GuidedTourContextValue {
  const ctx = useContext(GuidedTourContext);
  if (!ctx) {
    return {
      currentStep: 1,
      setStep: () => {},
      dismissed: true,
      dismiss: () => {},
      restart: () => {},
    };
  }
  return ctx;
}

export function GuidedTourCallout() {
  const router = useRouter();
  const pathname = usePathname();
  const { currentStep, setStep, dismissed, dismiss } = useGuidedTour();

  // Auto-advance the visible step when the user navigates to a page the tour expects
  useEffect(() => {
    if (dismissed) return;
    const matchingStep = TOUR_STEPS.find((s) => s.path === pathname);
    if (matchingStep && matchingStep.step > currentStep) {
      setStep(matchingStep.step);
    }
  }, [pathname, dismissed, currentStep, setStep]);

  if (dismissed) return null;

  const step = TOUR_STEPS.find((s) => s.step === currentStep);
  if (!step) return null;

  // Only render if we're on the right page for this step
  if (step.path !== pathname) return null;

  const handleNext = () => {
    const next = TOUR_STEPS.find((s) => s.step === step.step + 1);
    // Advance the visible step number FIRST so re-render under the new
    // pathname doesn't fall back to an earlier step. The auto-advance
    // useEffect only moves forward, never back, so this is safe.
    if (next) setStep(next.step);
    if (step.nextPath && step.nextPath !== pathname) {
      router.push(step.nextPath);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 pointer-events-none">
      <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-2xl p-10 pointer-events-auto w-full max-w-2xl">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              {TOUR_STEPS.map((s) => (
                <div
                  key={s.step}
                  className={cn(
                    "h-2 rounded-full transition-all",
                    s.step === currentStep ? "w-8 bg-[#7C3AED]" : s.step < currentStep ? "w-2 bg-[#7C3AED]/40" : "w-2 bg-[#E5E7EB]",
                  )}
                />
              ))}
            </div>
            <span className="text-sm font-semibold uppercase tracking-wider text-[#7C3AED] ml-1">
              Step {currentStep} of {TOUR_STEPS.length}
            </span>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss tour"
            className="text-[#9CA3AF] hover:text-[#0B1220] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <h3 className="text-2xl font-semibold text-[#0B1220] mb-3">{step.title}</h3>
        <p className="text-base text-[#4B5563] leading-relaxed mb-8">{step.body}</p>
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={dismiss}
            className="text-sm text-[#6B7280] hover:text-[#0B1220] transition-colors"
          >
            Skip the tour
          </button>
          {step.isFinalStep ? (
            <a
              href={process.env.NEXT_PUBLIC_SHOPIFY_APP_STORE_URL?.trim() || "https://disputedesk.app/install"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 h-11 px-6 rounded-lg text-base font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition-colors"
            >
              Install DisputeDesk
              <ArrowRight className="w-4 h-4" />
            </a>
          ) : (
            <button
              type="button"
              onClick={handleNext}
              className="inline-flex items-center gap-2 h-11 px-6 rounded-lg text-base font-medium bg-[#0B1220] text-white hover:bg-[#1F2937] transition-colors"
            >
              Next
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
