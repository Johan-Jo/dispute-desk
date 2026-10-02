"use client";

/**
 * Liability-shift impact card — LSE-5 surface on the Insights page.
 *
 * Renders DisputeDesk's contribution to the merchant's VAMP / ECM
 * compliance posture: counterfactual ("what would your ratio be without
 * DisputeDesk?"), monthly wins by program, fees avoided, revenue
 * recovered.
 *
 * The OperationalCheckpoints section above this card already raises
 * threshold-proximity alerts. This card is the "and here's what we
 * did about it" companion — the value-delivered narrative.
 *
 * Figures are the statement month (last complete calendar month) from
 * `/api/ratios/current`, which uses the same computation as the
 * checkpoints — one VAMP number per page. A failed load renders an
 * explicit "not measured" line, never a vanished card.
 */

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
} from "@shopify/polaris";
import type { CheckpointSeverity } from "@/lib/insights/checkpoints.types";

/** `/api/ratios/current` — the statement month, computed by the same
 *  `computeProgrammeBlock` as the checkpoints on this page. */
interface CurrentSnapshot {
  periodMonth: string;
  periodState: "final" | "provisional";
  finalOn: string;
  cardFramingApplies: boolean;
  vamp: {
    ratio: number | null;
    ratioWithoutDd: number | null;
    severity: CheckpointSeverity | null;
    count: number;
    countFloor: number;
    thresholdEarlyWarning: number;
    thresholdExcessive: number;
  };
  mcEcm: {
    ratio: number | null;
    severity: CheckpointSeverity | null;
    lowerBound: boolean;
    count: number;
    countFloor: number;
    threshold: number;
  };
  impact: {
    ce30ExcludedCount: number;
    fptExcludedCount: number;
    estimatedFeesAvoidedUsd: number;
    estimatedRevenueRecoveredUsd: number;
  };
  calculatedAt: string | null;
}

const SEVERITY_TONE: Record<
  CheckpointSeverity,
  "success" | "info" | "attention" | "critical"
> = {
  healthy: "success",
  info: "info",
  consider: "attention",
  breach: "critical",
};

function fmtPct(n: number, digits = 2): string {
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtUsd(n: number): string {
  // No locale-specific formatting here — keep it deterministic for now.
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** Mid-month UTC noon, so no viewer time zone shifts the month. */
function monthDate(iso: string): Date {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 15, 12));
}

export function LiabilityShiftImpact() {
  const t = useTranslations("liabilityShift.impact");
  const format = useFormatter();
  const searchParams = useSearchParams();
  const shopId = searchParams.get("shop_id") ?? "";
  const [snapshot, setSnapshot] = useState<CurrentSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!shopId) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    fetch(`/api/ratios/current?shop_id=${encodeURIComponent(shopId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setSnapshot((data?.snapshot ?? null) as CurrentSnapshot | null);
        setFailed(!data || data.status === "error");
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [shopId]);

  if (!loaded) return null;

  // A failed or empty load is an explicit state, never a vanished card.
  if (failed || !snapshot) {
    return (
      <Card>
        <BlockStack gap="200">
          <Text as="h3" variant="headingMd">
            {t("title")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("notMeasured")}
          </Text>
        </BlockStack>
      </Card>
    );
  }

  const month = format.dateTime(monthDate(snapshot.periodMonth), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const totalWins =
    snapshot.impact.ce30ExcludedCount + snapshot.impact.fptExcludedCount;
  const vampDelta =
    snapshot.vamp.ratio !== null && snapshot.vamp.ratioWithoutDd !== null
      ? snapshot.vamp.ratioWithoutDd - snapshot.vamp.ratio
      : 0;
  const showImpactStrip = totalWins > 0 || vampDelta > 0;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack gap="200" align="space-between" blockAlign="start">
          <BlockStack gap="100">
            <Text as="h3" variant="headingMd">
              {t("title")}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {t("subtitle")}
            </Text>
          </BlockStack>
          <Text as="span" variant="bodySm" tone="subdued">
            {snapshot.periodState === "provisional"
              ? t("periodLabelProvisional", {
                  period: month,
                  finalOn: format.dateTime(new Date(snapshot.finalOn), {
                    day: "numeric",
                    month: "long",
                    timeZone: "UTC",
                  }),
                })
              : t("periodLabel", { period: month })}
          </Text>
        </InlineStack>

        {/* Pills only when card-network framing describes this merchant in
            this month — a green "healthy" for a PayPal book is as wrong as a
            red one. */}
        {snapshot.cardFramingApplies ? (
          <InlineStack gap="300" wrap>
            <RatioPill
              label={t("vamp.label")}
              ratio={snapshot.vamp.ratio}
              counterfactual={snapshot.vamp.ratioWithoutDd}
              thresholdText={t("threshold", {
                value: fmtPct(snapshot.vamp.thresholdEarlyWarning, 1),
              })}
              severity={snapshot.vamp.severity}
              t={t}
            />
            <RatioPill
              label={t("ecm.label")}
              ratio={snapshot.mcEcm.ratio}
              thresholdText={t("threshold", {
                value: fmtPct(snapshot.mcEcm.threshold, 1),
              })}
              qualifier={snapshot.mcEcm.lowerBound ? t("ecm.lowerBound") : undefined}
              severity={snapshot.mcEcm.severity}
              t={t}
            />
          </InlineStack>
        ) : (
          <Text as="p" variant="bodySm" tone="subdued">
            {t("notApplicable")}
          </Text>
        )}

        {/* Counterfactual + impact strip — only when there's something to show */}
        {showImpactStrip && (
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" tone="subdued">
              {t("counterfactualHeader")}
            </Text>
            <InlineStack gap="400" wrap>
              <ImpactTile
                label={t("tile.feesAvoided")}
                value={fmtUsd(snapshot.impact.estimatedFeesAvoidedUsd)}
                helper={t("tile.feesAvoidedHelper")}
              />
              <ImpactTile
                label={t("tile.revenueRecovered")}
                value={fmtUsd(snapshot.impact.estimatedRevenueRecoveredUsd)}
                helper={t("tile.revenueRecoveredHelper")}
              />
              <ImpactTile
                label={t("tile.ce30Wins")}
                value={snapshot.impact.ce30ExcludedCount.toString()}
                helper={t("tile.ce30WinsHelper")}
              />
              <ImpactTile
                label={t("tile.fptWins")}
                value={snapshot.impact.fptExcludedCount.toString()}
                helper={t("tile.fptWinsHelper")}
              />
            </InlineStack>
          </BlockStack>
        )}

        {/* Always-on footer disclosure: calculated estimate */}
        <Text as="p" variant="bodySm" tone="subdued">
          {t("estimateNotice")}
        </Text>
      </BlockStack>
    </Card>
  );
}

function RatioPill({
  label,
  ratio,
  counterfactual,
  thresholdText,
  qualifier,
  severity,
  t,
}: {
  label: string;
  /** NULL when the month has too little card volume to measure. Rendering
   *  0.00% would assert a clean pass against a programme that is not
   *  measuring this merchant. */
  ratio: number | null;
  counterfactual?: number | null;
  thresholdText: string;
  qualifier?: string;
  severity: CheckpointSeverity | null;
  t: ReturnType<typeof useTranslations>;
}) {
  const notMeasured = ratio === null;
  const showCounterfactual =
    !notMeasured &&
    counterfactual !== undefined &&
    counterfactual !== null &&
    counterfactual > (ratio as number) + 0.00001;
  return (
    <div
      style={{
        flex: "1 1 220px",
        minWidth: 220,
        padding: 16,
        borderRadius: 8,
        background: "#F6F6F7",
      }}
    >
      <BlockStack gap="100">
        <InlineStack gap="200" align="space-between" blockAlign="center">
          <Text as="span" variant="bodySm" tone="subdued">
            {label}
          </Text>
          {notMeasured || !severity ? null : (
            <Badge tone={SEVERITY_TONE[severity]}>{t(`severity.${severity}`)}</Badge>
          )}
        </InlineStack>
        <Text as="p" variant="headingLg" tone={notMeasured ? "subdued" : undefined}>
          {notMeasured ? "—" : fmtPct(ratio as number)}
        </Text>
        <Text as="span" variant="bodySm" tone="subdued">
          {notMeasured ? t("tooFewOrders") : thresholdText}
        </Text>
        {qualifier && !notMeasured ? (
          <Text as="span" variant="bodySm" tone="subdued">
            {qualifier}
          </Text>
        ) : null}
        {showCounterfactual && (
          <Text as="span" variant="bodySm" tone="subdued">
            {t("withoutDd", { value: fmtPct(counterfactual!) })}
          </Text>
        )}
      </BlockStack>
    </div>
  );
}

function ImpactTile({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div style={{ flex: "1 1 180px", minWidth: 180 }}>
      <BlockStack gap="050">
        <Text as="span" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="headingMd">
          {value}
        </Text>
        <Text as="span" variant="bodySm" tone="subdued">
          {helper}
        </Text>
      </BlockStack>
    </div>
  );
}
