"use client";

import { useTranslations } from "next-intl";
import type { StepId, StepState } from "@/lib/setup/types";
import { WIZARD_STEPPER_IDS } from "@/lib/setup/constants";

interface WizardStepperProps {
  currentStepId: StepId;
  stepsMap: Partial<Record<StepId, StepState>>;
}

// SVG icons matching Figma Make onboarding wizard stepper
function ConnectionIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 2a4 4 0 0 0-4 4v1H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1V6a4 4 0 0 0-4-4zm-2 4a2 2 0 1 1 4 0v1H8V6zm2 6a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
    </svg>
  );
}
function StoreProfileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
      <path d="M3 3h14a1 1 0 0 1 1 1v2l-1.5 3H3.5L2 6V4a1 1 0 0 1 1-1zM4 10v6a1 1 0 0 0 1 1h4v-4h2v4h4a1 1 0 0 0 1-1v-6H4z" />
    </svg>
  );
}
function CoverageIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 1l7 3v5c0 4.4-3 8.5-7 9.9C6 17.5 3 13.4 3 9V4l7-3zm-1.3 10.7l4-4-1.4-1.4-2.6 2.6-1.3-1.3-1.4 1.4 2.7 2.7z" />
    </svg>
  );
}
function AutomationIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
      <path d="M11 1L5 11h4v8l6-10h-4V1z" />
    </svg>
  );
}
function ActivateIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 2a2.5 2.5 0 0 0-1 4.8V8H6l-1 2v1h3v4.2a2.5 2.5 0 1 0 2 0V11h3v-1l-1-2h-3V6.8A2.5 2.5 0 0 0 10 2z" />
    </svg>
  );
}

const STEP_ICON_COMPONENTS: Record<string, React.ReactNode> = {
  connection: <ConnectionIcon />,
  store_profile: <StoreProfileIcon />,
  coverage: <CoverageIcon />,
  automation: <AutomationIcon />,
  activate: <ActivateIcon />,
};

export function WizardStepper({ currentStepId, stepsMap }: WizardStepperProps) {
  const t = useTranslations("setup.stepper");

  const currentIndex = WIZARD_STEPPER_IDS.indexOf(currentStepId);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        padding: "8px 0 8px",
        gap: 0,
      }}
    >
      {WIZARD_STEPPER_IDS.map((stepId, i) => {
        const stepState = stepsMap[stepId];
        const isDone = stepState?.status === "done";
        const isActive = stepId === currentStepId;
        const isPast = i < currentIndex;
        const isComplete = isDone || isPast;

        // Active step is always blue (Figma: #1D4ED8), even if marked done by API
        const circleBg = isActive ? "#1D4ED8" : isComplete ? "#059669" : "#fff";
        const circleBorder = isActive ? "#1D4ED8" : isComplete ? "#059669" : "#E1E3E5";
        const iconColor = isActive || isComplete ? "#fff" : "#8C9196";
        const labelColor = isActive ? "#202223" : "#8C9196";
        // Show checkmark only for past-completed steps, not the active one
        const showCheckmark = isComplete && !isActive;

        return (
          <div
            key={stepId}
            style={{ display: "flex", alignItems: "flex-start", flex: 1, minWidth: 0 }}
          >
            {/* Step circle + label */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                flex: "0 0 auto",
                width: 80,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: circleBg,
                  border: `2px solid ${circleBorder}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: iconColor,
                  transition: "all 0.2s",
                }}
              >
                {showCheckmark ? (
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M8.5 13.5l-3-3 1.06-1.06L8.5 11.38l4.94-4.94L14.5 7.5l-6 6z" />
                  </svg>
                ) : (
                  STEP_ICON_COMPONENTS[stepId]
                )}
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: isActive ? 600 : 400,
                  color: labelColor,
                  textAlign: "center",
                  lineHeight: 1.3,
                  whiteSpace: "nowrap",
                }}
              >
                {t(stepId as "connection" | "store_profile" | "coverage" | "automation" | "activate")}
              </span>
            </div>

            {/* Connecting line (not after last) */}
            {i < WIZARD_STEPPER_IDS.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 2,
                  background: isComplete && !isActive ? "#059669" : "#E1E3E5",
                  marginTop: 19,
                  transition: "background 0.2s",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
