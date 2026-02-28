"use client";

import { Suspense } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Banner,
  InlineStack,
  Badge,
  DataTable,
  Button,
  Divider,
  Spinner,
} from "@shopify/polaris";
import { useTranslations } from "next-intl";
import { SetupChecklistCard } from "@/components/setup/SetupChecklistCard";

const DISPUTES = [
  ["DP-2401", "#1042", "$145.00", "Not received", "Auto-saved", "Mar 02"],
  ["DP-2402", "#1039", "$89.50", "Fraudulent", "Needs review", "Mar 05"],
  ["DP-2403", "#1035", "$234.00", "Not as described", "Won", "—"],
  ["DP-2404", "#1028", "$67.00", "Duplicate", "Building...", "Mar 08"],
];

export default function EmbeddedDashboardPage() {
  const t = useTranslations();

  return (
    <Page
      title={t("dashboard.title")}
      subtitle={t("dashboard.embeddedSubtitle")}
      primaryAction={{ content: t("dashboard.automationSettings"), url: "/app/settings/automation" }}
      secondaryActions={[{ content: t("nav.help"), url: "/app/help" }]}
    >
      <Layout>
        <Layout.Section>
          <Banner tone="success" title={t("dashboard.automationOn")}>
            <p>{t("dashboard.automationBanner")}</p>
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <Suspense fallback={<Card><BlockStack gap="400" inlineAlign="center"><Spinner size="small" /></BlockStack></Card>}>
            <SetupChecklistCard />
          </Suspense>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("dashboard.automationStatus")}</Text>
              <InlineStack gap="800" wrap>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">{t("dashboard.autoBuild")}</Text>
                  <Badge tone="success">{t("common.on")}</Badge>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">{t("dashboard.autoSave")}</Text>
                  <Badge tone="success">{t("common.on")}</Badge>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">{t("dashboard.reviewRequired")}</Text>
                  <Badge tone="attention">{t("common.yes")}</Badge>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">{t("dashboard.minScore")}</Text>
                  <Badge>80%</Badge>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">{t("dashboard.blockerGate")}</Text>
                  <Badge tone="success">{t("common.on")}</Badge>
                </BlockStack>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">{t("dashboard.openDisputes")}</Text>
              <Text as="p" variant="headingXl">12</Text>
              <Badge tone="attention">{`-8% ${t("dashboard.vsLastMonth")}`}</Badge>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">{t("dashboard.winRate")}</Text>
              <Text as="p" variant="headingXl">67%</Text>
              <Badge tone="success">{`+5% ${t("dashboard.vsLastMonth")}`}</Badge>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">{t("dashboard.autoSaved")}</Text>
              <Text as="p" variant="headingXl">28</Text>
              <Badge tone="success">{t("dashboard.automatedThisMonth")}</Badge>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">{t("dashboard.recentDisputes")}</Text>
                <Button variant="plain">{t("common.viewAll")}</Button>
              </InlineStack>
              <DataTable
                columnContentTypes={["text", "text", "numeric", "text", "text", "text"]}
                headings={[
                  t("table.id"),
                  t("table.order"),
                  t("table.amount"),
                  t("table.reason"),
                  t("table.status"),
                  t("table.deadline"),
                ]}
                rows={DISPUTES}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">{t("dashboard.howItWorks")}</Text>
              <Divider />
              <Text as="p" variant="bodyMd">{t("dashboard.howItWorksStep1")}</Text>
              <Text as="p" variant="bodyMd">{t("dashboard.howItWorksStep2")}</Text>
              <Text as="p" variant="bodyMd">{t("dashboard.howItWorksStep3")}</Text>
              <Text as="p" variant="bodyMd" tone="subdued">{t("dashboard.howItWorksCompliance")}</Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
