"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Modal, Text, BlockStack, InlineStack } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import { useHelpGuideSafe } from "@/components/help/help-guide-provider";
import {
  getEmbeddedGuideSteps,
  getPortalGuideTranslationKeyPrefix,
  HELP_TRANSLATION_NAMESPACE,
  type HelpGuideId,
} from "@/lib/help-guides-config";
import {
  trackHelpGuideCompleteOnFinish,
  trackHelpGuideSkip,
} from "@/components/help/help-guide-provider";

export function EmbeddedHelpGuideTour() {
  const helpGuide = useHelpGuideSafe();
  const router = useRouter();
  const t = useTranslations(HELP_TRANSLATION_NAMESPACE);
  const tOnboarding = useTranslations("onboarding");
  const [currentStep, setCurrentStep] = useState(0);

  const guideId = helpGuide?.activeGuideId as HelpGuideId | null;
  const steps = guideId ? getEmbeddedGuideSteps(guideId) : [];
  const step = steps[currentStep];
  const keyPrefix = guideId ? getPortalGuideTranslationKeyPrefix(guideId) : "";
  const isLastStep = steps.length > 0 && currentStep === steps.length - 1;

  useEffect(() => {
    if (guideId) setCurrentStep(0);
  }, [guideId]);

  useEffect(() => {
    if (!step?.route) return;
    router.push(step.route);
  }, [currentStep, step?.route, router]);

  if (!helpGuide?.activeGuideId || steps.length === 0) return null;

  const handleNext = () => {
    if (isLastStep) {
      trackHelpGuideCompleteOnFinish(guideId!);
      helpGuide.closeGuide();
    } else {
      setCurrentStep((i) => i + 1);
    }
  };

  const handleSkip = () => {
    trackHelpGuideSkip(guideId!, currentStep);
    helpGuide.closeGuide();
  };

  const title = step ? t(`${keyPrefix}.${step.id}Title`) : "";
  const description = step ? t(`${keyPrefix}.${step.id}Desc`) : "";

  return (
    <Modal
      open
      onClose={handleSkip}
      title={title}
      primaryAction={{
        content: isLastStep ? tOnboarding("finish") : tOnboarding("next"),
        onAction: handleNext,
      }}
      secondaryActions={[
        {
          content: tOnboarding("skipTour"),
          onAction: handleSkip,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text as="p" variant="bodyMd" tone="subdued">
            {description}
          </Text>
          <InlineStack gap="200">
            {steps.map((_, i) => (
              <div
                key={i}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  background: i <= currentStep ? "#1D4ED8" : "#E5E7EB",
                }}
              />
            ))}
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued">
            {tOnboarding("stepOf", {
              current: currentStep + 1,
              total: steps.length,
            })}
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
