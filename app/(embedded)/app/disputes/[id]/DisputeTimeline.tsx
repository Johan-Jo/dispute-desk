"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  Card,
  Text,
  Badge,
  Spinner,
  BlockStack,
  InlineStack,
  Box,
  Collapsible,
  Icon,
} from "@shopify/polaris";
import { ChevronDownIcon } from "@shopify/polaris-icons";
import styles from "./dispute-detail.module.css";

// ─── Types ──────────────────────────────────────────────────────────────

interface TimelineEvent {
  id: string;
  event_type: string;
  description: string | null;
  event_at: string;
  actor_type: string;
  source_type: string;
  visibility: string;
  metadata_json: Record<string, unknown>;
}

interface TimelineSummary {
  normalizedStatus: string | null;
  statusReason: string | null;
  submissionState: string | null;
  nextAction: { type: string; text: string } | null;
  submittedAt: string | null;
  closedAt: string | null;
  finalOutcome: string | null;
  outcomeAmountRecovered: number | null;
  outcomeAmountLost: number | null;
  evidenceSavedAt: string | null;
  amount: number | null;
  currencyCode: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────

const STATUS_BADGE_TONE: Record<string, "success" | "critical" | "warning" | "info" | "attention"> = {
  won: "success",
  lost: "critical",
  new: "info",
  in_progress: "info",
  needs_review: "attention",
  ready_to_submit: "attention",
  action_needed: "warning",
  submitted: "info",
  waiting_on_issuer: "info",
  accepted_not_contested: "success",
  closed_other: "success",
};

const DOT_COLOR: Record<string, string> = {
  dispute_opened: "#1d4ed8",
  pack_created: "#1d4ed8",
  pdf_rendered: "#1d4ed8",
  auto_build_triggered: "#1d4ed8",
  auto_save_triggered: "#1d4ed8",
  parked_for_review: "#d97706",
  pack_blocked: "#d97706",
  merchant_approved_for_save: "#1d4ed8",
  evidence_saved_to_shopify: "#059669",
  submission_confirmed: "#059669",
  outcome_detected: "#059669",
  dispute_closed: "#6b7280",
  status_changed: "#1d4ed8",
  due_date_changed: "#d97706",
  sync_failed: "#dc2626",
  pack_build_failed: "#dc2626",
  evidence_save_failed: "#dc2626",
};

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAmount(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency ?? "USD",
    }).format(amount);
  } catch {
    return `${currency ?? "$"}${amount}`;
  }
}

// ─── Component ──────────────────────────────────────────────────────────

export default function DisputeTimeline({ disputeId }: { disputeId: string }) {
  const t = useTranslations("disputeTimeline");
  const locale = useLocale();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [summary, setSummary] = useState<TimelineSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(true);

  const fetchTimeline = useCallback(async () => {
    try {
      const res = await fetch(`/api/disputes/${disputeId}/timeline`);
      if (!res.ok) return;
      const data = await res.json();
      setEvents(data.events ?? []);
      setSummary(data.summary ?? null);
    } finally {
      setLoading(false);
    }
  }, [disputeId]);

  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  if (loading) {
    return (
      <Card>
        <Box padding="400">
          <InlineStack align="center">
            <Spinner size="small" />
          </InlineStack>
        </Box>
      </Card>
    );
  }

  if (!summary) return null;

  const outcomeTone = summary.finalOutcome === "won"
    ? "success"
    : summary.finalOutcome === "lost"
      ? "critical"
      : summary.finalOutcome
        ? "warning"
        : undefined;

  return (
    <BlockStack gap="400">
      {/* Summary card */}
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingSm">{t("summary")}</Text>

          {/* Status + Submission state row */}
          <div className={styles.summaryGrid}>
            <div>
              <Text as="p" variant="bodySm" tone="subdued">{t("currentStatus")}</Text>
              {summary.normalizedStatus ? (
                <Badge tone={STATUS_BADGE_TONE[summary.normalizedStatus] ?? undefined}>
                  {safeT(t, `normalizedStatuses.${summary.normalizedStatus}`, summary.normalizedStatus)}
                </Badge>
              ) : (
                <Text as="p" variant="bodyMd">—</Text>
              )}
            </div>
            <div>
              <Text as="p" variant="bodySm" tone="subdued">{t("submissionStatus")}</Text>
              <Text as="p" variant="bodyMd">
                {safeT(t, `submissionStates.${summary.submissionState ?? "not_saved"}`, summary.submissionState ?? "—")}
              </Text>
            </div>
            <div>
              <Text as="p" variant="bodySm" tone="subdued">{t("amountAtRisk")}</Text>
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                {formatAmount(summary.amount, summary.currencyCode)}
              </Text>
            </div>
            {summary.finalOutcome && (
              <div>
                <Text as="p" variant="bodySm" tone="subdued">{t("finalOutcome")}</Text>
                <Badge tone={outcomeTone}>
                  {safeT(t, `outcomes.${summary.finalOutcome}`, summary.finalOutcome)}
                </Badge>
              </div>
            )}
          </div>

          {/* Key dates */}
          <div className={styles.summaryGrid}>
            {summary.evidenceSavedAt && (
              <div>
                <Text as="p" variant="bodySm" tone="subdued">{t("evidenceSavedAt")}</Text>
                <Text as="p" variant="bodyMd">{formatDate(summary.evidenceSavedAt, locale)}</Text>
              </div>
            )}
            {summary.submittedAt && (
              <div>
                <Text as="p" variant="bodySm" tone="subdued">{t("submittedAt")}</Text>
                <Text as="p" variant="bodyMd">{formatDate(summary.submittedAt, locale)}</Text>
              </div>
            )}
            {summary.closedAt && (
              <div>
                <Text as="p" variant="bodySm" tone="subdued">{t("closedAt")}</Text>
                <Text as="p" variant="bodyMd">{formatDate(summary.closedAt, locale)}</Text>
              </div>
            )}
            {summary.outcomeAmountRecovered != null && summary.outcomeAmountRecovered > 0 && (
              <div>
                <Text as="p" variant="bodySm" tone="subdued">{t("amountRecovered")}</Text>
                <Text as="p" variant="bodyMd" tone="success">
                  {formatAmount(summary.outcomeAmountRecovered, summary.currencyCode)}
                </Text>
              </div>
            )}
            {summary.outcomeAmountLost != null && summary.outcomeAmountLost > 0 && (
              <div>
                <Text as="p" variant="bodySm" tone="subdued">{t("amountLost")}</Text>
                <Text as="p" variant="bodyMd" tone="critical">
                  {formatAmount(summary.outcomeAmountLost, summary.currencyCode)}
                </Text>
              </div>
            )}
          </div>

          {/* Next action */}
          {summary.nextAction && (
            <div className={styles.nextActionBanner}>
              <Text as="p" variant="bodySm" fontWeight="semibold">{t("nextAction")}</Text>
              <Text as="p" variant="bodySm">{summary.nextAction.text}</Text>
            </div>
          )}
        </BlockStack>
      </Card>

      {/* Event timeline */}
      {events.length > 0 && (
        <Card padding="0">
          <div
            className={styles.collapsibleHeader}
            onClick={() => setTimelineOpen((v) => !v)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setTimelineOpen((v) => !v);
            }}
          >
            <Text as="h2" variant="headingSm">{t("title")}</Text>
            <span className={`${styles.collapsibleHeaderIcon} ${timelineOpen ? styles.collapsibleHeaderIconOpen : ""}`}>
              <Icon source={ChevronDownIcon} tone="subdued" />
            </span>
          </div>
          <Collapsible
            open={timelineOpen}
            id="dispute-timeline"
            transition={{ duration: "200ms", timingFunction: "ease-in-out" }}
          >
            <Box padding="400">
              <div className={styles.timelineList}>
                {events.map((event, idx) => (
                  <div
                    key={event.id}
                    className={`${styles.timelineRow} ${idx < events.length - 1 ? styles.timelineRowSpaced : ""}`}
                  >
                    <div className={styles.timelineRail}>
                      <div
                        className={styles.timelineDot}
                        style={{ background: DOT_COLOR[event.event_type] ?? "#1d4ed8" }}
                      />
                      {idx < events.length - 1 ? <div className={styles.timelineLine} /> : null}
                    </div>
                    <div style={{ flex: 1 }}>
                      <p className={styles.timelineMeta}>
                        {formatDate(event.event_at, locale)}
                        {" · "}
                        {safeT(t, `actors.${event.actor_type}`, event.actor_type)}
                      </p>
                      <p className={styles.timelineLabel}>
                        {safeT(t, `eventTypes.${event.event_type}`, event.event_type)}
                      </p>
                      {event.description && (
                        <p className={styles.timelineSub}>{event.description}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Box>
          </Collapsible>
        </Card>
      )}

      {events.length === 0 && (
        <Card>
          <Box padding="400">
            <Text as="p" variant="bodySm" tone="subdued">{t("noEvents")}</Text>
          </Box>
        </Card>
      )}
    </BlockStack>
  );
}

/** Safely try a translation key, returning fallback if the key doesn't exist. */
function safeT(
  t: (key: string) => string,
  key: string,
  fallback: string,
): string {
  try {
    const result = t(key);
    // next-intl returns the key path if missing
    return result === key || result.startsWith("disputeTimeline.") ? fallback : result;
  } catch {
    return fallback;
  }
}
