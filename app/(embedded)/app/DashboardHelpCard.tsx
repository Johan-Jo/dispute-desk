"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BlockStack,
  Button,
  Card,
  Icon,
  InlineStack,
  Text,
  useBreakpoints,
} from "@shopify/polaris";
import { QuestionCircleIcon } from "@shopify/polaris-icons";
import { withShopParams } from "@/lib/withShopParams";

export function DashboardHelpCard() {
  const t = useTranslations("dashboard");
  const searchParams = useSearchParams();
  const { smDown } = useBreakpoints();
  const linkUrl = withShopParams(
    "/app/help/understanding-dashboard",
    searchParams ?? new URLSearchParams(),
  );

  const iconChip = (
    <div style={{
      width: 36,
      height: 36,
      borderRadius: 8,
      background: "#DBEAFE",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      color: "#1D4ED8",
    }}>
      <Icon source={QuestionCircleIcon} />
    </div>
  );

  const title = (
    <BlockStack gap="050">
      <Text as="h3" variant="headingSm">{t("helpCardTitle")}</Text>
      <Text as="p" variant="bodySm" tone="subdued">{t("helpCardDesc")}</Text>
    </BlockStack>
  );

  return (
    <Card>
      {smDown ? (
        <BlockStack gap="300">
          <InlineStack gap="300" blockAlign="center" wrap={false}>
            {iconChip}
            {title}
          </InlineStack>
          <Button url={linkUrl} fullWidth>
            {t("helpCardLink")}
          </Button>
        </BlockStack>
      ) : (
        <InlineStack gap="400" blockAlign="center" wrap={false}>
          {iconChip}
          {title}
          <div style={{ marginLeft: "auto", flexShrink: 0 }}>
            <Button variant="plain" url={linkUrl}>
              {t("helpCardLink")}
            </Button>
          </div>
        </InlineStack>
      )}
    </Card>
  );
}
