"use client";

import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { X, ArrowRight } from "lucide-react";
import { cn } from "@/components/ui/utils";

/**
 * Spotlight guided tour.
 *
 * Each step targets a DOM selector inside the rendered page. When active,
 * the page is dimmed via a full-screen dark overlay with a transparent
 * cut-out around the target element. The target gets a 4px purple ring
 * + elevated z-index so it pops forward. A callout floats next to the
 * target with the step copy + Next button.
 *
 * Tour steps live in TOUR_STEPS. Selectors are CSS strings — typically
 * `[data-tour="..."]` or `[data-help-guide="..."]`. If the selector
 * doesn't resolve (target hasn't mounted yet, wrong tab, ...), the
 * step gracefully degrades to a centered modal so the tour doesn't
 * stall waiting for an element that may never appear.
 */

export interface TourStep {
  step: number;
  /** Headline shown in the callout. */
  title: string;
  /** Body text in the callout. */
  body: string;
  /** Path the user must be on for this step. */
  path: string;
  /** CSS selector for the element to highlight. Null = centered modal
   *  (no highlight, dimmed background, callout in the middle). */
  selector: string | null;
  /** Selector to click before showing the step. Used to switch tabs
   *  inside WorkspaceShell. Null = no click. */
  preClickSelector?: string | null;
  /** Where to navigate when Next is pressed. Null = no nav (still
   *  advances the step counter). */
  nextPath: string | null;
  /** Whether the Next button reads "Install →" instead. */
  isFinalStep?: boolean;
}

export const TOUR_STEPS: TourStep[] = [
  // ─── Hero dispute detail — Overview tab (3 steps) ────────────────────────
  {
    step: 1,
    title: "DisputeDesk detects the dispute",
    body: "When a customer files a chargeback in Shopify Payments, DisputeDesk receives the webhook within seconds and starts collecting evidence automatically.",
    path: "/demo/disputes/dp-2401",
    selector: '[data-help-guide="detail-header"]',
    preClickSelector: '[data-help-guide="detail-tab-overview"]',
    nextPath: "/demo/disputes/dp-2401",
  },
  {
    step: 2,
    title: "Case strength at a glance",
    body: "Strong, Moderate, or Weak — based on AVS/CVV matches, 3-D Secure status, fulfillment data, and customer history. This case is Strong, so DisputeDesk can auto-submit once you approve.",
    path: "/demo/disputes/dp-2401",
    selector: '[data-help-guide="detail-overview-hero"]',
    preClickSelector: '[data-help-guide="detail-tab-overview"]',
    nextPath: "/demo/disputes/dp-2401",
  },
  {
    step: 3,
    title: "Evidence collected automatically",
    body: "8 evidence signals were pulled from Shopify Payments, AfterShip, IPinfo, and the customer's order history — in 4 seconds, with zero merchant input.",
    path: "/demo/disputes/dp-2401",
    selector: '[data-help-guide="detail-overview-evidence"]',
    preClickSelector: '[data-help-guide="detail-tab-overview"]',
    nextPath: "/demo/disputes/dp-2401",
  },

  // ─── Hero dispute detail — Evidence tab (2 steps) ────────────────────────
  {
    step: 4,
    title: "Every piece of evidence, scored",
    body: "Each item is graded by how the card networks weigh it. Strong rows (green) make up your bank argument; moderate rows (amber) add context; weak rows stay internal so they can't hurt you.",
    path: "/demo/disputes/dp-2401",
    selector: '[data-tour="evidence-used"]',
    preClickSelector: '[data-help-guide="detail-tab-evidence"]',
    nextPath: "/demo/disputes/dp-2401",
  },

  // ─── Hero dispute detail — Review & Submit tab (2 steps) ─────────────────
  // Tab id is `submit` (not `review`) — see WorkspaceShell.tsx tabs array.
  {
    step: 5,
    title: "The defence package",
    body: "DisputeDesk generates a bank-optimised PDF and maps each evidence field to the correct Shopify evidence slot. You review before submission — or let auto-mode handle Strong cases.",
    path: "/demo/disputes/dp-2401",
    selector: '[data-tour="review-defence-package"]',
    preClickSelector: '[data-help-guide="detail-tab-submit"]',
    nextPath: "/demo/disputes/dp-2401",
  },
  {
    step: 6,
    title: "Final inclusion review",
    body: "Every row that goes to the bank is listed here. You can override DisputeDesk's calls if you have additional context. The defence package is regenerated on every change.",
    path: "/demo/disputes/dp-2401",
    selector: '[data-tour="review-inclusion"]',
    preClickSelector: '[data-help-guide="detail-tab-submit"]',
    nextPath: "/demo/disputes",
  },

  // ─── Disputes list (1 step) ──────────────────────────────────────────────
  {
    step: 7,
    title: "All your disputes, one queue",
    body: "Strong cases ready to submit. Covered cases (Shopify Protect). Fatal-loss cases blocked. Weak cases parked for your input. You always know what needs you.",
    path: "/demo/disputes",
    selector: '[data-help-guide="disputes-table"]',
    nextPath: "/demo/install",
  },

  // ─── Install conversion (1 step) ─────────────────────────────────────────
  {
    step: 8,
    title: "Install DisputeDesk on your store",
    body: "14-day free trial. No success fees. Connect in two clicks from the Shopify App Store.",
    path: "/demo/install",
    selector: null, // centered modal — install page has its own CTA
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

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Hook: poll for an element matching `selector` and return its bounding
 *  rect (live, updates on resize/scroll). Returns null when not found. */
function useTargetRect(selector: string | null, deps: unknown[]): TargetRect | null {
  const [rect, setRect] = useState<TargetRect | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selector) {
      setRect(null);
      return;
    }
    let cancelled = false;
    let raf: number | undefined;

    const measure = () => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) {
        setRect(null);
        return false;
      }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      return true;
    };

    // Poll up to 60 frames (~1s) waiting for the target to mount, then
    // give up and fall back to centered modal.
    let attempts = 0;
    const tryMeasure = () => {
      if (cancelled) return;
      if (measure() || attempts++ > 60) return;
      raf = requestAnimationFrame(tryMeasure);
    };
    tryMeasure();

    // After the target is found, keep the rect fresh on scroll/resize.
    const onChange = () => measure();
    window.addEventListener("scroll", onChange, { passive: true, capture: true });
    window.addEventListener("resize", onChange);

    // Re-measure every 500ms in case Polaris layouts shift after data load.
    const interval = setInterval(measure, 500);

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onChange, { capture: true });
      window.removeEventListener("resize", onChange);
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selector, ...deps]);
  return rect;
}

export function GuidedTourCallout() {
  const router = useRouter();
  const pathname = usePathname();
  const { currentStep, setStep, dismissed, dismiss } = useGuidedTour();
  const preClickedRef = useRef<string | null>(null);
  const scrolledForStepRef = useRef<number | null>(null);
  // SSR + client read different window/document state (rect positions,
  // viewportHeight, target presence) so the rendered HTML can't match
  // hydration. Defer the entire overlay to post-mount on the client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const step = TOUR_STEPS.find((s) => s.step === currentStep);
  const stepActiveOnThisPage = mounted && !!step && step.path === pathname && !dismissed;

  // Auto-scroll the target into view when the step changes. Runs once
  // per step (tracked via scrolledForStepRef) so re-renders from rect
  // updates don't keep yanking the page back. The retry loop waits for
  // the target to mount (handles tab-switch + Polaris's deferred render).
  useEffect(() => {
    if (!stepActiveOnThisPage || !step?.selector) {
      scrolledForStepRef.current = null;
      return;
    }
    if (scrolledForStepRef.current === step.step) return;

    let cancelled = false;
    let attempts = 0;
    const trigger = () => {
      if (cancelled) return;
      const el = document.querySelector(step.selector!) as HTMLElement | null;
      if (el) {
        // Scroll so the target sits ~80px from the top of the viewport
        // — keeps the spotlit element high enough that the callout
        // below (which can be ~300px tall) stays fully on-screen.
        // Falls back to scrollIntoView for short pages where the
        // manual offset would over-scroll.
        const rect = el.getBoundingClientRect();
        const TOP_MARGIN = 80;
        const scrollContainer =
          document.scrollingElement ?? document.documentElement;
        const targetScroll = scrollContainer.scrollTop + rect.top - TOP_MARGIN;
        scrollContainer.scrollTo({ top: Math.max(0, targetScroll), behavior: "smooth" });
        scrolledForStepRef.current = step.step;
        return;
      }
      if (attempts++ < 30) {
        setTimeout(trigger, 100);
      }
    };
    // Give pre-click (tab switch) a beat to render, then scroll.
    const delay = step.preClickSelector ? 200 : 0;
    const timer = setTimeout(trigger, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [stepActiveOnThisPage, step]);

  // Pre-click the tab button for steps that target a different tab.
  // Runs whenever the active step / pathname changes.
  useEffect(() => {
    if (!stepActiveOnThisPage || !step?.preClickSelector) return;
    // Dedupe: only click if we haven't already for this step.
    const key = `${step.step}:${step.preClickSelector}`;
    if (preClickedRef.current === key) return;
    const target = document.querySelector(step.preClickSelector) as HTMLElement | null;
    if (target) {
      target.click();
      preClickedRef.current = key;
    }
  }, [stepActiveOnThisPage, step]);

  // Auto-advance the visible step when the user navigates to a page the tour expects.
  useEffect(() => {
    if (dismissed) return;
    const matchingStep = TOUR_STEPS.find((s) => s.path === pathname);
    if (matchingStep && matchingStep.step > currentStep) {
      setStep(matchingStep.step);
    }
  }, [pathname, dismissed, currentStep, setStep]);

  const rect = useTargetRect(stepActiveOnThisPage ? step?.selector ?? null : null, [currentStep]);

  const handleNext = useCallback(() => {
    if (!step) return;
    const next = TOUR_STEPS.find((s) => s.step === step.step + 1);
    if (next) setStep(next.step);
    if (step.nextPath && step.nextPath !== pathname) {
      router.push(step.nextPath);
    }
  }, [step, pathname, router, setStep]);

  if (!stepActiveOnThisPage || !step) return null;

  // Spotlight rendering — falls back to centered modal when no target.
  const PADDING = 8;
  const hasTarget = !!rect;
  const targetTop = hasTarget ? rect!.top - PADDING : 0;
  const targetLeft = hasTarget ? rect!.left - PADDING : 0;
  const targetWidth = hasTarget ? rect!.width + PADDING * 2 : 0;
  const targetHeight = hasTarget ? rect!.height + PADDING * 2 : 0;

  // Callout placement: prefer below the target; if it'd overflow,
  // try above; if that also overflows, pin to whichever edge gives
  // more room. Vertical position is always clamped to the viewport
  // with a 16px margin so the callout never drifts off-screen.
  const CALLOUT_MAX_WIDTH = 480;
  const CALLOUT_ESTIMATED_HEIGHT = 280;
  const VIEWPORT_MARGIN = 16;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1200;
  const fitsBelow = hasTarget && targetTop + targetHeight + 16 + CALLOUT_ESTIMATED_HEIGHT + VIEWPORT_MARGIN < viewportHeight;
  const fitsAbove = hasTarget && targetTop - 16 - CALLOUT_ESTIMATED_HEIGHT - VIEWPORT_MARGIN > 0;
  let calloutTop: number;
  if (!hasTarget) {
    calloutTop = viewportHeight / 2 - CALLOUT_ESTIMATED_HEIGHT / 2;
  } else if (fitsBelow) {
    calloutTop = targetTop + targetHeight + 16;
  } else if (fitsAbove) {
    calloutTop = targetTop - CALLOUT_ESTIMATED_HEIGHT - 16;
  } else {
    // Tall target — pin callout to the bottom of the viewport with
    // 16px margin. Better to overlap the target than to disappear.
    calloutTop = viewportHeight - CALLOUT_ESTIMATED_HEIGHT - VIEWPORT_MARGIN;
  }
  // Final clamp so callout always sits in [VIEWPORT_MARGIN, viewportHeight - CALLOUT_ESTIMATED_HEIGHT - VIEWPORT_MARGIN]
  calloutTop = Math.max(
    VIEWPORT_MARGIN,
    Math.min(viewportHeight - CALLOUT_ESTIMATED_HEIGHT - VIEWPORT_MARGIN, calloutTop),
  );
  const calloutLeftCentered = !hasTarget
    ? viewportWidth / 2 - CALLOUT_MAX_WIDTH / 2
    : Math.max(16, Math.min(viewportWidth - CALLOUT_MAX_WIDTH - 16, targetLeft + targetWidth / 2 - CALLOUT_MAX_WIDTH / 2));

  return (
    <>
      {/* Dark overlay with cutout. Use SVG mask so the cutout has soft
          rounded corners. When no target, the overlay covers everything. */}
      <svg
        className="fixed inset-0 z-50 pointer-events-none"
        width="100%"
        height="100%"
        style={{ width: "100vw", height: "100vh" }}
      >
        <defs>
          <mask id="dd-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {hasTarget && (
              <rect
                x={targetLeft}
                y={targetTop}
                width={targetWidth}
                height={targetHeight}
                rx={8}
                ry={8}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(11, 18, 32, 0.7)" mask="url(#dd-tour-mask)" />
      </svg>

      {/* Glowing ring around the target — separate from the overlay so
          it sits above the cutout and animates smoothly. */}
      {hasTarget && (
        <div
          className="fixed z-50 pointer-events-none transition-all duration-300"
          style={{
            top: targetTop,
            left: targetLeft,
            width: targetWidth,
            height: targetHeight,
            borderRadius: 8,
            boxShadow: "0 0 0 4px #7C3AED, 0 0 0 8px rgba(124, 58, 237, 0.3), 0 8px 32px rgba(124, 58, 237, 0.4)",
          }}
        />
      )}

      {/* Callout card */}
      <div
        className="fixed z-50 pointer-events-auto"
        style={{
          top: calloutTop,
          left: calloutLeftCentered,
          width: CALLOUT_MAX_WIDTH,
          maxWidth: "calc(100vw - 32px)",
        }}
      >
        <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-2xl p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                {TOUR_STEPS.map((s) => (
                  <div
                    key={s.step}
                    className={cn(
                      "h-1.5 rounded-full transition-all",
                      s.step === currentStep ? "w-6 bg-[#7C3AED]" : s.step < currentStep ? "w-1.5 bg-[#7C3AED]/40" : "w-1.5 bg-[#E5E7EB]",
                    )}
                  />
                ))}
              </div>
              <span className="text-xs font-semibold uppercase tracking-wider text-[#7C3AED] ml-1">
                {currentStep} / {TOUR_STEPS.length}
              </span>
            </div>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss tour"
              className="text-[#9CA3AF] hover:text-[#0B1220] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <h3 className="text-lg font-semibold text-[#0B1220] mb-2">{step.title}</h3>
          <p className="text-sm text-[#4B5563] leading-relaxed mb-5">{step.body}</p>
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={dismiss}
              className="text-xs text-[#6B7280] hover:text-[#0B1220] transition-colors"
            >
              Skip the tour
            </button>
            {step.isFinalStep ? (
              <a
                href={process.env.NEXT_PUBLIC_SHOPIFY_APP_STORE_URL?.trim() || "https://disputedesk.app/install"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 h-10 px-5 rounded-lg text-sm font-semibold bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition-colors"
              >
                Install DisputeDesk
                <ArrowRight className="w-3.5 h-3.5" />
              </a>
            ) : (
              <button
                type="button"
                onClick={handleNext}
                className="inline-flex items-center gap-1.5 h-10 px-5 rounded-lg text-sm font-semibold bg-[#0B1220] text-white hover:bg-[#1F2937] transition-colors"
              >
                Next
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
