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
  Divider,
} from "@shopify/polaris";

const DISPUTES = [
  ["DP-2401", "#1042", "$145.00", "Not received", "Auto-saved", "Mar 02"],
  ["DP-2402", "#1039", "$89.50", "Fraudulent", "Needs review", "Mar 05"],
  ["DP-2403", "#1035", "$234.00", "Not as described", "Won", "—"],
  ["DP-2404", "#1028", "$67.00", "Duplicate", "Building...", "Mar 08"],
];

export default function EmbeddedDashboardPage() {
  return (
    <Page
      title="DisputeDesk"
      subtitle="Automatic dispute evidence ops"
      primaryAction={{ content: "Automation Settings", url: "/app/settings/automation" }}
    >
      <Layout>
        {/* Automation banner */}
        <Layout.Section>
          <Banner tone="success" title="Automation is ON">
            <p>
              DisputeDesk automatically builds evidence packs and saves
              evidence back to Shopify when complete. Submission happens in
              Shopify Admin.
            </p>
          </Banner>
        </Layout.Section>

        {/* Automation summary card */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Automation Status</Text>
              <InlineStack gap="800" wrap>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">Auto-build</Text>
                  <Badge tone="success">On</Badge>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">Auto-save</Text>
                  <Badge tone="success">On</Badge>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">Review required</Text>
                  <Badge tone="attention">Yes</Badge>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">Min. score</Text>
                  <Badge>80%</Badge>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">Blocker gate</Text>
                  <Badge tone="success">On</Badge>
                </BlockStack>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* KPIs */}
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">Open Disputes</Text>
              <Text as="p" variant="headingXl">12</Text>
              <Badge tone="attention">-8% vs last month</Badge>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">Win Rate</Text>
              <Text as="p" variant="headingXl">67%</Text>
              <Badge tone="success">+5% vs last month</Badge>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">Auto-Saved</Text>
              <Text as="p" variant="headingXl">28</Text>
              <Badge tone="success">Automated this month</Badge>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Disputes table */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Recent Disputes</Text>
                <Button variant="plain">View all</Button>
              </InlineStack>
              <DataTable
                columnContentTypes={["text", "text", "numeric", "text", "text", "text"]}
                headings={["ID", "Order", "Amount", "Reason", "Status", "Deadline"]}
                rows={DISPUTES}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Compliance note */}
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">How Automation Works</Text>
              <Divider />
              <Text as="p" variant="bodyMd">
                1. DisputeDesk syncs disputes automatically from Shopify Payments.
              </Text>
              <Text as="p" variant="bodyMd">
                2. Evidence packs are built automatically using order, tracking, and policy data.
              </Text>
              <Text as="p" variant="bodyMd">
                3. When the pack passes your rules (completeness score + no blockers), evidence is saved to Shopify via API.
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Submission to the card network happens in Shopify Admin, or Shopify auto-submits on the due date. DisputeDesk does not submit on your behalf.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
