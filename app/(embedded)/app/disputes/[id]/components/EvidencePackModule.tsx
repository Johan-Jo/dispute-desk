"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { withShopParams } from "@/lib/withShopParams";
import {
  Card,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  Button,
  ProgressBar,
  Banner,
  Divider,
  Icon,
} from "@shopify/polaris";
import { NoteIcon } from "@shopify/polaris-icons";
import type { Pack } from "./utils";
import { packStatusTone, formatDate } from "./utils";
import styles from "../dispute-detail.module.css";

interface EvidencePackModuleProps {
  packs: Pack[];
  latestPack: Pack | null;
  onGenerate: () => void;
  generating: boolean;
  templateCheckLoading: boolean;
}

export default function EvidencePackModule({
  packs,
  latestPack,
  onGenerate,
  generating,
  templateCheckLoading,
}: EvidencePackModuleProps) {
  const t = useTranslations();
  const searchParams = useSearchParams();

  const score = latestPack?.completeness_score ?? 0;
  const blockerCount = latestPack?.blockers?.length ?? 0;
  const recommendedCount = latestPack?.recommended_actions?.length ?? 0;
  // Estimate included items from score: assume ~10 total fields as rough baseline
  const estimatedTotal = Math.max(blockerCount + recommendedCount + 1, 10);
  const includedCount = Math.max(
    0,
    Math.round((score / 100) * estimatedTotal) - 0,
  );

  const progressTone =
    score >= 80 ? "success" : score >= 50 ? "highlight" : "critical";

  const packUrl = latestPack
    ? withShopParams(`/app/packs/${latestPack.id}`, searchParams)
    : "";

  return (
    <Card>
      <BlockStack gap="400">
        {/* Header */}
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Icon source={NoteIcon} tone="subdued" />
            <Text as="h2" variant="headingSm">
              {t("disputes.evidence.title")}
            </Text>
          </InlineStack>
          {latestPack && (
            <Badge tone={packStatusTone(latestPack.status)}>
              {latestPack.status.replace(/_/g, " ")}
            </Badge>
          )}
        </InlineStack>

        {latestPack ? (
          <>
            {/* Progress bar */}
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm">
                  {t("disputes.evidence.completeness")}
                </Text>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  {score}%
                </Text>
              </InlineStack>
              <ProgressBar progress={score} tone={progressTone} size="small" />
            </BlockStack>

            {/* Count grid */}
            <div className={styles.evidenceCountGrid}>
              <div className={styles.evidenceCountItem}>
                <Text as="p" variant="headingMd" tone="critical">
                  {blockerCount}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("disputes.evidence.missingRequired")}
                </Text>
              </div>
              <div className={styles.evidenceCountItem}>
                <Text as="p" variant="headingMd" tone="caution">
                  {recommendedCount}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("disputes.evidence.missingRecommended")}
                </Text>
              </div>
              <div className={styles.evidenceCountItem}>
                <Text as="p" variant="headingMd" tone="success">
                  {includedCount}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("disputes.evidence.included")}
                </Text>
              </div>
            </div>

            {/* Blockers list */}
            {blockerCount > 0 && (
              <Banner tone="warning" title={t("disputes.evidence.blockersTitle")}>
                <ul style={{ margin: 0, paddingLeft: "16px" }}>
                  {latestPack.blockers!.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </Banner>
            )}

            {/* CTA */}
            <Button url={packUrl} fullWidth>
              {latestPack.status === "saved_to_shopify"
                ? t("disputes.evidence.viewPack")
                : t("disputes.evidence.openPack")}
            </Button>

            {/* Other packs */}
            {packs.length > 1 && (
              <>
                <Divider />
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("disputes.evidence.otherPacks", {
                      count: packs.length - 1,
                    })}
                  </Text>
                  {packs.slice(1).map((p) => (
                    <a
                      key={p.id}
                      href={withShopParams(
                        `/app/packs/${p.id}`,
                        searchParams,
                      )}
                      style={{
                        color: "#1D4ED8",
                        textDecoration: "none",
                        fontSize: "13px",
                      }}
                    >
                      {p.id.slice(0, 8)} ({formatDate(p.created_at)})
                    </a>
                  ))}
                </InlineStack>
              </>
            )}
          </>
        ) : (
          <BlockStack gap="300">
            <Text as="p" tone="subdued">
              {t("disputes.evidence.noPacksYet")}
            </Text>
            <Button
              onClick={onGenerate}
              loading={generating || templateCheckLoading}
              fullWidth
            >
              {t("disputes.evidence.generatePack")}
            </Button>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
