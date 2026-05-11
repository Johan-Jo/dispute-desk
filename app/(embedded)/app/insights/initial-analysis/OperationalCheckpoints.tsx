"use client";

/**
 * Operational Checkpoints card — renders the rule-engine output as a
 * compact list of observations on the Chargeback Exposure page.
 *
 * Each row carries:
 *   - a colored severity pip (green / grey / amber / red)
 *   - a title line (i18n-interpolated)
 *   - a body line (i18n-interpolated)
 *   - an optional source citation
 *
 * Severity colors are intentionally muted — red is reserved for
 * actual network-threshold breaches (VAMP / ECM); operational
 * attention is amber, not crisis.
 */

import { useTranslations } from "next-intl";
import { Card, BlockStack, Text } from "@shopify/polaris";
import type {
  Checkpoint,
  CheckpointSeverity,
} from "@/lib/insights/checkpoints.types";
import styles from "./initial-analysis.module.css";

const SEVERITY_COLOR: Record<CheckpointSeverity, string> = {
  healthy: "#10B981", // emerald
  info: "#9CA3AF",    // neutral grey
  consider: "#D97706", // amber-600
  breach: "#DC2626",  // red — actual threshold breach only
};

export function OperationalCheckpoints({
  checkpoints,
}: {
  checkpoints: Checkpoint[];
}) {
  const t = useTranslations();

  if (checkpoints.length === 0) return null;

  return (
    <Card>
      <BlockStack gap="300">
        <BlockStack gap="050">
          <Text as="h3" variant="headingMd">
            {t("fraudIntel.checkpointsTitle")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("fraudIntel.checkpointsSubtitle")}
          </Text>
        </BlockStack>

        <div className={styles.checkpointList}>
          {checkpoints.map((c) => (
            <CheckpointRow key={c.id} checkpoint={c} t={t} />
          ))}
        </div>
      </BlockStack>
    </Card>
  );
}

function CheckpointRow({
  checkpoint,
  t,
}: {
  checkpoint: Checkpoint;
  t: ReturnType<typeof useTranslations>;
}) {
  const color = SEVERITY_COLOR[checkpoint.severity];
  return (
    <div className={styles.checkpointRow}>
      <span
        className={styles.checkpointPip}
        style={{ background: color }}
        aria-hidden
      />
      <div className={styles.checkpointBody}>
        <Text as="p" variant="bodyMd" fontWeight="semibold">
          {t(checkpoint.titleKey, checkpoint.values)}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {t(checkpoint.bodyKey, checkpoint.values)}
        </Text>
        {checkpoint.source ? (
          <a
            href={checkpoint.source.url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.checkpointSource}
          >
            {t("fraudIntel.checkpointSourcePrefix")}: {checkpoint.source.label}
          </a>
        ) : null}
      </div>
    </div>
  );
}
