"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ActionList,
  BlockStack,
  Box,
  Button,
  Card,
  Icon,
  InlineStack,
  Popover,
  Text,
} from "@shopify/polaris";
import {
  MenuHorizontalIcon,
  ShieldCheckMarkIcon,
  StarIcon,
  ThumbsUpIcon,
  XIcon,
} from "@shopify/polaris-icons";
import { withShopParams } from "@/lib/withShopParams";
import styles from "./embedded-app-chrome.module.css";

const FEEDBACK_DISMISS_KEY = "dd_embedded_feedback_banner_dismissed_v1";

export function EmbeddedAppChrome({ children }: { children: React.ReactNode }) {
  const t = useTranslations("embeddedShell");
  const searchParams = useSearchParams();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const [feedbackDismissed, setFeedbackDismissed] = useState(false);

  useEffect(() => {
    try {
      if (typeof window !== "undefined" && localStorage.getItem(FEEDBACK_DISMISS_KEY) === "1") {
        setFeedbackDismissed(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const dismissFeedback = useCallback(() => {
    try {
      localStorage.setItem(FEEDBACK_DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setFeedbackDismissed(true);
  }, []);

  const go = useCallback(
    (path: string) => {
      router.push(withShopParams(path, searchParams));
    },
    [router, searchParams]
  );

  const moreActivator = (
    <Button
      variant="tertiary"
      icon={MenuHorizontalIcon}
      onClick={() => setMoreOpen((v) => !v)}
      accessibilityLabel={t("moreActions")}
    />
  );

  return (
    <div className={styles.wrap}>
      <Box paddingBlockEnd="400">
        <div className={styles.brandRow}>
          <InlineStack gap="300" blockAlign="center" wrap={false}>
            <div className={styles.shieldTile}>
              <Icon source={ShieldCheckMarkIcon} />
            </div>
            <span className={styles.brandTitle}>{t("brandName")}</span>
          </InlineStack>
          <Popover
            active={moreOpen}
            activator={moreActivator}
            autofocusTarget="first-node"
            preferredAlignment="right"
            onClose={() => setMoreOpen(false)}
          >
            <ActionList
              actionRole="menuitem"
              items={[
                {
                  content: t("menuHelp"),
                  onAction: () => {
                    setMoreOpen(false);
                    go("/app/help");
                  },
                },
                {
                  content: t("menuSettings"),
                  onAction: () => {
                    setMoreOpen(false);
                    go("/app/settings");
                  },
                },
              ]}
            />
          </Popover>
        </div>
      </Box>

      {!feedbackDismissed && (
        <Box paddingBlockEnd="400">
          <Card>
            <Box padding="400">
                <InlineStack gap="400" align="space-between" blockAlign="start" wrap={false}>
                  <InlineStack gap="300" wrap={false} blockAlign="start">
                    <Icon source={ThumbsUpIcon} tone="subdued" />
                    <BlockStack gap="200">
                      <Text as="p" variant="bodyMd">
                        {t("feedbackPrompt")}
                      </Text>
                      <InlineStack gap="100" wrap={false}>
                        {Array.from({ length: 5 }, (_, i) => (
                          <Icon key={i} source={StarIcon} tone={i < 3 ? "primary" : "subdued"} />
                        ))}
                      </InlineStack>
                    </BlockStack>
                  </InlineStack>
                  <Button
                    variant="tertiary"
                    icon={XIcon}
                    onClick={dismissFeedback}
                    accessibilityLabel={t("dismissFeedback")}
                  />
                </InlineStack>
              </Box>
          </Card>
        </Box>
      )}

      {children}
    </div>
  );
}
