"use client";

/**
 * Full-fidelity interactive-tour overlay for the embedded app.
 *
 * Renders a fixed full-viewport overlay (inside the embedded iframe)
 * with:
 *   - SVG mask spotlight (rounded rect cutout) over a 50% black backdrop
 *   - Pulsing blue ring around the spotlight
 *   - Position-aware tooltip card (top/bottom/left/right + auto-flip)
 *   - Step progress dots (current = blue wide, completed = green, future = grey)
 *   - "Continue with the next tour" prompt when the active tour finishes
 *
 * Targets are resolved via document.querySelector with a MutationObserver
 * fallback so route transitions don't race the spotlight render.
 *
 * The overlay is rendered as a sibling of the page tree in providers.tsx,
 * so it survives client-side navigations between steps.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useHelpGuideSafe } from "@/components/help/help-guide-provider";
import {
  getEmbeddedGuideSteps,
  getPortalGuideTranslationKeyPrefix,
  HELP_TRANSLATION_NAMESPACE,
  type HelpGuideId,
} from "@/lib/help-guides-config";
import { trackHelpGuideSkip } from "@/components/help/help-guide-provider";

const Z = 9999;
const TOOLTIP_W = 380;
const TOOLTIP_H_EST = 240;
const SPOT_PAD = 8;
const TOOLTIP_OFFSET = 18;
const RECT_OBSERVER_TIMEOUT = 2500;

type Position = "top" | "bottom" | "left" | "right" | "center";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Wait for a selector to appear in the DOM (with a viewport-rect),
 * polling via MutationObserver. Resolves with the rect, or null on timeout.
 */
function waitForSelectorRect(
  selector: string,
  timeoutMs: number,
): Promise<DOMRect | null> {
  return new Promise((resolve) => {
    const startedAt = Date.now();

    const tryFind = (): DOMRect | null => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return null;
      return rect;
    };

    const initial = tryFind();
    if (initial) return resolve(initial);

    const observer = new MutationObserver(() => {
      const r = tryFind();
      if (r) {
        observer.disconnect();
        resolve(r);
      } else if (Date.now() - startedAt > timeoutMs) {
        observer.disconnect();
        resolve(null);
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    setTimeout(() => {
      observer.disconnect();
      resolve(tryFind());
    }, timeoutMs);
  });
}

export function EmbeddedTourOverlay() {
  const helpGuide = useHelpGuideSafe();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations(HELP_TRANSLATION_NAMESPACE);
  const tEmbedded = useTranslations("help.embedded");
  const tOnboarding = useTranslations("onboarding");

  const guideId = helpGuide?.activeGuideId ?? null;
  const showPrompt = Boolean(helpGuide?.showCompletionPrompt);
  const lastCompletedGuideId = helpGuide?.lastCompletedGuideId ?? null;
  const queueLen = helpGuide?.queue.length ?? 0;
  const nextGuideId = helpGuide?.queue[0] ?? null;

  const steps = useMemo(
    () => (guideId ? getEmbeddedGuideSteps(guideId) : []),
    [guideId],
  );

  const [stepIdx, setStepIdx] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const lastNavigatedRef = useRef<string | null>(null);

  // Reset step index when the active guide changes
  useEffect(() => {
    if (guideId) setStepIdx(0);
  }, [guideId]);

  const step = steps[stepIdx] ?? null;
  const isLastStep = steps.length > 0 && stepIdx === steps.length - 1;
  const isFirstStep = stepIdx === 0;
  const keyPrefix = guideId ? getPortalGuideTranslationKeyPrefix(guideId) : "";

  // Navigate when the step's route changes
  useEffect(() => {
    if (!step?.route) return;
    if (pathname !== step.route && lastNavigatedRef.current !== step.route) {
      lastNavigatedRef.current = step.route;
      router.push(step.route);
    }
  }, [step?.route, router, pathname]);

  // Resolve the target rect (with MutationObserver wait)
  useEffect(() => {
    if (!step) return;

    if (!step.targetSelector) {
      setTargetRect(null);
      return;
    }

    let cancelled = false;
    setTargetRect(null);

    waitForSelectorRect(step.targetSelector, RECT_OBSERVER_TIMEOUT).then(
      (rect) => {
        if (cancelled) return;
        if (rect) {
          // Scroll into view, then recompute on next frame
          const el = document.querySelector(step.targetSelector!);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
          requestAnimationFrame(() => {
            const fresh = el?.getBoundingClientRect();
            if (fresh) setTargetRect(fresh);
            else setTargetRect(rect);
          });
        } else {
          setTargetRect(null);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [step]);

  // Recompute on resize / scroll
  useEffect(() => {
    if (!step?.targetSelector) return;
    const recompute = () => {
      const el = document.querySelector(step.targetSelector!);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 || r.height > 0) setTargetRect(r);
      }
    };
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [step?.targetSelector]);

  // Esc closes the tour
  useEffect(() => {
    if (!helpGuide || (!guideId && !showPrompt)) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") helpGuide.closeGuide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpGuide, guideId, showPrompt]);

  if (!helpGuide) return null;
  // Render nothing when no tour is active and no completion prompt to show
  if (!guideId && !showPrompt) return null;

  // ─── Completion prompt branch ──────────────────────────────────
  if (showPrompt) {
    const completedTitle = lastCompletedGuideId
      ? t(`${getPortalGuideTranslationKeyPrefix(lastCompletedGuideId)}.title`)
      : "";
    const nextTitle = nextGuideId
      ? t(`${getPortalGuideTranslationKeyPrefix(nextGuideId)}.title`)
      : "";
    const nextDesc = nextGuideId
      ? t(`${getPortalGuideTranslationKeyPrefix(nextGuideId)}.description`)
      : "";

    return (
      <div style={overlayBaseStyle}>
        <div style={dimStyle} onClick={helpGuide.closeGuide} />
        <div style={centeredCardStyle}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#202223", marginBottom: 6 }}>
            {queueLen > 0
              ? tEmbedded("tourCompletedTitle", { title: completedTitle })
              : tEmbedded("allToursCompleted")}
          </div>
          {queueLen > 0 ? (
            <>
              <div style={{ fontSize: 14, color: "#6D7175", lineHeight: 1.55, marginBottom: 14 }}>
                {tEmbedded("tourCompletedSuggest", { next: nextTitle })}
              </div>
              <div
                style={{
                  background: "#F6F8FB",
                  border: "1px solid #E1E3E5",
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 18,
                  fontSize: 13,
                  color: "#6D7175",
                  lineHeight: 1.5,
                }}
              >
                {nextDesc}
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={helpGuide.declineNextInChain}
                  style={btnSecondaryStyle}
                >
                  {tEmbedded("doneForNow")}
                </button>
                <button
                  type="button"
                  onClick={helpGuide.acceptNextInChain}
                  style={btnPrimaryStyle}
                >
                  {tEmbedded("continueChain")}
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 14, color: "#6D7175", lineHeight: 1.55, marginBottom: 18 }}>
                {tEmbedded("allToursCompletedDesc")}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={helpGuide.declineNextInChain}
                  style={btnPrimaryStyle}
                >
                  {tEmbedded("doneForNow")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!step || !guideId) return null;

  // ─── Active tour branch ────────────────────────────────────────

  const stepTitle = t(`${keyPrefix}.${step.id}Title`);
  const stepDesc = t(`${keyPrefix}.${step.id}Desc`);
  const useSpotlight = Boolean(step.spotlight && targetRect);
  const requestedPos: Position = (step.position as Position) ?? "bottom";

  const tooltipStyle = computeTooltipStyle(targetRect, requestedPos, useSpotlight);

  const handleNext = () => {
    if (isLastStep) {
      helpGuide.finishActiveGuide();
    } else {
      setStepIdx((i) => i + 1);
    }
  };
  const handlePrev = () => {
    if (!isFirstStep) setStepIdx((i) => i - 1);
  };
  const handleSkip = () => {
    trackHelpGuideSkip(guideId, stepIdx);
    helpGuide.closeGuide();
  };

  return (
    <div style={overlayBaseStyle} aria-live="polite">
      {/* Backdrop with optional spotlight cutout */}
      {useSpotlight && targetRect ? (
        <svg
          style={{
            position: "fixed",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "auto",
          }}
          onClick={handleSkip}
        >
          <defs>
            <mask id="dd-tour-spotlight">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              <rect
                x={targetRect.left - SPOT_PAD}
                y={targetRect.top - SPOT_PAD}
                width={targetRect.width + SPOT_PAD * 2}
                height={targetRect.height + SPOT_PAD * 2}
                rx="10"
                ry="10"
                fill="black"
              />
            </mask>
          </defs>
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="rgba(0,0,0,0.55)"
            mask="url(#dd-tour-spotlight)"
          />
        </svg>
      ) : (
        <div style={dimStyle} onClick={handleSkip} />
      )}

      {/* Pulsing ring around spotlight */}
      {useSpotlight && targetRect && (
        <div
          style={{
            position: "fixed",
            top: targetRect.top - SPOT_PAD,
            left: targetRect.left - SPOT_PAD,
            width: targetRect.width + SPOT_PAD * 2,
            height: targetRect.height + SPOT_PAD * 2,
            borderRadius: 10,
            border: "3px solid #1D4ED8",
            boxShadow:
              "0 0 0 4px rgba(29,78,216,0.15), 0 0 30px rgba(29,78,216,0.4)",
            pointerEvents: "none",
            animation: "ddTourPulse 2.4s ease-in-out infinite",
          }}
        />
      )}

      {/* Tooltip card */}
      <div style={tooltipStyle}>
        {/* Step dots */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {steps.map((_, i) => (
            <div
              key={i}
              style={{
                height: 4,
                width: i === stepIdx ? 22 : 6,
                borderRadius: 4,
                background:
                  i === stepIdx
                    ? "#1D4ED8"
                    : i < stepIdx
                    ? "#22C55E"
                    : "#E5E7EB",
                transition: "all 200ms ease",
              }}
            />
          ))}
        </div>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#202223" }}>
              {stepTitle}
            </div>
            <div style={{ fontSize: 12, color: "#6D7175", marginTop: 2 }}>
              {tOnboarding("stepOf", { current: stepIdx + 1, total: steps.length })}
            </div>
          </div>
          <button
            type="button"
            onClick={handleSkip}
            aria-label="Close tour"
            style={{
              background: "transparent",
              border: "none",
              color: "#6D7175",
              padding: 4,
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ fontSize: 14, color: "#6D7175", lineHeight: 1.55, marginBottom: 18 }}>
          {stepDesc}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div>
            {!isFirstStep && (
              <button
                type="button"
                onClick={handlePrev}
                style={btnGhostStyle}
              >
                ← {tOnboarding("previous")}
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={handleSkip}
              style={btnGhostStyle}
            >
              {tOnboarding("skipTour")}
            </button>
            <button
              type="button"
              onClick={handleNext}
              style={btnPrimaryStyle}
            >
              {isLastStep ? tOnboarding("finish") : tOnboarding("next")}
            </button>
          </div>
        </div>
      </div>

      {/* Pulse keyframes */}
      <style>{`
        @keyframes ddTourPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }
      `}</style>
    </div>
  );
}

// ─── Layout helpers ──────────────────────────────────────────────

function computeTooltipStyle(
  rect: DOMRect | null,
  preferred: Position,
  spotlight: boolean,
): CSSProperties {
  const base: CSSProperties = {
    position: "fixed",
    width: TOOLTIP_W,
    maxWidth: "calc(100vw - 32px)",
    background: "#FFFFFF",
    borderRadius: 12,
    boxShadow: "0 12px 40px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.08)",
    padding: 20,
    pointerEvents: "auto",
    zIndex: Z + 1,
  };

  if (!spotlight || !rect) {
    return {
      ...base,
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
    };
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 16;

  // Pick the position with the most room
  let pos: Position = preferred;
  const roomTop = rect.top;
  const roomBottom = vh - rect.bottom;
  const roomLeft = rect.left;
  const roomRight = vw - rect.right;
  const fits = (p: Position) =>
    (p === "top" && roomTop > TOOLTIP_H_EST + TOOLTIP_OFFSET + margin) ||
    (p === "bottom" && roomBottom > TOOLTIP_H_EST + TOOLTIP_OFFSET + margin) ||
    (p === "left" && roomLeft > TOOLTIP_W + TOOLTIP_OFFSET + margin) ||
    (p === "right" && roomRight > TOOLTIP_W + TOOLTIP_OFFSET + margin);

  if (!fits(pos)) {
    const fallbacks: Position[] = ["bottom", "top", "right", "left"];
    pos = fallbacks.find(fits) ?? "bottom";
  }

  switch (pos) {
    case "top": {
      const left = clamp(rect.left + rect.width / 2 - TOOLTIP_W / 2, margin, vw - TOOLTIP_W - margin);
      return {
        ...base,
        left,
        top: rect.top - TOOLTIP_OFFSET - TOOLTIP_H_EST,
      };
    }
    case "bottom": {
      const left = clamp(rect.left + rect.width / 2 - TOOLTIP_W / 2, margin, vw - TOOLTIP_W - margin);
      return {
        ...base,
        left,
        top: rect.bottom + TOOLTIP_OFFSET,
      };
    }
    case "left": {
      const top = clamp(rect.top + rect.height / 2 - TOOLTIP_H_EST / 2, margin, vh - TOOLTIP_H_EST - margin);
      return {
        ...base,
        top,
        left: rect.left - TOOLTIP_OFFSET - TOOLTIP_W,
      };
    }
    case "right": {
      const top = clamp(rect.top + rect.height / 2 - TOOLTIP_H_EST / 2, margin, vh - TOOLTIP_H_EST - margin);
      return {
        ...base,
        top,
        left: rect.right + TOOLTIP_OFFSET,
      };
    }
    default:
      return {
        ...base,
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      };
  }
}

const overlayBaseStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: Z,
  pointerEvents: "none",
};

const dimStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  pointerEvents: "auto",
};

const centeredCardStyle: CSSProperties = {
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: 460,
  maxWidth: "calc(100vw - 32px)",
  background: "#FFFFFF",
  borderRadius: 12,
  boxShadow: "0 16px 48px rgba(0,0,0,0.22)",
  padding: 24,
  pointerEvents: "auto",
  zIndex: Z + 1,
};

const btnPrimaryStyle: CSSProperties = {
  background: "#202223",
  color: "#FFFFFF",
  border: "none",
  padding: "8px 14px",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const btnSecondaryStyle: CSSProperties = {
  background: "#FFFFFF",
  color: "#202223",
  border: "1px solid #C9CCCF",
  padding: "8px 14px",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const btnGhostStyle: CSSProperties = {
  background: "transparent",
  color: "#6D7175",
  border: "none",
  padding: "8px 10px",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};
