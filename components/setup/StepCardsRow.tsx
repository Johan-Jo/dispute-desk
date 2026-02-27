"use client";

import { InlineStack, Text, Icon } from "@shopify/polaris";
import { CheckCircleIcon, ClockIcon } from "@shopify/polaris-icons";
import { SETUP_STEPS, isPrerequisiteMet } from "@/lib/setup/constants";
import type { StepId, StepsMap } from "@/lib/setup/types";

interface StepCardsRowProps {
  currentStepId: StepId;
  stepsMap: StepsMap;
  onStepClick: (stepId: StepId) => void;
}

export function StepCardsRow({
  currentStepId,
  stepsMap,
  onStepClick,
}: StepCardsRowProps) {
  return (
    <div style={{ overflowX: "auto", paddingBottom: 4 }}>
      <InlineStack gap="300" wrap={false}>
        {SETUP_STEPS.map((step) => {
          const state = stepsMap[step.id];
          const status = state?.status ?? "todo";
          const isActive = currentStepId === step.id;
          const isCompleted = status === "done";
          const isLocked = !isPrerequisiteMet(step.id, stepsMap ?? {});
          const isDisabled = isLocked && !isCompleted;

          let bg = "#F6F6F7";
          let border = "2px solid #E1E3E5";
          let iconColor = "#8C9196";

          if (isActive) {
            bg = "#F2F7FE";
            border = "2px solid #2C6ECB";
            iconColor = "#2C6ECB";
          } else if (isCompleted) {
            bg = "#F1F8F5";
            border = "2px solid #008060";
            iconColor = "#008060";
          }

          return (
            <button
              key={step.id}
              disabled={isDisabled}
              onClick={() => !isDisabled && onStepClick(step.id)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                padding: "12px 16px",
                borderRadius: 8,
                background: isDisabled ? "#F6F6F7" : bg,
                border,
                cursor: isDisabled ? "not-allowed" : "pointer",
                opacity: isDisabled ? 0.5 : 1,
                minWidth: 120,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 8,
                  background: isCompleted
                    ? "#008060"
                    : isActive
                    ? "#2C6ECB"
                    : "#E1E3E5",
                  color: isCompleted || isActive ? "#fff" : iconColor,
                }}
              >
                {isCompleted ? (
                  <Icon source={CheckCircleIcon} />
                ) : (
                  <span style={{ fontWeight: 600, fontSize: 14 }}>
                    {step.index}
                  </span>
                )}
              </div>
              <Text as="span" variant="bodySm" fontWeight="semibold">
                {step.title}
              </Text>
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                <Icon source={ClockIcon} tone="subdued" />
                <Text as="span" variant="bodySm" tone="subdued">
                  {step.timeEstimate}
                </Text>
              </div>
            </button>
          );
        })}
      </InlineStack>
    </div>
  );
}
