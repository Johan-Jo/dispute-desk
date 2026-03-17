/**
 * FIGMA SCREEN MAPPING (file key: 5o2yOdPqVmvwjaK8eTeUUx)
 * Route: app/(embedded)/app/setup/complete/page.tsx
 * Figma Make source: src/app/pages/shopify/onboarding-wizard.tsx (step 6 — Final/Completion)
 * Reference: celebration screen after wizard completion — success icon, headline,
 * "You're all set" message, checklist of what's been configured, "Go to Dashboard" CTA.
 */
"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Page, Card, BlockStack, Text, Button, Spinner } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import { withShopParams } from "@/lib/withShopParams";

function CompletePageInner() {
  const t = useTranslations("setup");
  const searchParams = useSearchParams();

  const highlights = [
    { icon: "⟳", label: t("complete.highlight1") },
    { icon: "📋", label: t("complete.highlight2") },
    { icon: "📦", label: t("complete.highlight3") },
    { icon: "⚡", label: t("complete.highlight4") },
  ];

  return (
    <Page>
      <div style={{ maxWidth: 560, margin: "48px auto" }}>
        <Card>
          <BlockStack gap="600">
            {/* Hero */}
            <BlockStack gap="300" inlineAlign="center">
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #008060 0%, #00A47C 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg width="40" height="40" viewBox="0 0 24 24" fill="white">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                </svg>
              </div>
              <BlockStack gap="100" inlineAlign="center">
                <Text as="h1" variant="headingXl" alignment="center">
                  {t("complete.title")}
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                  {t("complete.subtitle")}
                </Text>
              </BlockStack>
            </BlockStack>

            {/* What's set up */}
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">{t("complete.readyHeading")}</Text>
              <div
                style={{
                  border: "1px solid #E1E3E5",
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                {highlights.map(({ icon, label }, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 16px",
                      borderBottom: i < highlights.length - 1 ? "1px solid #F1F2F3" : undefined,
                    }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        background: "#F1F8FF",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 16,
                        flexShrink: 0,
                      }}
                    >
                      {icon}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flex: 1 }}>
                      <Text as="span" variant="bodyMd">{label}</Text>
                      <svg width="16" height="16" viewBox="0 0 20 20" fill="#008060">
                        <path d="M8.5 13.5l-3-3 1.06-1.06L8.5 11.38l4.94-4.94L14.5 7.5l-6 6z" />
                      </svg>
                    </div>
                  </div>
                ))}
              </div>
            </BlockStack>

            {/* Info box */}
            <div
              style={{
                background: "#EBF5FA",
                border: "1px solid #2C6ECB",
                borderRadius: 8,
                padding: "12px 16px",
              }}
            >
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  {t("complete.infoTitle")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("complete.infoDesc")}
                </Text>
              </BlockStack>
            </div>

            {/* CTA */}
            <Button
              variant="primary"
              size="large"
              url={withShopParams("/app", searchParams)}
              fullWidth
            >
              {t("complete.goToDashboard")}
            </Button>
          </BlockStack>
        </Card>
      </div>
    </Page>
  );
}

export default function SetupCompletePage() {
  return (
    <Suspense
      fallback={
        <Page>
          <Card>
            <BlockStack gap="400" inlineAlign="center">
              <Spinner />
            </BlockStack>
          </Card>
        </Page>
      }
    >
      <CompletePageInner />
    </Suspense>
  );
}
