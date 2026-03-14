"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Icon,
  Spinner,
  Box,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  XCircleIcon,
} from "@shopify/polaris-icons";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { withShopParams } from "@/lib/withShopParams";
import { SETUP_STEPS } from "@/lib/setup/constants";
import { openInAdmin } from "@/lib/embedded/openInAdmin";
import { ProgressRing } from "./ProgressRing";
import type { StepId, StepState, SetupStateResponse } from "@/lib/setup/types";

export function SetupChecklistCard() {
  const t = useTranslations("setup");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<SetupStateResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/setup/state");
      if (res.ok) {
        const data: SetupStateResponse = await res.json();
        setState(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  const navigateToStep = useCallback(
    (stepId: StepId) => {
      const url = withShopParams(`/app/setup/${stepId}`, searchParams);
      router.push(url);
    },
    [router, searchParams]
  );

  const handleContinueSetup = useCallback(() => {
    if (state?.nextStepId) {
      navigateToStep(state.nextStepId);
    }
  }, [state, navigateToStep]);

  const handleUndoSkip = useCallback(
    async (stepId: StepId) => {
      await fetch("/api/setup/undo-skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId }),
      });
      await fetchState();
      navigateToStep(stepId);
    },
    [fetchState, navigateToStep]
  );

  const handleOpenInAdmin = useCallback(
    async (stepId: StepId) => {
      openInAdmin({ newContext: true });
      await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId, payload: {} }),
      });
      await fetchState();
    },
    [fetchState]
  );

  if (loading) {
    return (
      <Card>
        <BlockStack gap="400" inlineAlign="center">
          <Spinner size="small" />
        </BlockStack>
      </Card>
    );
  }

  if (!state || state.allDone) {
    return null;
  }

  const { steps, progress } = state;

  return (
    <Card>
      <BlockStack gap="400">
        {/* Header */}
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="400" blockAlign="center">
            <ProgressRing completed={progress.doneCount} total={progress.total} />
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                {t("checklistTitle")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {progress.total - progress.doneCount === 1
                  ? t("stepsRemaining", { count: 1 })
                  : t("stepsRemainingPlural", { count: progress.total - progress.doneCount })}
              </Text>
            </BlockStack>
          </InlineStack>
          <Button variant="plain" url="/app/help">
            {t("needHelp")}
          </Button>
        </InlineStack>

        {/* Checklist rows */}
        <BlockStack gap="200">
          {SETUP_STEPS.map((stepDef) => {
            const stepState: StepState = steps[stepDef.id] ?? { status: "todo" };
            const isDone = stepState.status === "done";
            const isSkipped = stepState.status === "skipped";

            return (
              <Box
                key={stepDef.id}
                padding="200"
                borderRadius="200"
                background={isDone ? "bg-surface-success" : undefined}
              >
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="300" blockAlign="center">
                    {isDone ? (
                      <div style={{ color: "#008060" }}>
                        <Icon source={CheckCircleIcon} />
                      </div>
                    ) : isSkipped ? (
                      <div style={{ opacity: 0.4 }}>
                        <Icon source={XCircleIcon} tone="subdued" />
                      </div>
                    ) : (
                      <div style={{ width: 20, height: 20, borderRadius: "50%", border: "2px solid #8C9196" }} />
                    )}
                    <Text
                      as="span"
                      variant="bodyMd"
                      tone={isSkipped ? "subdued" : undefined}
                    >
                      {stepDef.dashboardLabel}
                    </Text>
                  </InlineStack>

                  {isDone && (
                    <Badge tone="success">{t("done")}</Badge>
                  )}
                  {isSkipped && (
                    <Button
                      variant="plain"
                      onClick={() => handleUndoSkip(stepDef.id)}
                    >
                      {t("undoSkip")}
                    </Button>
                  )}
                  {!isDone && !isSkipped && (
                    stepDef.id === "open_in_admin" ? (
                      <Button
                        variant="plain"
                        onClick={() => handleOpenInAdmin(stepDef.id)}
                      >
                        {t("openInAdmin.checklistAction")}
                      </Button>
                    ) : (
                      <Button
                        variant="plain"
                        onClick={() => navigateToStep(stepDef.id)}
                      >
                        {t("complete")}
                      </Button>
                    )
                  )}
                </InlineStack>
              </Box>
            );
          })}
        </BlockStack>

        {/* Actions */}
        <BlockStack gap="200">
          <Button variant="primary" onClick={handleContinueSetup}>
            {t("continueSetup")}
          </Button>
          <InlineStack align="center">
            <Button variant="plain" url="mailto:support@disputedesk.com?subject=Setup%20call%20request">
              {t("bookSetupCall")}
            </Button>
          </InlineStack>
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
