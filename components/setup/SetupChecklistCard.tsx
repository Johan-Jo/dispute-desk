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
import { withShopParams } from "@/lib/withShopParams";
import { SETUP_STEPS } from "@/lib/setup/constants";
import { ProgressRing } from "./ProgressRing";
import type { StepId, StepState, SetupStateResponse } from "@/lib/setup/types";

export function SetupChecklistCard() {
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
                Setup Checklist
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {progress.total - progress.doneCount} step
                {progress.total - progress.doneCount !== 1 ? "s" : ""} remaining
              </Text>
            </BlockStack>
          </InlineStack>
          <Button variant="plain" url="/app/help">
            Need help?
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
                    <Badge tone="success">Done</Badge>
                  )}
                  {isSkipped && (
                    <Button
                      variant="plain"
                      onClick={() => handleUndoSkip(stepDef.id)}
                    >
                      Undo skip
                    </Button>
                  )}
                  {!isDone && !isSkipped && (
                    <Button
                      variant="plain"
                      onClick={() => navigateToStep(stepDef.id)}
                    >
                      Complete
                    </Button>
                  )}
                </InlineStack>
              </Box>
            );
          })}
        </BlockStack>

        {/* Actions */}
        <BlockStack gap="200">
          <Button variant="primary" onClick={handleContinueSetup}>
            Continue setup →
          </Button>
          <InlineStack align="center">
            <Button variant="plain" url="mailto:support@disputedesk.com?subject=Setup%20call%20request">
              Book a 15-min setup call
            </Button>
          </InlineStack>
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
