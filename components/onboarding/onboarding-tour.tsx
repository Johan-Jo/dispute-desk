"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { X, ArrowRight, ArrowLeft, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import type { OnboardingStep } from "@/lib/onboarding-config";

interface OnboardingTourProps {
  steps: OnboardingStep[];
  onComplete: () => void;
  onSkip: () => void;
  onNavigate: (path: string) => void;
}

export function OnboardingTour({
  steps,
  onComplete,
  onSkip,
  onNavigate,
}: OnboardingTourProps) {
  const t = useTranslations("onboarding");
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const step = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;
  const isFirstStep = currentStep === 0;

  const findTarget = useCallback(() => {
    if (!step?.targetSelector) {
      setTargetRect(null);
      return;
    }
    const el = document.querySelector(step.targetSelector);
    if (el) {
      const rect = el.getBoundingClientRect();
      setTargetRect(rect);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      setTargetRect(null);
    }
  }, [step]);

  useEffect(() => {
    if (step?.route) {
      onNavigate(step.route);
    }

    // Allow page navigation to settle before querying DOM
    const timer = setTimeout(findTarget, 400);
    return () => clearTimeout(timer);
  }, [currentStep, step, onNavigate, findTarget]);

  // Recompute position on resize/scroll
  useEffect(() => {
    if (!step?.targetSelector) return;

    const handleReposition = () => findTarget();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [step, findTarget]);

  const handleNext = () => {
    if (isLastStep) {
      onComplete();
      onNavigate("/portal/connect-shopify");
    } else {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (!isFirstStep) {
      setCurrentStep(currentStep - 1);
    }
  };

  const getTooltipPosition = (): React.CSSProperties => {
    if (!targetRect || !step?.targetSelector) {
      return {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      };
    }

    const padding = 24;
    const tooltipWidth = 448;
    const tooltipHeight = 300;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let pos = step.position ?? "bottom";

    const canTop = targetRect.top > tooltipHeight + padding;
    const canBottom = targetRect.bottom + tooltipHeight + padding < vh;
    const canLeft = targetRect.left > tooltipWidth + padding;
    const canRight = targetRect.right + tooltipWidth + padding < vw;

    if (pos === "left" && !canLeft)
      pos = canRight ? "right" : canBottom ? "bottom" : "top";
    else if (pos === "right" && !canRight)
      pos = canLeft ? "left" : canBottom ? "bottom" : "top";
    else if (pos === "top" && !canTop)
      pos = canBottom ? "bottom" : "center";
    else if (pos === "bottom" && !canBottom)
      pos = canTop ? "top" : "center";

    switch (pos) {
      case "top":
        return {
          top: `${targetRect.top - padding}px`,
          left: `${targetRect.left + targetRect.width / 2}px`,
          transform: "translate(-50%, -100%)",
        };
      case "bottom":
        return {
          top: `${targetRect.bottom + padding}px`,
          left: `${targetRect.left + targetRect.width / 2}px`,
          transform: "translate(-50%, 0)",
        };
      case "left":
        return {
          top: `${targetRect.top + targetRect.height / 2}px`,
          left: `${targetRect.left - padding}px`,
          transform: "translate(-100%, -50%)",
        };
      case "right":
        return {
          top: `${targetRect.top + targetRect.height / 2}px`,
          left: `${targetRect.right + padding}px`,
          transform: "translate(0, -50%)",
        };
      default:
        return {
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        };
    }
  };

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none">
      {/* Backdrop with optional spotlight cutout */}
      {targetRect && step?.spotlight ? (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-auto"
          onClick={onSkip}
        >
          <defs>
            <mask id="onboarding-spotlight-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              <rect
                x={targetRect.left - 8}
                y={targetRect.top - 8}
                width={targetRect.width + 16}
                height={targetRect.height + 16}
                rx="12"
                ry="12"
                fill="black"
              />
            </mask>
          </defs>
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="rgba(0, 0, 0, 0.5)"
            mask="url(#onboarding-spotlight-mask)"
          />
        </svg>
      ) : (
        <div
          className="absolute inset-0 bg-black/30 backdrop-blur-[2px] pointer-events-auto"
          onClick={onSkip}
        />
      )}

      {/* Highlight ring */}
      {targetRect && step?.spotlight && (
        <div
          className="absolute pointer-events-none animate-pulse"
          style={{
            top: `${targetRect.top - 8}px`,
            left: `${targetRect.left - 8}px`,
            width: `${targetRect.width + 16}px`,
            height: `${targetRect.height + 16}px`,
            borderRadius: "12px",
            border: "3px solid #1D4ED8",
            boxShadow:
              "0 0 30px rgba(29, 78, 216, 0.6), inset 0 0 0 2px rgba(255, 255, 255, 0.2)",
            transition: "all 0.3s ease",
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        className="absolute pointer-events-auto bg-white rounded-xl shadow-2xl max-w-md w-full mx-4"
        style={{
          ...getTooltipPosition(),
          animation: "onboarding-fade-in 0.3s ease-out",
        }}
      >
        <div className="p-6">
          {/* Progress bar */}
          <div className="flex items-center gap-2 mb-4">
            {steps.map((_, index) => (
              <div
                key={index}
                className={`h-1.5 rounded-full flex-1 transition-colors ${
                  index <= currentStep ? "bg-[#1D4ED8]" : "bg-[#E5E7EB]"
                }`}
              />
            ))}
          </div>

          {/* Content */}
          <div className="mb-6">
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-xl font-bold text-[#0B1220] pr-4">
                {t(`${step.id}Title`)}
              </h3>
              <button
                onClick={onSkip}
                className="text-[#667085] hover:text-[#0B1220] transition-colors flex-shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-[#667085] leading-relaxed">
              {t(`${step.id}Desc`)}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {!isFirstStep && (
                <Button variant="ghost" size="sm" onClick={handlePrevious}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  {t("previous")}
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onSkip}>
                {t("skipTour")}
              </Button>
              <Button variant="primary" size="sm" onClick={handleNext}>
                {isLastStep ? (
                  <>
                    <ArrowRight className="w-4 h-4 mr-2" />
                    {t("connectStore")}
                  </>
                ) : (
                  <>
                    {t("next")}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Step counter */}
          <div className="text-center text-sm text-[#667085] mt-4">
            {t("stepOf", { current: currentStep + 1, total: steps.length })}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes onboarding-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
