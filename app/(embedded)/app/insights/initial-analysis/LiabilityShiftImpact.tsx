"use client";

/**
 * Liability-shift impact card — LSE-5 surface on the Insights page.
 *
 * Renders DisputeDesk's contribution to the merchant's VAMP / ECM / EFM
 * compliance posture: counterfactual ("what would your ratio be without
 * DisputeDesk?"), monthly wins by program, fees avoided, revenue
 * recovered.
 *
 * The OperationalCheckpoints section above this card already raises
 * threshold-proximity alerts. This card is the "and here's what we
 * did about it" companion — the value-delivered narrative.
 *
 * Renders null until the nightly /api/cron/calculate-ratios job has
 * populated at least one ratio_snapshots row. No skeleton flash on
 * first install — disappears entirely.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
} from "@shopify/polaris";

type Band = "green" | "yellow" | "red";

interface CurrentSnapshot {
  periodMonth: string;
  vamp: {
    ratio: number;
    ratioWithoutDd: number;
    band: Band;
    thresholdStandard: number;
    thresholdExcessive: number;
  };
  mcEcm: { ratio: number; band: Band; threshold: number };
  mcEfm: { ratio: number; band: Band; threshold: number };
  impact: {
    ce30ExcludedCount: number;
    fptExcludedCount: number;
    estimatedFeesAvoidedUsd: number;
    estimatedRevenueRecoveredUsd: number;
  };
  calculatedAt: string;
}

const BAND_TONE: Record<Band, "success" | "attention" | "warning"> = {
  green: "success",
  yellow: "attention",
  red: "warning",
};

function fmtPct(n: number, digits = 2): string {
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtUsd(n: number): string {
  // No locale-specific formatting here — keep it deterministic for now.
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function LiabilityShiftImpact() {
  const t = useTranslations("liabilityShift.impact");
  const searchParams = useSearchParams();
  const shopId = searchParams.get("shop_id") ?? "";
  const [snapshot, setSnapshot] = useState<CurrentSnapshot | null>(null);
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
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [shopId]);

  // Don't render until we've checked. Hide entirely when no snapshot
  // (nightly cron hasn't populated yet on first install).
  if (!loaded || !snapshot) return null;

  const totalWins =
    snapshot.impact.ce30ExcludedCount + snapshot.impact.fptExcludedCount;
  const vampDelta = snapshot.vamp.ratioWithoutDd - snapshot.vamp.ratio;
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
            {t("periodLabel", { period: snapshot.periodMonth })}
          </Text>
        </InlineStack>

        {/* Ratio strip — three cards */}
        <InlineStack gap="300" wrap>
          <RatioPill
            label={t("vamp.label")}
            ratio={snapshot.vamp.ratio}
            counterfactual={snapshot.vamp.ratioWithoutDd}
            threshold={snapshot.vamp.thresholdStandard}
            band={snapshot.vamp.band}
            t={t}
          />
          <RatioPill
            label={t("ecm.label")}
            ratio={snapshot.mcEcm.ratio}
            threshold={snapshot.mcEcm.threshold}
            band={snapshot.mcEcm.band}
            t={t}
          />
          <RatioPill
            label={t("efm.label")}
            ratio={snapshot.mcEfm.ratio}
            threshold={snapshot.mcEfm.threshold}
            band={snapshot.mcEfm.band}
            t={t}
          />
        </InlineStack>

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
  threshold,
  band,
  t,
}: {
  label: string;
  /** NULL when the period has no card volume. These are Visa/Mastercard
   *  programme ratios, so a merchant whose disputes are PayPal or Klarna
   *  has no such ratio — rendering 0.00% would assert a clean pass against
   *  a programme that is not measuring them. */
  ratio: number | null;
  counterfactual?: number | null;
  threshold: number;
  band: Band;
  t: ReturnType<typeof useTranslations>;
}) {
  const notApplicable = ratio === null;
  const showCounterfactual =
    !notApplicable &&
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
          {/* No band badge when the programme does not apply — a green
              "healthy" chip is as misleading as a red one here. */}
          {notApplicable ? null : (
            <Badge tone={BAND_TONE[band]}>{t(`band.${band}`)}</Badge>
          )}
        </InlineStack>
        <Text as="p" variant="headingLg" tone={notApplicable ? "subdued" : undefined}>
          {notApplicable ? "—" : fmtPct(ratio as number)}
        </Text>
        <Text as="span" variant="bodySm" tone="subdued">
          {notApplicable
            ? t("notApplicable")
            : t("threshold", { value: fmtPct(threshold) })}
        </Text>
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
