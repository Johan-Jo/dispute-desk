"use client";

/**
 * Operational Checkpoints card — renders the rule-engine output as a
 * scannable stack of severity-coded cards.
 *
 * Visual hierarchy:
 *   1. A summary chip strip at the top — counts per severity.
 *   2. One mini-card per checkpoint, with a coloured left-border
 *      stripe + severity icon + Polaris Badge in the title row.
 *
 * Severity colors are intentionally muted — red is reserved for
 * actual network-threshold breaches (VAMP / ECM); operational
 * attention is amber, not crisis.
 */

import { useFormatter, useTranslations } from "next-intl";
import { Card, BlockStack, Text, Badge, Icon } from "@shopify/polaris";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  InfoIcon,
} from "@shopify/polaris-icons";
import type {
  Checkpoint,
  CheckpointSeverity,
} from "@/lib/insights/checkpoints.types";
import type { ProgrammeMonth } from "@/lib/insights/period/computeProgrammeBlock";
import styles from "./initial-analysis.module.css";

type BadgeTone =
  | "success"
  | "info"
  | "attention"
  | "warning"
  | "critical"
  | undefined;

const SEVERITY_BORDER: Record<CheckpointSeverity, string> = {
  healthy: "#10B981",
  info: "#9CA3AF",
  consider: "#D97706",
  breach: "#DC2626",
};

const SEVERITY_BADGE_TONE: Record<CheckpointSeverity, BadgeTone> = {
  healthy: "success",
  info: "info",
  consider: "attention",
  breach: "critical",
};

const SEVERITY_ICON_SOURCE: Record<
  CheckpointSeverity,
  typeof CheckCircleIcon
> = {
  healthy: CheckCircleIcon,
  info: InfoIcon,
  consider: AlertCircleIcon,
  breach: AlertTriangleIcon,
};

const SEVERITY_ICON_CLASS: Record<CheckpointSeverity, string> = {
  healthy: styles.checkpointIcon_healthy,
  info: styles.checkpointIcon_info,
  consider: styles.checkpointIcon_consider,
  breach: styles.checkpointIcon_breach,
};

/** Mid-month (or mid-day) UTC noon so no viewer time zone shifts a date. */
function isoToDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d === 1 ? 15 : d!, 12));
}

export function OperationalCheckpoints({
  checkpoints,
  programmeMonth,
}: {
  checkpoints: Checkpoint[];
  programmeMonth?: ProgrammeMonth;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const monthLabel = (iso: string) =>
    format.dateTime(isoToDate(iso), { month: "long", year: "numeric", timeZone: "UTC" });

  // Which month the card-network figures describe, and whether they are
  // final. An error is said out loud here instead of failing the page.
  const programmeNote = !programmeMonth
    ? null
    : programmeMonth.status === "error"
      ? t("fraudIntel.programmeUnavailable")
      : programmeMonth.periodState === "provisional"
        ? t("fraudIntel.programmeProvisional", {
            month: monthLabel(programmeMonth.periodMonth),
            finalOn: format.dateTime(new Date(programmeMonth.finalOn), {
              day: "numeric",
              month: "long",
              timeZone: "UTC",
            }),
          })
        : t("fraudIntel.programmeFinal", { month: monthLabel(programmeMonth.periodMonth) });

  if (checkpoints.length === 0 && !programmeNote) return null;

  // Checkpoint values carry ISO months; the month name is a locale decision
  // made here, not in lib/.
  const localized = checkpoints.map((c) =>
    typeof c.values.month === "string"
      ? { ...c, values: { ...c.values, month: monthLabel(c.values.month) } }
      : c,
  );

  const counts: Record<CheckpointSeverity, number> = {
    healthy: 0,
    info: 0,
    consider: 0,
    breach: 0,
  };
  for (const c of localized) counts[c.severity] += 1;

  // Render order: breaches first, then consider, then info, then healthy.
  const sorted = [...localized].sort(
    (a, b) => severityOrder(a.severity) - severityOrder(b.severity),
  );

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="050">
          <Text as="h3" variant="headingMd">
            {t("fraudIntel.checkpointsTitle")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("fraudIntel.checkpointsSubtitle")}
          </Text>
          {programmeNote ? (
            <Text as="p" variant="bodySm" tone="subdued">
              {programmeNote}
            </Text>
          ) : null}
        </BlockStack>

        {/* Summary chips — one per non-empty severity bucket */}
        <div className={styles.checkpointSummary}>
          {(
            ["breach", "consider", "info", "healthy"] as CheckpointSeverity[]
          ).map((sev) => {
            const n = counts[sev];
            if (n === 0) return null;
            return (
              <span key={sev} className={styles.checkpointSummaryChip}>
                <span style={{ background: SEVERITY_BORDER[sev] }} />
                {n} {t(`fraudIntel.checkpointSummary.${sev}` as
                  | "fraudIntel.checkpointSummary.breach"
                  | "fraudIntel.checkpointSummary.consider"
                  | "fraudIntel.checkpointSummary.info"
                  | "fraudIntel.checkpointSummary.healthy")}
              </span>
            );
          })}
        </div>

        <div className={styles.checkpointList}>
          {sorted.map((c) => (
            <CheckpointCard key={c.id} checkpoint={c} t={t} />
          ))}
        </div>
      </BlockStack>
    </Card>
  );
}

function CheckpointCard({
  checkpoint,
  t,
}: {
  checkpoint: Checkpoint;
  t: ReturnType<typeof useTranslations>;
}) {
  const IconSource = SEVERITY_ICON_SOURCE[checkpoint.severity];
  return (
    <div
      className={styles.checkpointCard}
      style={{ borderLeftColor: SEVERITY_BORDER[checkpoint.severity] }}
    >
      <span
        className={`${styles.checkpointIcon} ${SEVERITY_ICON_CLASS[checkpoint.severity]}`}
        aria-hidden
      >
        <Icon source={IconSource} />
      </span>
      <div className={styles.checkpointBody}>
        <div className={styles.checkpointTitleRow}>
          <Text as="p" variant="bodyMd" fontWeight="semibold">
            {t(checkpoint.titleKey, checkpoint.values)}
          </Text>
          <Badge tone={SEVERITY_BADGE_TONE[checkpoint.severity]}>
            {t(
              `fraudIntel.checkpointSeverity.${checkpoint.severity}` as
                | "fraudIntel.checkpointSeverity.breach"
                | "fraudIntel.checkpointSeverity.consider"
                | "fraudIntel.checkpointSeverity.info"
                | "fraudIntel.checkpointSeverity.healthy",
            )}
          </Badge>
        </div>
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

function severityOrder(s: CheckpointSeverity): number {
  switch (s) {
    case "breach":
      return 0;
    case "consider":
      return 1;
    case "info":
      return 2;
    case "healthy":
      return 3;
  }
}
