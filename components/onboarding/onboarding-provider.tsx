"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";

const STORAGE_KEY_COMPLETED = "disputedesk_onboarding_completed";
const STORAGE_KEY_DISMISSED = "disputedesk_welcome_banner_dismissed";

interface OnboardingContextType {
  showTour: boolean;
  startTour: () => void;
  completeTour: () => void;
  skipTour: () => void;
  hasCompletedOnboarding: boolean;
  hasDismissedBanner: boolean;
  dismissBanner: () => void;
}

const OnboardingContext = createContext<OnboardingContextType | null>(null);

export function OnboardingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [showTour, setShowTour] = useState(false);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(true);
  const [hasDismissedBanner, setHasDismissedBanner] = useState(true);

  useEffect(() => {
    setHasCompletedOnboarding(
      localStorage.getItem(STORAGE_KEY_COMPLETED) === "true"
    );
    setHasDismissedBanner(
      localStorage.getItem(STORAGE_KEY_DISMISSED) === "true"
    );
  }, []);

  const startTour = useCallback(() => {
    setShowTour(true);
    setHasDismissedBanner(true);
  }, []);

  const completeTour = useCallback(() => {
    setShowTour(false);
    localStorage.setItem(STORAGE_KEY_COMPLETED, "true");
    setHasCompletedOnboarding(true);
  }, []);

  const skipTour = useCallback(() => {
    setShowTour(false);
    localStorage.setItem(STORAGE_KEY_COMPLETED, "true");
    setHasCompletedOnboarding(true);
  }, []);

  const dismissBanner = useCallback(() => {
    setHasDismissedBanner(true);
    localStorage.setItem(STORAGE_KEY_DISMISSED, "true");
  }, []);

  return (
    <OnboardingContext.Provider
      value={{
        showTour,
        startTour,
        completeTour,
        skipTour,
        hasCompletedOnboarding,
        hasDismissedBanner,
        dismissBanner,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context)
    throw new Error("useOnboarding must be used within OnboardingProvider");
  return context;
}
