"use client";

/**
 * LSE-1 — CE 3.0 qualification verdict panel.
 *
 * Renders the dispute_qualifications row for a given dispute. Pure
 * presentation; fetches from /api/disputes/:id/qualification on mount.
 * Translated across the 6 BCP-47 locales (en-US, de-DE, fr-FR, es-ES,
 * pt-BR, sv-SE) under the `liabilityShift.*` namespace.
 *
 * Six verdict states + 4 branches + auto-qualification fee surfacing
 * per docs/epics/EPIC-LSE-1-qualification-engine.md.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { BlockStack, InlineStack, Text, Badge, Banner, Card } from "@shopify/polaris";

interface QualificationVerdict {
  status: string;
  branch: string | null;
  program: string;
  cardNetwork: string;
  reasonCode: string | null;
  matchPoints: string[];
  hasAnchor: boolean;
  qualifyingPriors: string[];
  autoQualificationVia: string | null;
  autoQualificationFeeApplies: boolean;
  confidence: string | null;
  confidenceReasons: string[];
  missingEvidence: string[];
  evaluatedAt: string;
}

interface QualificationResponse {
  pending: boolean;
  verdict: QualificationVerdict | null;
  networkReasonCode: string | null;
  networkReasonCodeConfidence: string | null;
}

interface Props {
  disputeId: string;
}

export function LiabilityShiftPanel({ disputeId }: Props) {
  const t = useTranslations("liabilityShift");
  const searchParams = useSearchParams();
  const shopId = searchParams.get("shop_id") ?? "";
  const [data, setData] = useState<QualificationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shopId) return;
    let cancelled = false;
    fetch(`/api/disputes/${disputeId}/qualification?shop_id=${encodeURIComponent(shopId)}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error ?? `HTTP ${r.status}`);
        }
        return r.json() as Promise<QualificationResponse>;
      })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? "unknown");
      });
    return () => {
      cancelled = true;
    };
  }, [disputeId, shopId]);

  if (error) {
    return null; // Silent fail — this is informational, never blocks dispute work.
  }
  if (!data) {
    return null; // Loading: render nothing rather than a skeleton flash.
  }
  if (data.pending || !data.verdict) {
    return null; // Verdict not computed yet (pack build hasn't run).
  }

  const v = data.verdict;
  if (v.program !== "ce_30") {
    return null; // Don't render the panel when CE 3.0 wasn't applicable.
  }

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack gap="200" align="space-between">
          <Text as="h3" variant="headingSm">
            {t("panelTitle")}
          </Text>
          <VerdictBadge status={v.status} />
        </InlineStack>

        {v.status === "qualifies_network_prequalified" && (
          <Banner tone="success">
            <BlockStack gap="100">
              <Text as="p" variant="bodyMd">
                {v.autoQualificationVia === "visa_data_only"
                  ? t("autoQual.viaDataOnly")
                  : v.autoQualificationVia === "merchant_confirmed"
                    ? t("autoQual.viaMerchantConfirmed")
                    : t("autoQual.viaVisaSecure")}
              </Text>
              {v.autoQualificationFeeApplies && (
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("autoQual.feeNotice")}
                </Text>
              )}
            </BlockStack>
          </Banner>
        )}

        {v.status === "qualifies_via_initial_billing" && (
          <Banner tone="info">
            <Text as="p" variant="bodyMd">
              {t("initialBilling.notice")}
            </Text>
          </Banner>
        )}

        {(v.status === "qualifies" ||
          v.status === "qualifies_network_prequalified" ||
          v.status === "qualifies_via_initial_billing") && (
          <BlockStack gap="200">
            {v.matchPoints.length > 0 && (
              <InlineStack gap="200" wrap>
                <Text as="span" variant="bodySm" tone="subdued">
                  {t("matchPoints.label")}
                </Text>
                {v.matchPoints.map((mp) => (
                  <Badge key={mp} tone="success">
                    {t(`matchPoint.${mp}` as `matchPoint.${typeof mp}`)}
                  </Badge>
                ))}
              </InlineStack>
            )}
            {v.confidence && (
              <Text as="p" variant="bodySm" tone="subdued">
                {t(`confidence.${v.confidence}` as `confidence.${typeof v.confidence}`)}
              </Text>
            )}
          </BlockStack>
        )}

        {v.status === "partial" && (
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              {t("partial.intro")}
            </Text>
            {v.missingEvidence.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                {v.missingEvidence.map((m) => (
                  <li key={m}>
                    <Text as="span" variant="bodySm">
                      {missingEvidenceLabel(m, t)}
                    </Text>
                  </li>
                ))}
              </ul>
            )}
          </BlockStack>
        )}

        {v.status === "does_not_qualify" && (
          <Text as="p" variant="bodySm" tone="subdued">
            {t("doesNotQualify.intro")}
          </Text>
        )}

        {v.status === "not_applicable" && (
          <Text as="p" variant="bodySm" tone="subdued">
            {t("notApplicable.intro")}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}

function VerdictBadge({ status }: { status: string }) {
  const t = useTranslations("liabilityShift");
  const tone: "success" | "attention" | "warning" | "info" | undefined =
    status === "qualifies" ||
    status === "qualifies_network_prequalified" ||
    status === "qualifies_via_initial_billing"
      ? "success"
      : status === "partial"
        ? "attention"
        : status === "does_not_qualify"
          ? "warning"
          : "info";
  const labelKey = `verdict.${status}` as
    | "verdict.qualifies"
    | "verdict.qualifies_network_prequalified"
    | "verdict.qualifies_via_initial_billing"
    | "verdict.partial"
    | "verdict.does_not_qualify"
    | "verdict.not_applicable";
  return <Badge tone={tone}>{t(labelKey)}</Badge>;
}

function missingEvidenceLabel(
  code: string,
  t: ReturnType<typeof useTranslations>,
): string {
  // Specific codes get specific labels; generic match_point:X codes fall through.
  if (code === "ip_or_device_anchor") return t("missing.anchor");
  if (code === "two_priors_in_120_365_day_window") return t("missing.twoPriors");
  if (code === "second_prior_in_120_365_day_window")
    return t("missing.secondPrior");
  if (code.startsWith("match_point:")) {
    const point = code.slice("match_point:".length);
    const labelKey = `matchPoint.${point}` as
      | "matchPoint.ip"
      | "matchPoint.device"
      | "matchPoint.shipping"
      | "matchPoint.account";
    return `${t("missing.matchPointPrefix")}: ${t(labelKey)}`;
  }
  return code;
}
