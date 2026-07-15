/**
 * IntegrationsCard — Settings → Integrations (embedded app).
 *
 * First-class home for the Gorgias connection outside the setup wizard
 * (PRD §10.11): status badge (Connected / Not connected / Reconnect
 * required), connected subdomain + last test time, Connect (reuses the
 * setup wizard's ConnectGorgiasModal), Test, and Disconnect behind a
 * confirm modal. Status comes from GET /api/integrations/status; the
 * action routes are the existing connect/test/disconnect endpoints.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Modal,
  Spinner,
  Text,
} from "@shopify/polaris";
import { ConnectGorgiasModal } from "@/components/setup/modals/ConnectGorgiasModal";

interface IntegrationRow {
  type: string;
  status: "not_connected" | "connected" | "needs_attention";
  meta?: {
    subdomain?: string;
    tested_at?: string;
    error_code?: string;
    last_error?: string;
  } | null;
}

export function IntegrationsCard() {
  const t = useTranslations("settings.integrations");
  const [loading, setLoading] = useState(true);
  const [gorgias, setGorgias] = useState<IntegrationRow | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [busy, setBusy] = useState<"test" | "disconnect" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/status");
      if (!res.ok) return;
      const body = (await res.json()) as { integrations?: IntegrationRow[] };
      setGorgias(
        (body.integrations ?? []).find((i) => i.type === "gorgias") ?? null,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const testConnection = useCallback(async () => {
    setBusy("test");
    setNotice(null);
    try {
      const res = await fetch("/api/integrations/gorgias/test", {
        method: "POST",
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      setNotice(body?.ok ? t("testOk") : (body?.error ?? t("testFailed")));
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [refresh, t]);

  const disconnect = useCallback(async () => {
    setBusy("disconnect");
    try {
      await fetch("/api/integrations/gorgias/disconnect", { method: "POST" });
      setConfirmDisconnect(false);
      setNotice(null);
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  const connected = gorgias?.status === "connected";
  const needsAttention = gorgias?.status === "needs_attention";
  const reconnectRequired =
    needsAttention && gorgias?.meta?.error_code === "reconnect_required";

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {t("title")}
        </Text>

        {loading ? (
          <Spinner size="small" accessibilityLabel={t("loading")} />
        ) : (
          <InlineStack align="space-between" blockAlign="center" gap="200">
            <BlockStack gap="100">
              <InlineStack gap="200" blockAlign="center">
                <Text as="span" fontWeight="semibold">
                  Gorgias
                </Text>
                {connected ? (
                  <Badge tone="success">{t("badge.connected")}</Badge>
                ) : needsAttention ? (
                  <Badge tone="critical">
                    {reconnectRequired
                      ? t("badge.reconnectRequired")
                      : t("badge.needsAttention")}
                  </Badge>
                ) : (
                  <Badge>{t("badge.notConnected")}</Badge>
                )}
              </InlineStack>
              <Text as="span" tone="subdued" variant="bodySm">
                {t("gorgiasDescription")}
              </Text>
              {gorgias?.meta?.subdomain && (
                <Text as="span" tone="subdued" variant="bodySm">
                  {gorgias.meta.subdomain}.gorgias.com
                  {gorgias.meta.tested_at
                    ? ` · ${t("lastTested", {
                        date: new Date(gorgias.meta.tested_at).toLocaleDateString(),
                      })}`
                    : ""}
                </Text>
              )}
              {notice && (
                <Text as="span" tone="subdued" variant="bodySm">
                  {notice}
                </Text>
              )}
            </BlockStack>

            <InlineStack gap="200">
              {connected || needsAttention ? (
                <>
                  <Button onClick={() => setConnectOpen(true)}>
                    {reconnectRequired || needsAttention
                      ? t("reconnect")
                      : t("updateCredentials")}
                  </Button>
                  <Button
                    variant="tertiary"
                    onClick={() => void testConnection()}
                    loading={busy === "test"}
                  >
                    {t("test")}
                  </Button>
                  <Button
                    variant="tertiary"
                    tone="critical"
                    onClick={() => setConfirmDisconnect(true)}
                  >
                    {t("disconnect")}
                  </Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => setConnectOpen(true)}>
                  {t("connect")}
                </Button>
              )}
            </InlineStack>
          </InlineStack>
        )}
      </BlockStack>

      <ConnectGorgiasModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onConnected={() => {
          setConnectOpen(false);
          void refresh();
        }}
      />

      <Modal
        open={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        title={t("disconnectModal.title")}
        primaryAction={{
          content: t("disconnectModal.confirm"),
          destructive: true,
          loading: busy === "disconnect",
          onAction: () => void disconnect(),
        }}
        secondaryActions={[
          {
            content: t("disconnectModal.cancel"),
            onAction: () => setConfirmDisconnect(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">{t("disconnectModal.body")}</Text>
        </Modal.Section>
      </Modal>
    </Card>
  );
}
