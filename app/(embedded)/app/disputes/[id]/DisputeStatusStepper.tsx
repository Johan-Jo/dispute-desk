"use client";

import { BlockStack, Text, Badge, Icon, Box } from "@shopify/polaris";
import { CheckCircleIcon, ClockIcon, ClipboardIcon } from "@shopify/polaris-icons";
import type { DisputeProgressStep } from "@/lib/embedded/disputeDetailProgress";
import styles from "./dispute-detail.module.css";

type Translate = (key: string) => string;

function formatStepDate(iso: string | null, fmt: (s: string | null) => string): string {
  if (!iso) return "—";
  return fmt(iso);
}

function StepIcon({ phase }: { phase: "complete" | "current" | "pending" }) {
  if (phase === "complete") {
    return (
      <span style={{ display: "inline-flex", color: "var(--p-color-text-success)" }}>
        <Icon source={CheckCircleIcon} tone="success" />
      </span>
    );
  }
  if (phase === "current") {
    return (
      <span
        style={{
          display: "inline-flex",
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "#E0E7FF",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon source={ClipboardIcon} tone="info" />
      </span>
    );
  }
  return (
    <span
      style={{
        display: "inline-flex",
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: "#F2F4F7",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon source={ClockIcon} tone="subdued" />
    </span>
  );
}

function stepBadge(phase: "complete" | "current" | "pending", t: Translate) {
  if (phase === "complete") {
    return (
      <Badge tone="success" size="small">
        {t("disputes.progress.badgeCompleted")}
      </Badge>
    );
  }
  if (phase === "current") {
    return (
      <Badge tone="info" size="small">
        {t("disputes.progress.badgeCurrent")}
      </Badge>
    );
  }
  return (
    <Badge tone="attention" size="small">
      {t("disputes.progress.badgePending")}
    </Badge>
  );
}

export function DisputeStatusStepper({
  steps,
  t,
  formatDate,
}: {
  steps: DisputeProgressStep[];
  t: Translate;
  formatDate: (iso: string | null) => string;
}) {
  return (
    <Box background="bg-surface" borderWidth="025" borderColor="border" borderRadius="200">
      <div className={styles.stepperHeader}>
        <Text as="h2" variant="headingSm">
          {t("disputes.statusProgressTitle")}
        </Text>
      </div>
      <div className={styles.stepperTrack}>
        {steps.map((s) => (
          <div key={s.id} className={styles.stepperStep}>
            <BlockStack gap="200" inlineAlign="center">
              <div className={styles.stepperIconWrap}>
                <StepIcon phase={s.phase} />
              </div>
              <p className={styles.stepperTitle}>{t(s.titleKey)}</p>
              <p className={styles.stepperDesc}>{t(s.descriptionKey)}</p>
              <p className={styles.stepperDate}>
                {formatStepDate(s.date, formatDate)}
              </p>
              {stepBadge(s.phase, t)}
            </BlockStack>
          </div>
        ))}
      </div>
    </Box>
  );
}
