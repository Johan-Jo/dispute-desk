/**
 * FIGMA SCREEN MAPPING (file key: 5o2yOdPqVmvwjaK8eTeUUx)
 * Route: app/(embedded)/app/setup/[step]/page.tsx
 * Figma Make source: src/app/pages/shopify/onboarding-wizard.tsx
 * 5-step onboarding wizard: Connection → Store Profile → Handling → Policies → Activate
 */
"use client";

/** Avoid stale HTML shell from CDNs when merchants refresh mid-wizard after a deploy. */
export const dynamic = "force-dynamic";

import { Suspense, useCallback, useState } from "react";
import { useParams } from "next/navigation";
import { Page, Layout, Card, BlockStack, Spinner, Text } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import { resolveStepId } from "@/lib/setup/constants";
import { normalizeSetupStepParam } from "@/lib/setup/normalizeStepParam";
import type { StepId } from "@/lib/setup/types";
import { SetupWizardShell } from "@/components/setup/SetupWizardShell";
import { ConnectionStep } from "@/components/setup/steps/ConnectionStep";
import { StoreProfileStep } from "@/components/setup/steps/StoreProfileStep";
import { HandlingStep } from "@/components/setup/steps/HandlingStep";
import { BusinessPoliciesStep } from "@/components/setup/steps/BusinessPoliciesStep";
import { ActivateStep } from "@/components/setup/steps/ActivateStep";

const _stepComponentProps = { stepId: "" as StepId, onSaveRef: { current: null as (() => Promise<boolean>) | null } };
type StepComponentType = React.ComponentType<typeof _stepComponentProps & { onCanContinueChange?: (canContinue: boolean) => void }>;

const stepComponents: Record<StepId, StepComponentType> = {
  connection: ConnectionStep as StepComponentType,
  store_profile: StoreProfileStep as StepComponentType,
  handling: HandlingStep as StepComponentType,
  policies: BusinessPoliciesStep as StepComponentType,
  activate: ActivateStep as StepComponentType,
};

function StepPageInner() {
  const t = useTranslations("setup");
  const params = useParams<{ step: string }>();
  // resolveStepId maps legacy slugs onto canonical ids, so a bookmarked
  // /app/setup/coverage or /app/setup/automation renders the merged Handling
  // step instead of the not-found card.
  const stepId = resolveStepId(normalizeSetupStepParam(params.step));
  const [canContinue, setCanContinue] = useState(true);

  const handleCanContinueChange = useCallback((value: boolean) => {
    setCanContinue(value);
  }, []);

  if (!stepId) {
    return (
      <Page title={t("wizardTitle")}>
        <Layout>
          <Layout.Section>
            <Card>
              <Text as="p" variant="bodyMd">
                {t("wizardTitle")}
              </Text>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const StepComponent = stepComponents[stepId];
  const saveRef = { current: null as (() => Promise<boolean>) | null };

  const handleSave = async (): Promise<boolean> => {
    if (saveRef.current) {
      return saveRef.current();
    }
    // Default: just advance (Step 1 uses this path — no persistence)
    return true;
  };

  return (
    <SetupWizardShell stepId={stepId} onSave={handleSave} canContinue={canContinue} noCard={stepId === "handling" || stepId === "policies" || stepId === "activate"}>
      <StepComponent
        stepId={stepId}
        onSaveRef={saveRef}
        onCanContinueChange={handleCanContinueChange}
      />
    </SetupWizardShell>
  );
}

export default function SetupStepPage() {
  const t = useTranslations("setup");
  return (
    <Suspense
      fallback={
        <Page title={t("wizardTitle")}>
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
      }
    >
      <StepPageInner />
    </Suspense>
  );
}
