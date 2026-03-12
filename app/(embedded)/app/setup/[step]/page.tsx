"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { Page, Layout, Card, BlockStack, Spinner, Text } from "@shopify/polaris";
import { STEP_IDS } from "@/lib/setup/constants";
import type { StepId } from "@/lib/setup/types";
import { SetupWizardShell } from "@/components/setup/SetupWizardShell";
import { WelcomeGoalsStep } from "@/components/setup/steps/WelcomeGoalsStep";
import { PermissionsStep } from "@/components/setup/steps/PermissionsStep";
import { SyncDisputesStep } from "@/components/setup/steps/SyncDisputesStep";
import { BusinessPoliciesStep } from "@/components/setup/steps/BusinessPoliciesStep";
import { AutomationRulesStep } from "@/components/setup/steps/AutomationRulesStep";
import { TeamNotificationsStep } from "@/components/setup/steps/TeamNotificationsStep";
import { PacksStep } from "@/components/setup/steps/PacksStep";
import { BillingStep } from "@/components/setup/steps/BillingStep";
import { SettingsStep } from "@/components/setup/steps/SettingsStep";
import { HelpStep } from "@/components/setup/steps/HelpStep";

const stepComponentProps = { stepId: "" as StepId, onSaveRef: { current: null as (() => Promise<boolean>) | null } };
type StepComponentType = React.ComponentType<typeof stepComponentProps>;

function StepPageInner() {
  const params = useParams<{ step: string }>();
  const stepId = params.step as StepId;

  if (!STEP_IDS.includes(stepId)) {
    return (
      <Page title="Setup Wizard">
        <Layout>
          <Layout.Section>
            <Card>
              <Text as="p" variant="bodyMd">
                Step not found. Please return to the dashboard.
              </Text>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const stepComponents: Record<StepId, StepComponentType> = {
    permissions: PermissionsStep,
    overview: WelcomeGoalsStep,
    disputes: SyncDisputesStep,
    packs: PacksStep,
    rules: AutomationRulesStep,
    policies: BusinessPoliciesStep,
    billing: BillingStep,
    team: TeamNotificationsStep,
    settings: SettingsStep,
    help: HelpStep,
  };

  const StepComponent = stepComponents[stepId];
  const saveRef = { current: null as (() => Promise<boolean>) | null };

  const handleSave = async (): Promise<boolean> => {
    if (saveRef.current) {
      return saveRef.current();
    }
    const res = await fetch("/api/setup/step", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stepId, payload: {} }),
    });
    return res.ok;
  };

  return (
    <SetupWizardShell stepId={stepId} onSave={handleSave}>
      <StepComponent stepId={stepId} onSaveRef={saveRef} />
    </SetupWizardShell>
  );
}

export default function SetupStepPage() {
  return (
    <Suspense
      fallback={
        <Page title="Setup Wizard">
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
