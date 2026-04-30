"use client";

/**
 * Help guide context.
 *
 * Holds the currently active interactive tour, an optional queue of
 * follow-up tours (for "take the full tour" sequencing), and a
 * completion-prompt state used by EmbeddedTourOverlay to show the
 * "continue with the next tour?" card after each tour finishes.
 */

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { HELP_GUIDE_IDS, type HelpGuideId } from "@/lib/help-guides-config";
import {
  trackHelpGuideCompleted,
  trackHelpGuideSkipped,
  trackHelpGuideStarted,
} from "@/lib/help-guide-analytics";

/**
 * Canonical chain order for the full product walkthrough. Matches the
 * merchant's natural workflow: triage incoming disputes → build the
 * evidence pack → automate it → install templates → configure policies.
 */
export const TOUR_CHAIN_ORDER: HelpGuideId[] = [
  "review-dispute",
  "build-pack",
  "automation-rules",
  "install-template",
  "configure-policies",
];

interface StartGuideOptions {
  /** When true, queue the remaining tours after this one in canonical order. */
  withChain?: boolean;
}

export interface HelpGuideContextValue {
  activeGuideId: HelpGuideId | null;
  /** Tours queued to play after the active one completes. */
  queue: HelpGuideId[];
  /** When true, the renderer shows the "continue to next tour" card instead of the active tour steps. */
  showCompletionPrompt: boolean;
  /** ID of the tour that just finished (used by the prompt to show "you finished X"). */
  lastCompletedGuideId: HelpGuideId | null;
  startGuide: (id: HelpGuideId, options?: StartGuideOptions) => void;
  /** Queue the entire canonical chain starting at firstId (defaults to chain[0]). */
  startTourChain: (firstId?: HelpGuideId) => void;
  /** Internally fired by the overlay when a tour reaches its last step. Surfaces the completion prompt. */
  finishActiveGuide: () => void;
  /** User accepted the chain suggestion: pop queue and start that guide. */
  acceptNextInChain: () => void;
  /** User declined: clear queue and close. */
  declineNextInChain: () => void;
  /** Hard-close the tour (X / Esc / Skip). */
  closeGuide: () => void;
}

const HelpGuideContext = createContext<HelpGuideContextValue | null>(null);

export function useHelpGuide(): HelpGuideContextValue {
  const ctx = useContext(HelpGuideContext);
  if (!ctx) throw new Error("useHelpGuide must be used within HelpGuideProvider");
  return ctx;
}

export function useHelpGuideSafe(): HelpGuideContextValue | null {
  return useContext(HelpGuideContext);
}

/** Build the chain after a starting guide id (excluding the start). */
function buildChainAfter(startId: HelpGuideId): HelpGuideId[] {
  const idx = TOUR_CHAIN_ORDER.indexOf(startId);
  if (idx === -1) return [];
  return TOUR_CHAIN_ORDER.slice(idx + 1);
}

interface HelpGuideProviderProps {
  children: ReactNode;
}

export function HelpGuideProvider({ children }: HelpGuideProviderProps) {
  const [activeGuideId, setActiveGuideId] = useState<HelpGuideId | null>(null);
  const [queue, setQueue] = useState<HelpGuideId[]>([]);
  const [showCompletionPrompt, setShowCompletionPrompt] = useState(false);
  const [lastCompletedGuideId, setLastCompletedGuideId] = useState<HelpGuideId | null>(null);

  const startGuide = useCallback(
    (id: HelpGuideId, options?: StartGuideOptions) => {
      setActiveGuideId(id);
      setShowCompletionPrompt(false);
      setLastCompletedGuideId(null);
      setQueue(options?.withChain ? buildChainAfter(id) : []);
      trackHelpGuideStarted(id);
    },
    [],
  );

  const startTourChain = useCallback(
    (firstId?: HelpGuideId) => {
      const start = firstId ?? TOUR_CHAIN_ORDER[0];
      setActiveGuideId(start);
      setShowCompletionPrompt(false);
      setLastCompletedGuideId(null);
      setQueue(buildChainAfter(start));
      trackHelpGuideStarted(start);
    },
    [],
  );

  const finishActiveGuide = useCallback(() => {
    if (!activeGuideId) return;
    trackHelpGuideCompleted(activeGuideId);
    setLastCompletedGuideId(activeGuideId);
    setActiveGuideId(null);
    // Always surface the prompt so the merchant can see they finished
    // (and continue if there's a next tour queued).
    setShowCompletionPrompt(true);
  }, [activeGuideId]);

  const acceptNextInChain = useCallback(() => {
    setShowCompletionPrompt(false);
    setLastCompletedGuideId(null);
    setQueue((prev) => {
      const [next, ...rest] = prev;
      if (!next) {
        // Chain finished — close cleanly
        setActiveGuideId(null);
        return [];
      }
      setActiveGuideId(next);
      trackHelpGuideStarted(next);
      return rest;
    });
  }, []);

  const declineNextInChain = useCallback(() => {
    setShowCompletionPrompt(false);
    setLastCompletedGuideId(null);
    setQueue([]);
    setActiveGuideId(null);
  }, []);

  const closeGuide = useCallback(() => {
    if (activeGuideId) {
      // Treat hard close as a skip for analytics
      trackHelpGuideSkipped(activeGuideId, 0);
    }
    setActiveGuideId(null);
    setQueue([]);
    setShowCompletionPrompt(false);
    setLastCompletedGuideId(null);
  }, [activeGuideId]);

  // Defensive: ensure queue only contains valid ids
  const safeQueue = queue.filter((id) => HELP_GUIDE_IDS.includes(id));

  const value: HelpGuideContextValue = {
    activeGuideId,
    queue: safeQueue,
    showCompletionPrompt,
    lastCompletedGuideId,
    startGuide,
    startTourChain,
    finishActiveGuide,
    acceptNextInChain,
    declineNextInChain,
    closeGuide,
  };

  return (
    <HelpGuideContext.Provider value={value}>
      {children}
    </HelpGuideContext.Provider>
  );
}

export function trackHelpGuideCompleteOnFinish(guideId: HelpGuideId): void {
  trackHelpGuideCompleted(guideId);
}

export function trackHelpGuideSkip(guideId: HelpGuideId, stepIndex: number): void {
  trackHelpGuideSkipped(guideId, stepIndex);
}
