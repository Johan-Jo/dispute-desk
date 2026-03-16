"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Icon,
  Divider,
  Box,
  Spinner,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  LockIcon,
  OrderIcon,
  PersonIcon,
  ReceiptRefundIcon,
  FileIcon,
} from "@shopify/polaris-icons";

const PERMISSION_ITEMS = [
  { icon: OrderIcon, labelKey: "permOrders", descKey: "permOrdersDesc" },
  { icon: PersonIcon, labelKey: "permCustomers", descKey: "permCustomersDesc" },
  { icon: ReceiptRefundIcon, labelKey: "permDisputes", descKey: "permDisputesDesc" },
  { icon: FileIcon, labelKey: "permFiles", descKey: "permFilesDesc" },
] as const;

function getShopDomain(): string | null {
  if (typeof window === "undefined") return null;

  // 1. Cookie set by OAuth callback
  const cookie = document.cookie.match(/shopify_shop=([^;]+)/)?.[1];
  if (cookie) return decodeURIComponent(cookie);

  // 2. ?shop= URL param (Shopify includes this in embedded app URL)
  const shopParam = new URL(window.location.href).searchParams.get("shop");
  if (shopParam) return shopParam;

  // 3. Decode ?host= or sessionStorage shopify_host (base64url of "store.myshopify.com/admin")
  const hostRaw =
    new URL(window.location.href).searchParams.get("host") ||
    sessionStorage.getItem("shopify_host") ||
    "";
  if (hostRaw) {
    try {
      const decoded = atob(hostRaw.replace(/-/g, "+").replace(/_/g, "/"));
      const domain = decoded.split("/")[0];
      if (domain.includes(".myshopify.com")) return domain;
    } catch { /* ignore */ }
  }

  return null;
}

function getShopId(): string | null {
  if (typeof document === "undefined") return null;
  return document.cookie.match(/shopify_shop_id=([^;]+)/)?.[1] ?? null;
}

export default function ConnectPage() {
  const t = useTranslations("connect");
  const router = useRouter();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [shopDomain, setShopDomain] = useState<string | null>(null);

  useEffect(() => {
    const domain = getShopDomain();
    const shopId = getShopId();
    setShopDomain(domain);

    if (!shopId) {
      setConnected(false);
      return;
    }

    fetch(`/api/setup/state?shop_id=${shopId}`)
      .then((r) => r.json())
      .then((data) => {
        const permStatus = data?.steps?.permissions?.status;
        setConnected(permStatus === "done");
      })
      .catch(() => setConnected(false));
  }, []);

  function handleAuthorize() {
    const domain = getShopDomain();
    if (!domain) {
      // Fallback: redirect to OAuth without a shop param — the auth route will
      // prompt the user to enter their shop domain.
      const a = document.createElement("a");
      a.href = `${window.location.origin}/api/auth/shopify`;
      a.target = "_top";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }
    // Use target="_top" anchor to navigate the top frame without triggering
    // App Bridge's navigation interceptor (which causes postMessage errors).
    const authUrl = `${window.location.origin}/api/auth/shopify?shop=${domain}&phase=offline`;
    const a = document.createElement("a");
    a.href = authUrl;
    a.target = "_top";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function handleContinue() {
    router.push("/app/setup");
  }

  if (connected === null) {
    return (
      <Page>
        <div style={{ padding: "4rem", display: "flex", justifyContent: "center" }}>
          <Spinner size="large" />
        </div>
      </Page>
    );
  }

  return (
    <Page narrowWidth>
      <Card>
        <BlockStack gap="400">
          {/* Header */}
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              {t("title")}
            </Text>
            <Badge tone={connected ? "success" : undefined}>
              {connected ? t("statusConnected") : t("statusNotConnected")}
            </Badge>
          </InlineStack>

          <Divider />

          {/* Description */}
          <Text as="p" variant="bodyMd" tone="subdued">
            {t("description")}
          </Text>

          {/* Connected — show store and scopes */}
          {connected && shopDomain && (
            <Box
              background="bg-surface-secondary"
              borderRadius="200"
              padding="300"
            >
              <InlineStack gap="200" blockAlign="center">
                <div style={{ color: "#008060" }}>
                  <Icon source={CheckCircleIcon} />
                </div>
                <BlockStack gap="0">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {shopDomain}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("storeConnected")}
                  </Text>
                </BlockStack>
              </InlineStack>
            </Box>
          )}

          {/* Permission items */}
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              {t("permissionsHeading")}
            </Text>
            {PERMISSION_ITEMS.map((item) => (
              <InlineStack key={item.labelKey} gap="300" blockAlign="center">
                <div style={{ color: connected ? "#008060" : "#6D7175" }}>
                  <Icon source={connected ? CheckCircleIcon : item.icon} />
                </div>
                <BlockStack gap="0">
                  <Text as="span" variant="bodyMd" fontWeight="medium">
                    {t(item.labelKey)}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t(item.descKey)}
                  </Text>
                </BlockStack>
              </InlineStack>
            ))}
          </BlockStack>

          <Divider />

          {/* CTA */}
          {connected ? (
            <Button variant="primary" onClick={handleContinue} fullWidth>
              {t("ctaContinue")}
            </Button>
          ) : (
            <Button variant="primary" onClick={handleAuthorize} fullWidth>
              {t("ctaAuthorize")}
            </Button>
          )}

          {/* Footer */}
          <InlineStack gap="200" blockAlign="center">
            <Icon source={LockIcon} />
            <Text as="span" variant="bodySm" tone="subdued">
              {t("footer")}
            </Text>
          </InlineStack>
        </BlockStack>
      </Card>
    </Page>
  );
}
