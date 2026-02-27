"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import type { HelpGuideId } from "@/lib/help-guides-config";
import {
  trackHelpGuideCompleted,
  trackHelpGuideSkipped,
  trackHelpGuideStarted,
} from "@/lib/help-guide-analytics";

interface HelpGuideContextValue {
  activeGuideId: HelpGuideId | null;
  startGuide: (id: HelpGuideId) => void;
  closeGuide: () => void;
}

const HelpGuideContext = createContext<HelpGuideContextValue | null>(null);

export function useHelpGuide(): HelpGuideContextValue {
  const ctx = useContext(HelpGuideContext);
  if (!ctx) {
    throw new Error("useHelpGuide must be used within HelpGuideProvider");
  }
  return ctx;
}

export function useHelpGuideSafe(): HelpGuideContextValue | null {
  return useContext(HelpGuideContext);
}

interface HelpGuideProviderProps {
  children: ReactNode;
}

export function HelpGuideProvider({ children }: HelpGuideProviderProps) {
  const [activeGuideId, setActiveGuideId] = useState<HelpGuideId | null>(null);

  const startGuide = useCallback((id: HelpGuideId) => {
    setActiveGuideId(id);
    trackHelpGuideStarted(id);
  }, []);

  const closeGuide = useCallback(() => {
    setActiveGuideId(null);
  }, []);

  const value: HelpGuideContextValue = {
    activeGuideId,
    startGuide,
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

export function trackHelpGuideSkip(
  guideId: HelpGuideId,
  stepIndex: number
): void {
  trackHelpGuideSkipped(guideId, stepIndex);
}
