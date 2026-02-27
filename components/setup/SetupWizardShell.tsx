"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  InlineStack,
  ProgressBar,
  Spinner,
} from "@shopify/polaris";
import { withShopParams } from "@/lib/withShopParams";
import { SETUP_STEPS, TOTAL_STEPS, STEP_BY_ID } from "@/lib/setup/constants";
import type { StepId, StepsMap, SetupStateResponse } from "@/lib/setup/types";
import { StepCardsRow } from "./StepCardsRow";
import { WhatThisUnlocksCard } from "./WhatThisUnlocksCard";
import { BottomNav } from "./BottomNav";
import { SkipReasonModal } from "./modals/SkipReasonModal";

interface SetupWizardShellProps {
  stepId: StepId;
  children: React.ReactNode;
  onSave: () => Promise<boolean>;
}

export function SetupWizardShell({
  stepId,
  children,
  onSave,
}: SetupWizardShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<SetupStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [skipModalOpen, setSkipModalOpen] = useState(false);

  const stepDef = STEP_BY_ID[stepId];
  const stepIndex = stepDef?.index ?? 1;

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/setup/state");
      if (res.ok) {
        setState(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  const navigateToStep = useCallback(
    (target: StepId) => {
      router.push(withShopParams(`/app/setup/${target}`, searchParams));
    },
    [router, searchParams]
  );

  const getAdjacentStep = useCallback(
    (direction: "prev" | "next"): StepId | null => {
      const idx = SETUP_STEPS.findIndex((s) => s.id === stepId);
      if (direction === "prev" && idx > 0) return SETUP_STEPS[idx - 1].id;
      if (direction === "next" && idx < SETUP_STEPS.length - 1)
        return SETUP_STEPS[idx + 1].id;
      return null;
    },
    [stepId]
  );

  const handleBack = useCallback(() => {
    const prev = getAdjacentStep("prev");
    if (prev) navigateToStep(prev);
  }, [getAdjacentStep, navigateToStep]);

  const handleSaveAndContinue = useCallback(async () => {
    setSaving(true);
    try {
      const ok = await onSave();
      if (ok) {
        const next = getAdjacentStep("next");
        if (next) {
          navigateToStep(next);
        } else {
          router.push(withShopParams("/app", searchParams));
        }
      }
    } finally {
      setSaving(false);
    }
  }, [onSave, getAdjacentStep, navigateToStep, router, searchParams]);

  const handleSkipConfirm = useCallback(
    async (reason: string) => {
      setSkipModalOpen(false);
      await fetch("/api/setup/skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId, reason }),
      });
      const next = getAdjacentStep("next");
      if (next) {
        navigateToStep(next);
      } else {
        router.push(withShopParams("/app", searchParams));
      }
    },
    [stepId, getAdjacentStep, navigateToStep, router, searchParams]
  );

  if (loading) {
    return (
      <Page>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const stepsMap: StepsMap = state?.steps ?? {};
  const doneCount = state?.progress.doneCount ?? 0;
  const progressPct = TOTAL_STEPS > 0 ? (stepIndex / TOTAL_STEPS) * 100 : 0;

  return (
    <Page
      title="Setup Wizard"
      subtitle="Complete these steps to get DisputeDesk ready for your business"
      backAction={{
        content: "Dashboard",
        url: withShopParams("/app", searchParams),
      }}
    >
      <Layout>
        {/* Progress + Step Cards */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  Progress
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  {stepIndex} of {TOTAL_STEPS}
                </Text>
              </InlineStack>
              <ProgressBar progress={progressPct} size="small" tone="primary" />
              <StepCardsRow
                currentStepId={stepId}
                stepsMap={stepsMap}
                onStepClick={navigateToStep}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Two-column: step content + what this unlocks */}
        <Layout.Section>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24 }}>
            <Card>
              <BlockStack gap="400">
                {children}
                <BottomNav
                  onBack={stepIndex > 1 ? handleBack : undefined}
                  onSaveAndContinue={handleSaveAndContinue}
                  onSkip={
                    stepIndex < TOTAL_STEPS
                      ? () => setSkipModalOpen(true)
                      : undefined
                  }
                  isFirst={stepIndex === 1}
                  isLast={stepIndex === TOTAL_STEPS}
                  saving={saving}
                />
              </BlockStack>
            </Card>
            <WhatThisUnlocksCard stepId={stepId} />
          </div>
        </Layout.Section>
      </Layout>

      <SkipReasonModal
        open={skipModalOpen}
        stepTitle={stepDef?.title ?? ""}
        onClose={() => setSkipModalOpen(false)}
        onConfirm={handleSkipConfirm}
      />
    </Page>
  );
}
