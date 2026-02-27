"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Page,
  Card,
  TextField,
  Text,
  BlockStack,
  InlineGrid,
  Box,
  InlineStack,
  Icon,
  Button,
} from "@shopify/polaris";
import {
  SearchIcon,
  DeliveryIcon,
  OrderIcon,
  SettingsIcon,
  CashDollarIcon,
  ExportIcon,
  PlayIcon,
} from "@shopify/polaris-icons";
import { useHelpGuideSafe } from "@/components/help/help-guide-provider";
import { HELP_CATEGORIES } from "@/lib/help/categories";
import { HELP_ARTICLES, getArticlesByCategory } from "@/lib/help/articles";
import { getPortalGuideTranslationKeyPrefix, HELP_GUIDE_IDS } from "@/lib/help-guides-config";
import { useTranslations } from "next-intl";

const POLARIS_ICON_MAP: Record<string, typeof SearchIcon> = {
  rocket: PlayIcon,
  scale: DeliveryIcon,
  package: OrderIcon,
  zap: SettingsIcon,
  creditCard: CashDollarIcon,
  upload: ExportIcon,
};

const GUIDE_ICON_MAP: Record<(typeof HELP_GUIDE_IDS)[number], typeof SearchIcon> = {
  "review-dispute": DeliveryIcon,
  "build-pack": OrderIcon,
  "automation-rules": SettingsIcon,
  "install-template": OrderIcon,
  "configure-policies": DeliveryIcon,
  "pack-builder-advanced": SettingsIcon,
};

export default function EmbeddedHelpPage() {
  const t = useTranslations();
  const router = useRouter();
  const helpGuide = useHelpGuideSafe();
  const [query, setQuery] = useState("");

  const filteredArticles = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase();
    return HELP_ARTICLES.filter((a) => {
      const title = t(a.titleKey).toLowerCase();
      const tags = a.tags?.join(" ").toLowerCase() ?? "";
      return title.includes(q) || tags.includes(q);
    });
  }, [query, t]);

  return (
    <Page title={t("help.title")}>
      <BlockStack gap="400">
        {helpGuide && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("help.interactiveGuidesTitle")}</Text>
              <Text as="p" variant="bodySm" tone="subdued">{t("help.interactiveGuidesDesc")}</Text>
              <InlineGrid columns={{ xs: 1, sm: 2, lg: 3 }} gap="400">
                {HELP_GUIDE_IDS.map((guideId) => {
                  const IconSource = GUIDE_ICON_MAP[guideId];
                  const keyPrefix = getPortalGuideTranslationKeyPrefix(guideId);
                  return (
                    <Card key={guideId}>
                      <BlockStack gap="300">
                        <InlineStack gap="200" align="start">
                          <Icon source={IconSource} tone="base" />
                          <Text as="h3" variant="headingSm">{t(`help.${keyPrefix}.title`)}</Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {t(`help.${keyPrefix}.description`)}
                        </Text>
                        <Button
                          variant="primary"
                          size="slim"
                          onClick={() => helpGuide.startGuide(guideId)}
                        >
                          {t("help.startGuide")}
                        </Button>
                      </BlockStack>
                    </Card>
                  );
                })}
              </InlineGrid>
            </BlockStack>
          </Card>
        )}

        <TextField
          label=""
          value={query}
          onChange={setQuery}
          placeholder={t("help.search")}
          prefix={<Icon source={SearchIcon} />}
          autoComplete="off"
          clearButton
          onClearButtonClick={() => setQuery("")}
        />

        {filteredArticles ? (
          filteredArticles.length === 0 ? (
            <Card>
              <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                {t("help.noResults")}
              </Text>
            </Card>
          ) : (
            <Card>
              <BlockStack gap="200">
                {filteredArticles.map((a) => (
                  <Box
                    key={a.slug}
                    padding="300"
                    borderBlockEndWidth="025"
                    borderColor="border-secondary"
                  >
                    <button
                      onClick={() => router.push(`/app/help/${a.slug}`)}
                      style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", width: "100%", padding: 0 }}
                    >
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {t(a.titleKey)}
                      </Text>
                    </button>
                  </Box>
                ))}
              </BlockStack>
            </Card>
          )
        ) : (
          <>
            <InlineGrid columns={{ xs: 1, sm: 2, lg: 3 }} gap="400">
              {HELP_CATEGORIES.map((cat) => {
                const iconSource = POLARIS_ICON_MAP[cat.icon] ?? SearchIcon;
                const count = getArticlesByCategory(cat.slug).length;
                return (
                  <a
                    key={cat.slug}
                    href={`#${cat.slug}`}
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <Card>
                      <BlockStack gap="200">
                        <InlineStack gap="200" align="start">
                          <Icon source={iconSource} tone="base" />
                          <Text as="h3" variant="headingSm">{t(cat.labelKey)}</Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {count} articles
                        </Text>
                      </BlockStack>
                    </Card>
                  </a>
                );
              })}
            </InlineGrid>

            {HELP_CATEGORIES.map((cat) => {
              const articles = getArticlesByCategory(cat.slug);
              return (
                <div key={cat.slug} id={cat.slug}>
                  <Box paddingBlockStart="400" paddingBlockEnd="200">
                    <Text as="h2" variant="headingMd">{t(cat.labelKey)}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">{t(cat.descriptionKey)}</Text>
                  </Box>
                  <Card>
                    <BlockStack gap="0">
                      {articles.map((a, i) => (
                        <Box
                          key={a.slug}
                          padding="300"
                          borderBlockEndWidth={i < articles.length - 1 ? "025" : undefined}
                          borderColor="border-secondary"
                        >
                          <button
                            onClick={() => router.push(`/app/help/${a.slug}`)}
                            style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", width: "100%", padding: 0 }}
                          >
                            <Text as="p" variant="bodyMd" fontWeight="medium">
                              {t(a.titleKey)}
                            </Text>
                          </button>
                        </Box>
                      ))}
                    </BlockStack>
                  </Card>
                </div>
              );
            })}
          </>
        )}

        <Box paddingBlockStart="400" paddingBlockEnd="600">
          <Text as="p" variant="bodySm" tone="subdued" alignment="center">
            {t("help.contactSupport")}
          </Text>
        </Box>
      </BlockStack>
    </Page>
  );
}
