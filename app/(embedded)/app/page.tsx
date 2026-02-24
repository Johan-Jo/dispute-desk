"use client";

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
  Box,
  Divider,
} from "@shopify/polaris";

const DISPUTES = [
  ["DP-2401", "#1042", "$145.00", "Not received", "Needs response", "Mar 02"],
  ["DP-2402", "#1039", "$89.50", "Fraudulent", "Under review", "Mar 05"],
  ["DP-2403", "#1035", "$234.00", "Not as described", "Won", "—"],
  ["DP-2404", "#1028", "$67.00", "Duplicate", "Needs response", "Mar 08"],
];

export default function EmbeddedDashboardPage() {
  return (
    <Page
      title="DisputeDesk"
      subtitle="Chargeback evidence governance"
      primaryAction={{ content: "Sync Disputes", disabled: true }}
    >
      <Layout>
        <Layout.Section>
          <Banner tone="info" title="Welcome to DisputeDesk">
            <p>
              Generate evidence packs for Shopify Payments disputes, review
              checklists, and save evidence back to Shopify.
            </p>
          </Banner>
        </Layout.Section>

        {/* KPIs */}
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">
                Open Disputes
              </Text>
              <Text as="p" variant="headingXl">
                12
              </Text>
              <InlineStack gap="100" align="start">
                <Badge tone="attention">-8% vs last month</Badge>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">
                Win Rate
              </Text>
              <Text as="p" variant="headingXl">
                67%
              </Text>
              <InlineStack gap="100" align="start">
                <Badge tone="success">+5% vs last month</Badge>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">
                Resolved
              </Text>
              <Text as="p" variant="headingXl">
                34
              </Text>
              <InlineStack gap="100" align="start">
                <Badge tone="success">+12% vs last month</Badge>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Disputes table */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  Recent Disputes
                </Text>
                <Button variant="plain">View all</Button>
              </InlineStack>
              <DataTable
                columnContentTypes={[
                  "text",
                  "text",
                  "numeric",
                  "text",
                  "text",
                  "text",
                ]}
                headings={[
                  "ID",
                  "Order",
                  "Amount",
                  "Reason",
                  "Status",
                  "Deadline",
                ]}
                rows={DISPUTES}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Quick start */}
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Quick Start
              </Text>
              <Divider />
              <Text as="p" variant="bodyMd">
                1. Go to <strong>Settings &gt; Policies</strong> to enter your
                refund, shipping, and terms of service URLs.
              </Text>
              <Text as="p" variant="bodyMd">
                2. Click <strong>Sync Disputes</strong> to pull disputes from
                Shopify Payments.
              </Text>
              <Text as="p" variant="bodyMd">
                3. Select a dispute and click <strong>Generate Pack</strong> to
                build your evidence.
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                When ready, save evidence to Shopify and open Shopify Admin to
                review and finalize your response.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
