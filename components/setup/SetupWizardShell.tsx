"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Page, Card, BlockStack, Spinner, Button, InlineStack } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import { withShopParams } from "@/lib/withShopParams";
import { WIZARD_STEP_IDS, STEP_BY_ID } from "@/lib/setup/constants";
import type { StepId, StepsMap, SetupStateResponse } from "@/lib/setup/types";
import { WizardStepper } from "./WizardStepper";
import { SkipReasonModal } from "./modals/SkipReasonModal";

interface SetupWizardShellProps {
  stepId: StepId;
  children: React.ReactNode;
  onSave: () => Promise<boolean>;
}

export function SetupWizardShell({ stepId, children, onSave }: SetupWizardShellProps) {
  const t = useTranslations("setup");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<SetupStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [skipModalOpen, setSkipModalOpen] = useState(false);

  const stepDef = STEP_BY_ID[stepId];
  const wizardIndex = WIZARD_STEP_IDS.indexOf(stepId);
  const isFirst = wizardIndex === 0;
  const isLast = wizardIndex === WIZARD_STEP_IDS.length - 1;
  const isWelcome = stepId === "overview";

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/setup/state");
      if (res.ok) setState(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchState(); }, [fetchState]);

  const navigateToStep = useCallback(
    (target: StepId) => {
      router.push(withShopParams(`/app/setup/${target}`, searchParams));
    },
    [router, searchParams]
  );

  const getAdjacentWizardStep = useCallback(
    (direction: "prev" | "next"): StepId | null => {
      const idx = WIZARD_STEP_IDS.indexOf(stepId);
      if (direction === "prev" && idx > 0) return WIZARD_STEP_IDS[idx - 1];
      if (direction === "next" && idx < WIZARD_STEP_IDS.length - 1) return WIZARD_STEP_IDS[idx + 1];
      return null;
    },
    [stepId]
  );

  const handleBack = useCallback(() => {
    const prev = getAdjacentWizardStep("prev");
    if (prev) navigateToStep(prev);
  }, [getAdjacentWizardStep, navigateToStep]);

  const handleSaveAndContinue = useCallback(async () => {
    setSaving(true);
    try {
      const ok = await onSave();
      if (ok) {
        const next = getAdjacentWizardStep("next");
        if (next) {
          navigateToStep(next);
        } else {
          router.push(withShopParams("/app/setup/complete", searchParams));
        }
      }
    } finally {
      setSaving(false);
    }
  }, [onSave, getAdjacentWizardStep, navigateToStep, router, searchParams]);

  const handleSkipConfirm = useCallback(
    async (reason: string) => {
      setSkipModalOpen(false);
      await fetch("/api/setup/skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId, reason }),
      });
      const next = getAdjacentWizardStep("next");
      if (next) {
        navigateToStep(next);
      } else {
        router.push(withShopParams("/app/setup/complete", searchParams));
      }
    },
    [stepId, getAdjacentWizardStep, navigateToStep, router, searchParams]
  );

  if (loading) {
    return (
      <Page>
        <Card>
          <BlockStack gap="400" inlineAlign="center">
            <Spinner />
          </BlockStack>
        </Card>
      </Page>
    );
  }

  const stepsMap: StepsMap = state?.steps ?? {};

  return (
    <Page>
      <div style={{ padding: "0 24px" }}>
        <WizardStepper currentStepId={stepId} stepsMap={stepsMap} />

        <div style={{ marginTop: 16 }}>
          <Card>
            <BlockStack gap="400">
              {children}

              {/* Bottom nav */}
              <div style={{ borderTop: "1px solid #E1E3E5", paddingTop: 16, marginTop: 8 }}>
                <InlineStack align="space-between">
                  <div>
                    {!isFirst && !isWelcome && (
                      <Button onClick={handleBack}>{t("back")}</Button>
                    )}
                    {isWelcome && (
                      <Button disabled>{t("back")}</Button>
                    )}
                  </div>
                  <InlineStack gap="300">
                    {!isWelcome && !isLast && (
                      <Button onClick={() => setSkipModalOpen(true)}>{t("skipForNow")}</Button>
                    )}
                    <Button variant="primary" onClick={handleSaveAndContinue} loading={saving}>
                      {isWelcome ? t("getStarted") : isLast ? t("finishSetup") : t("saveAndContinue")}
                    </Button>
                  </InlineStack>
                </InlineStack>
              </div>
            </BlockStack>
          </Card>
        </div>
      </div>

      <SkipReasonModal
        open={skipModalOpen}
        stepTitle={stepDef?.title ?? t("wizardTitle")}
        onClose={() => setSkipModalOpen(false)}
        onConfirm={handleSkipConfirm}
      />
    </Page>
  );
}
