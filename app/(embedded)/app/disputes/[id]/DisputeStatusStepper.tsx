"use client";

import { Text, Badge, Icon, Box } from "@shopify/polaris";
import { CheckCircleIcon, ClockIcon, ClipboardIcon } from "@shopify/polaris-icons";
import type { DisputeProgressStep } from "@/lib/embedded/disputeDetailProgress";
import styles from "./dispute-detail.module.css";

type Translate = (key: string) => string;

function formatStepDate(iso: string | null, fmt: (s: string | null) => string): string {
  if (!iso) return "Date N/A";
  return fmt(iso);
}

function StepIcon({ phase }: { phase: "complete" | "current" | "pending" }) {
  if (phase === "complete") {
    return (
      <div className={styles.stepperIconCircle} data-phase="complete">
        <Icon source={CheckCircleIcon} tone="success" />
      </div>
    );
  }
  if (phase === "current") {
    return (
      <div className={styles.stepperIconCircle} data-phase="current">
        <Icon source={ClipboardIcon} tone="info" />
      </div>
    );
  }
  return (
    <div className={styles.stepperIconCircle} data-phase="pending">
      <Icon source={ClockIcon} tone="subdued" />
    </div>
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
    <div className={styles.stepperShell}>
      <Box background="bg-surface" borderWidth="025" borderColor="border" borderRadius="200" width="100%">
        <div className={styles.stepperHeader}>
          <Text as="h2" variant="headingSm">
            {t("disputes.statusProgressTitle")}
          </Text>
        </div>

        {/* Connecting line track */}
        <div className={styles.stepperBody}>
          <div className={styles.stepperConnectorTrack}>
            {steps.map((s, i) => {
              if (i === steps.length - 1) return null;
              const nextPhase = steps[i + 1].phase;
              const lineComplete = s.phase === "complete" && nextPhase === "complete";
              return (
                <div
                  key={`line-${s.id}`}
                  className={`${styles.stepperConnectorSegment} ${lineComplete ? styles.stepperConnectorComplete : styles.stepperConnectorPending}`}
                />
              );
            })}
          </div>

          <div className={styles.stepperTrack}>
            {steps.map((s) => (
              <div key={s.id} className={styles.stepperStep}>
                <div className={styles.stepperIconWrap}>
                  <StepIcon phase={s.phase} />
                </div>
                <p className={styles.stepperTitle}>{t(s.titleKey)}</p>
                <p className={styles.stepperDesc}>{t(s.descriptionKey)}</p>
                <p className={styles.stepperDate}>
                  {formatStepDate(s.date, formatDate)}
                </p>
                {stepBadge(s.phase, t)}
              </div>
            ))}
          </div>
        </div>
      </Box>
    </div>
  );
}
