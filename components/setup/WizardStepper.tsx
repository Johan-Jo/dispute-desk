"use client";

import { useTranslations } from "next-intl";
import type { StepId, StepState } from "@/lib/setup/types";
import { WIZARD_STEPPER_IDS } from "@/lib/setup/constants";

interface WizardStepperProps {
  currentStepId: StepId;
  stepsMap: Partial<Record<StepId, StepState>>;
}

const STEP_ICONS: Record<string, string> = {
  disputes: "⟳",
  policies: "📄",
  packs: "📦",
  rules: "⚡",
  team: "👥",
};

// SVG icons matching Figma design
function SyncIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 3a7 7 0 0 1 6.5 4.4l-1.8.7A5 5 0 1 0 15 10h-2l3-3 3 3h-2a7 7 0 1 1-7-7z" />
    </svg>
  );
}
function DocIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
      <path d="M6 2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 2v12h8V4H6zm2 3h4v1.5H8V7zm0 3h4v1.5H8V10zm0 3h2.5v1.5H8V13z" />
    </svg>
  );
}
function PackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
      <path d="M3 5h14v2H3V5zm1 3h12v2H4V8zm2 3h8v2H6v-2z" />
    </svg>
  );
}
function RuleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 2l2 5h5l-4 3 1.5 5L10 12l-4.5 3L7 10 3 7h5L10 2z" />
    </svg>
  );
}
function TeamIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
      <path d="M13 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm-3 4c-3.3 0-6 1.3-6 3v1h12v-1c0-1.7-2.7-3-6-3zm5-5a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm2 3.5c1.7.4 3 1.3 3 2.5v1h-3v-1c0-.9-.4-1.8-1.1-2.5H17zm-14 0A2 2 0 1 1 3 2a2 2 0 0 1 0 3.5zM1 14v1h3v-1c0-1.2 1.3-2.1 3-2.5H7c-.7.7-1.1 1.6-1.1 2.5H3z" />
    </svg>
  );
}

const STEP_ICON_COMPONENTS: Record<string, React.ReactNode> = {
  disputes: <SyncIcon />,
  policies: <DocIcon />,
  packs: <PackIcon />,
  rules: <RuleIcon />,
  team: <TeamIcon />,
};

export function WizardStepper({ currentStepId, stepsMap }: WizardStepperProps) {
  const t = useTranslations("setup.stepper");

  const currentIndex = WIZARD_STEPPER_IDS.indexOf(currentStepId);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "24px 0 8px",
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
                {t(stepId as "disputes" | "policies" | "packs" | "rules" | "team")}
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
