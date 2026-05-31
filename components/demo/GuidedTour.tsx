"use client";

import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { X, ArrowRight } from "lucide-react";
import { cn } from "@/components/ui/utils";
import { InstallModal } from "./InstallModal";

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
  /** Optional custom finder for elements that can't be matched by a
   *  CSS selector (e.g. find by heading text). Used when the
   *  embedded code doesn't expose a stable selector for the section
   *  we want to spotlight. Runs after the selector check; both are
   *  retried via the same polling loop. */
  findElement?: () => HTMLElement | null;
  /** Selector to click before showing the step. Used to switch tabs
   *  inside WorkspaceShell. Null = no click. */
  preClickSelector?: string | null;
  /** Where to navigate when Next is pressed. Null = no nav (still
   *  advances the step counter). */
  nextPath: string | null;
  /** Whether the Next button reads "Install →" instead. */
  isFinalStep?: boolean;
}

/** Find a card wrapper by h2 text PREFIX (handles slight wording
 *  differences). Tries multiple ancestor selectors in order, falls
 *  back to the h2's grandparent so we always return something. */
function findCardByHeadingPrefix(textPrefix: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const headings = document.querySelectorAll("h2");
  for (const h of Array.from(headings)) {
    const text = h.textContent?.trim() ?? "";
    if (!text.toLowerCase().startsWith(textPrefix.toLowerCase())) continue;
    // Try each Polaris card class.
    const legacy = h.closest(".Polaris-LegacyCard") as HTMLElement | null;
    if (legacy) return legacy;
    const card = h.closest(".Polaris-Card") as HTMLElement | null;
    if (card) return card;
    // Walk up looking for an element that has a border-radius (the
    // signature of a card-style div, regardless of wrapper component).
    let node: HTMLElement | null = h.parentElement;
    let attempts = 0;
    while (node && node !== document.body && attempts++ < 6) {
      const rect = node.getBoundingClientRect();
      const cs = window.getComputedStyle(node);
      if (cs.borderRadius && cs.borderRadius !== "0px" && rect.width > 200) {
        return node;
      }
      node = node.parentElement;
    }
    // Last resort: heading's grandparent (gives a smaller spotlight).
    return h.parentElement?.parentElement ?? h.parentElement;
  }
  return null;
}

/** Find the KPI card wrapper (DashboardKpis outer div with white
 *  background + 1px border). Walks up from the Performance overview
 *  h2 until it finds an ancestor with a border-radius set inline
 *  (the wrapper's `borderRadius: 12px`). Fallback: closest Polaris-Card
 *  if it's inside one, else the h2's grandparent. */
function findKpiCardByHeading(headingText: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const headings = document.querySelectorAll("h2");
  for (const h of Array.from(headings)) {
    if (h.textContent?.trim() !== headingText) continue;
    // Walk up looking for the outer div with border-radius set inline.
    let node: HTMLElement | null = h.parentElement;
    let attempts = 0;
    while (node && node !== document.body && attempts++ < 8) {
      if (node.style.borderRadius && node.style.border) {
        return node;
      }
      node = node.parentElement;
    }
    // Fallback: closest Polaris-Card, else heading's parent.
    return (h.closest(".Polaris-LegacyCard") as HTMLElement | null) ?? h.parentElement;
  }
  return null;
}

/** Find a "card" element by walking up from a heading match until we
 *  hit an ancestor with the expected inline-style background colour.
 *  Used to spotlight embedded cards that lack stable CSS hooks —
 *  walking by visible style signature is more refactor-resilient
 *  than counting parent levels (which depends on internal Polaris
 *  nesting). Returns the heading's parent as a fallback when no
 *  matching ancestor exists. */
function findCardByHeading(headingText: string, bgColor: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const headings = document.querySelectorAll("h2");
  for (const h of Array.from(headings)) {
    if (h.textContent?.trim() !== headingText) continue;
    // Walk up the tree looking for the wrapper card.
    let node: HTMLElement | null = h.parentElement;
    const targetBg = bgColor.toLowerCase();
    while (node && node !== document.body) {
      const bg = (node.style.background || node.style.backgroundColor || "").toLowerCase();
      // Inline styles can be hex (#F6F6F7) or rgb (rgb(246, 246, 247)).
      if (bg.includes(targetBg) || bg.includes("rgb(246, 246, 247)")) {
        return node;
      }
      node = node.parentElement;
    }
    // Fallback: return the immediate parent so we still highlight
    // something rather than nothing.
    return h.parentElement;
  }
  return null;
}


export const TOUR_STEPS: TourStep[] = [
  // ─── Dashboard intro (3 steps) ───────────────────────────────────────────
  {
    step: 1,
    title: "Your dispute command center",
    body: "Every Shopify chargeback shows up here automatically — synced through DisputeDesk's webhook the moment a customer files. No manual import, no missed cases.",
    path: "/demo",
    selector: '[data-help-guide="dashboard-attention-banner"]',
    nextPath: "/demo",
  },
  {
    step: 2,
    title: "Performance at a glance",
    body: "Active disputes, win rate, recovered revenue, amount at risk. Track the operations queue and the financial picture side by side — built from the same normalized dispute history that drives every other surface.",
    path: "/demo",
    selector: null,
    // KPI card wrapper: walk up from the Performance overview h2 to
    // the outer div with the white background + border styling.
    findElement: () => findKpiCardByHeading("Performance overview"),
    nextPath: "/demo",
  },
  {
    step: 3,
    title: "Recent disputes — your work queue",
    body: "The cases that need you next, sorted by urgency. Click any row to open the workspace and see what DisputeDesk built. Let's go look at one.",
    path: "/demo",
    selector: null,
    // Recent Disputes wrapper. Try multiple selectors in order:
    //   1. Direct Polaris-LegacyCard ancestor (current Polaris)
    //   2. Polaris-Card (newer Polaris alias, just in case)
    //   3. The h2's grandparent (always works as a last resort —
    //      gives a smaller highlight but better than nothing)
    findElement: () => findCardByHeadingPrefix("Recent"),
    nextPath: "/demo/disputes/dp-2401",
  },

  // ─── Hero dispute detail — Overview tab (3 steps) ────────────────────────
  {
    step: 4,
    title: "DisputeDesk built this for you",
    body: "Within 4 seconds of the webhook, DisputeDesk pulled order, payment, fulfillment, and customer history. The pack is ready — you didn't lift a finger.",
    path: "/demo/disputes/dp-2401",
    selector: '[data-help-guide="detail-header"]',
    preClickSelector: '[data-help-guide="detail-tab-overview"]',
    nextPath: "/demo/disputes/dp-2401",
  },
  {
    step: 5,
    title: "Case strength at a glance",
    body: "Strong, Moderate, or Weak — based on AVS/CVV matches, 3-D Secure status, fulfillment data, and customer history. This case is Strong, so DisputeDesk can auto-submit once you approve.",
    path: "/demo/disputes/dp-2401",
    selector: '[data-help-guide="detail-overview-hero"]',
    preClickSelector: '[data-help-guide="detail-tab-overview"]',
    nextPath: "/demo/disputes/dp-2401",
  },
  {
    step: 6,
    title: "Evidence, auto-collected",
    body: "8 evidence signals pulled from Shopify Payments, AfterShip, IPinfo, and the customer's order history — with zero merchant input. Now let's see what gets sent to the bank.",
    path: "/demo/disputes/dp-2401",
    selector: '[data-help-guide="detail-overview-evidence"]',
    preClickSelector: '[data-help-guide="detail-tab-overview"]',
    nextPath: "/demo/disputes/dp-2401",
  },

  // ─── Hero dispute detail — Review & Submit tab (1 step) ──────────────────
  // Tab id is `submit` (not `review`) — see WorkspaceShell.tsx tabs array.
  {
    step: 7,
    title: "Bank-optimised defence package",
    body: "A PDF that mirrors what a fraud analyst would write — built from your real evidence, mapped to the correct Shopify evidence slots. You review before submission, or let auto-mode handle Strong cases for you.",
    path: "/demo/disputes/dp-2401",
    selector: null,
    // Find the h2 "Complete Defence Package", then walk up until we
    // hit the grey card wrapper (inline style background:#F6F6F7 set
    // by DEFENCE_CARD_STYLE in CompleteDefencePackageCard.tsx). Walking
    // a fixed N parents up is brittle — it depends on BlockStack's
    // internal nesting which can change. Walking by inline-style
    // signature is robust to refactors.
    findElement: () => findCardByHeading("Complete Defence Package", "#F6F6F7"),
    preClickSelector: '[data-help-guide="detail-tab-submit"]',
    nextPath: "/demo/insights/initial-analysis",
  },

  // ─── Insights — the closer + install CTA ────────────────────────────────
  {
    step: 8,
    title: "Built from your real order history",
    body: "DisputeDesk reads your last 90 days of Shopify orders to calibrate every defence pack — risk, delivery, and payment signals understood before the next dispute lands. That's why packs are ready in seconds.",
    path: "/demo/insights/initial-analysis",
    selector: null,
    // Find the Insights HeroDisplay card. The Hero uses a CSS-module
    // class `heroCard` — match by class substring since the module
    // hashes the suffix at build time. Walk up through both Polaris
    // card classes, falling back to the inner element so we always
    // get a spotlight even if class names differ.
    findElement: () => {
      if (typeof document === "undefined") return null;
      const inner = document.querySelector('[class*="heroCard"]') as HTMLElement | null;
      if (!inner) return null;
      const legacy = inner.closest(".Polaris-LegacyCard") as HTMLElement | null;
      if (legacy) return legacy;
      const card = inner.closest(".Polaris-Card") as HTMLElement | null;
      if (card) return card;
      return inner;
    },
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

/** Hook: poll for an element matching `selector` OR `finder` and return
 *  its bounding rect (live, updates on resize/scroll). Returns null
 *  when neither resolves. */
interface TargetState {
  rect: TargetRect | null;
  /** True once polling has been running long enough that we should
   *  stop hiding the dim overlay. Allows the centered-modal fallback
   *  to look correct even when the finder never resolves. */
  gaveUp: boolean;
}

function useTargetRect(
  selector: string | null,
  finder: (() => HTMLElement | null) | null,
  deps: unknown[],
): TargetState {
  const [state, setState] = useState<TargetState>({ rect: null, gaveUp: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selector && !finder) {
      setState({ rect: null, gaveUp: false });
      return;
    }
    // Reset gaveUp when step changes (deps change).
    setState((s) => ({ rect: null, gaveUp: false }));
    let cancelled = false;
    let raf: number | undefined;

    const measure = () => {
      const el = selector
        ? document.querySelector(selector) as HTMLElement | null
        : finder
          ? finder()
          : null;
      if (!el) {
        setState((prev) => (prev.rect === null ? prev : { ...prev, rect: null }));
        return false;
      }
      const r = el.getBoundingClientRect();
      // Round to whole pixels and skip updates when nothing has changed
      // — prevents the ring from jittering as sub-pixel layout values
      // wobble during Polaris re-flows after data loads.
      const next = {
        top: Math.round(r.top),
        left: Math.round(r.left),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
      setState((prev) => {
        if (
          prev.rect &&
          prev.rect.top === next.top &&
          prev.rect.left === next.left &&
          prev.rect.width === next.width &&
          prev.rect.height === next.height
        ) {
          return prev;
        }
        return { rect: next, gaveUp: false };
      });
      return true;
    };

    // Poll up to 60 frames (~1s) waiting for the target to mount, then
    // give up and fall back to centered modal.
    let attempts = 0;
    const tryMeasure = () => {
      if (cancelled) return;
      if (measure() || attempts++ > 60) {
        if (!measure()) {
          // Mark as gave-up so the centered-modal fallback renders
          // WITH the dim overlay (which is the correct presentation
          // for a step that explicitly has no anchor).
          setState((prev) => (prev.gaveUp ? prev : { ...prev, gaveUp: true }));
        }
        return;
      }
      raf = requestAnimationFrame(tryMeasure);
    };
    tryMeasure();

    // After the target is found, keep the rect fresh on scroll/resize.
    const onChange = () => measure();
    window.addEventListener("scroll", onChange, { passive: true, capture: true });
    window.addEventListener("resize", onChange);

    // Re-measure every 500ms in case Polaris layouts shift after data load.
    const interval = setInterval(measure, 500);

    // Belt-and-braces: after 3 seconds, force gaveUp=true even if the
    // measure call is still returning false. Prevents an indefinite
    // transparent overlay if the target genuinely never mounts.
    const giveUpTimer = setTimeout(() => {
      setState((prev) => (prev.gaveUp ? prev : { ...prev, gaveUp: true }));
    }, 3000);

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onChange, { capture: true });
      window.removeEventListener("resize", onChange);
      clearInterval(interval);
      clearTimeout(giveUpTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selector, ...deps]);
  return state;
}

export function GuidedTourCallout() {
  const router = useRouter();
  const pathname = usePathname();
  const { currentStep, setStep, dismissed, dismiss } = useGuidedTour();
  const preClickedRef = useRef<string | null>(null);
  const scrolledForStepRef = useRef<number | null>(null);
  const [installModalOpen, setInstallModalOpen] = useState(false);
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
    if (!stepActiveOnThisPage || !step || (!step.selector && !step.findElement)) {
      scrolledForStepRef.current = null;
      return;
    }
    if (scrolledForStepRef.current === step.step) return;

    let cancelled = false;
    let attempts = 0;
    const trigger = () => {
      if (cancelled) return;
      const el = step.selector
        ? document.querySelector(step.selector) as HTMLElement | null
        : step.findElement
          ? step.findElement()
          : null;
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
  // Only moves FORWARD (never resets to an earlier step) so the user's
  // explicit Next/Skip clicks always win.
  useEffect(() => {
    if (dismissed) return;
    // Find ALL steps whose path matches the current pathname, pick the
    // one closest to (but not before) currentStep so multi-step pages
    // resume at the right anchor.
    const candidates = TOUR_STEPS.filter((s) => s.path === pathname);
    if (candidates.length === 0) return;
    // Prefer a step >= currentStep; otherwise fall back to the first
    // candidate (means user jumped via URL, not Next).
    const next = candidates.find((s) => s.step >= currentStep) ?? candidates[0];
    if (next.step > currentStep) {
      setStep(next.step);
    }
  }, [pathname, dismissed, currentStep, setStep]);

  const { rect, gaveUp } = useTargetRect(
    stepActiveOnThisPage ? step?.selector ?? null : null,
    stepActiveOnThisPage ? step?.findElement ?? null : null,
    [currentStep],
  );

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
                key={`${step.step}-cutout`}
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
        {/* Dim the page whenever a step is showing. Two no-dim cases:
            1. Step has a selector but the target hasn't mounted yet
               (waiting for WorkspaceShell to finish loading) — stay
               transparent so the loading state shows through.
            2. Step has selector: null (intentional centered modal) —
               dim normally; the callout is meant to read against a
               dark page.
            So: dim ON when (no selector requested) OR (selector
            resolved). Dim OFF only when selector requested + still
            polling for it. */}
        <rect
          width="100%"
          height="100%"
          fill={
            // Transparent only while actively waiting for an anchor
            // (selector/finder requested but not yet resolved and
            // haven't given up). Otherwise: full dim — applies to
            // centered-modal steps (no anchor requested), resolved
            // anchors (hasTarget=true), AND anchored steps that
            // timed out (gaveUp=true).
            (step.selector || step.findElement) && !hasTarget && !gaveUp
              ? "rgba(11, 18, 32, 0)"
              : "rgba(11, 18, 32, 0.7)"
          }
          mask="url(#dd-tour-mask)"
          style={{ transition: "fill 200ms ease-out" }}
        />
      </svg>

      {/* Glowing ring around the target — separate from the overlay so
          it sits above the cutout. Position SNAPS to each rect change
          (no transition on top/left/width/height) so the ring never
          visibly drifts when the underlying page layout shifts after
          data load. Only opacity is animated, for a clean fade-in. */}
      {hasTarget && (
        <div
          key={`${step.step}-ring`}
          className="fixed z-50 pointer-events-none"
          style={{
            top: targetTop,
            left: targetLeft,
            width: targetWidth,
            height: targetHeight,
            borderRadius: 8,
            boxShadow: "0 0 0 4px #7C3AED, 0 0 0 8px rgba(124, 58, 237, 0.3), 0 8px 32px rgba(124, 58, 237, 0.4)",
            animation: "dd-ring-fade-in 180ms ease-out",
          }}
        />
      )}
      <style>{`
        @keyframes dd-ring-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>

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
              <button
                type="button"
                onClick={() => setInstallModalOpen(true)}
                className="inline-flex items-center gap-1.5 h-10 px-5 rounded-lg text-sm font-semibold bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition-colors"
              >
                DisputeDesk is free to try!
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
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

      <InstallModal open={installModalOpen} onClose={() => setInstallModalOpen(false)} />
    </>
  );
}
