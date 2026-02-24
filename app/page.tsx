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
} from "@shopify/polaris";

export default function DashboardPage() {
  return (
    <Page title="DisputeDesk">
      <Layout>
        <Layout.Section>
          <Banner tone="info" title="Welcome to DisputeDesk">
            <p>
              Generate evidence packs for Shopify Payments disputes, review
              checklists, and save evidence back to Shopify.
            </p>
          </Banner>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  Disputes
                </Text>
                <Badge tone="attention">Coming soon</Badge>
              </InlineStack>
              <Text as="p" variant="bodyMd" tone="subdued">
                View and manage your Shopify Payments disputes. Sync disputes,
                generate evidence packs, and track due dates.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  Evidence Packs
                </Text>
                <Badge tone="attention">Coming soon</Badge>
              </InlineStack>
              <Text as="p" variant="bodyMd" tone="subdued">
                Review generated evidence, download PDFs, and save structured
                evidence to Shopify for your dispute responses.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Quick Start
              </Text>
              <Text as="p" variant="bodyMd">
                1. Go to <strong>Settings &gt; Policies</strong> to enter your
                refund, shipping, and terms of service URLs.
              </Text>
              <Text as="p" variant="bodyMd">
                2. Open <strong>Disputes</strong> and click{" "}
                <strong>Sync Now</strong> to pull disputes from Shopify Payments.
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
