"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import {
  Page,
  Card,
  Text,
  BlockStack,
  Box,
  Button,
  InlineStack,
} from "@shopify/polaris";
import {
  getArticleBySlugForEmbedded,
  getEmbeddedArticleTitleKey,
  getEmbeddedArticleBodyKey,
  getEmbeddedRelatedSlugs,
} from "@/lib/help/embedded";
import { HELP_ARTICLES } from "@/lib/help/articles";
import { getCategoryBySlug } from "@/lib/help/categories";
import { useTranslations } from "next-intl";

const EMBEDDED_NAMESPACE = "help.embedded";

export default function EmbeddedHelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const t = useTranslations();
  const tEmbedded = useTranslations(EMBEDDED_NAMESPACE);
  const router = useRouter();
  const article = getArticleBySlugForEmbedded(slug);

  if (!article) {
    return (
      <Page title={tEmbedded("title")} backAction={{ content: tEmbedded("backToHelp"), onAction: () => router.push("/app/help") }}>
        <Card>
          <Text as="p" tone="subdued">This article is not available in the app. Open the Help Center in the DisputeDesk portal for the full article list.</Text>
        </Card>
      </Page>
    );
  }

  const category = getCategoryBySlug(article.category);
  const titleKey = getEmbeddedArticleTitleKey(article);
  const bodyKey = getEmbeddedArticleBodyKey(article);
  const body = t(bodyKey);
  const paragraphs = body.split("\n\n");

  const relatedSlugs = getEmbeddedRelatedSlugs(article);
  const related = relatedSlugs
    .map((s) => HELP_ARTICLES.find((a) => a.slug === s))
    .filter(Boolean);

  return (
    <Page
      title={t(titleKey)}
      backAction={{ content: category ? t(category.labelKey) : tEmbedded("backToHelp"), onAction: () => router.push("/app/help") }}
    >
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            {paragraphs.map((p, i) => {
              const lines = p.split("\n");
              const isList = lines.every((l) => /^[-•\d]+[.)]\s/.test(l.trim()) || l.trim() === "");
              if (isList) {
                return (
                  <Box key={i}>
                    <ul style={{ paddingLeft: "1.25rem", margin: 0 }}>
                      {lines.filter((l) => l.trim()).map((l, j) => (
                        <li key={j} style={{ marginBottom: "4px" }}>
                          <Text as="span" variant="bodyMd">{l.replace(/^[-•\d]+[.)]\s*/, "")}</Text>
                        </li>
                      ))}
                    </ul>
                  </Box>
                );
              }
              return (
                <Text key={i} as="p" variant="bodyMd">
                  {p}
                </Text>
              );
            })}
          </BlockStack>
        </Card>

        {related.length > 0 && (
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">{tEmbedded("relatedArticles")}</Text>
              {related.map((r) => r && (
                <Box key={r.slug}>
                  <button
                    onClick={() => router.push(`/app/help/${r.slug}`)}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    <Text as="span" variant="bodyMd" tone="magic-subdued">
                      {t(getEmbeddedArticleTitleKey(r))}
                    </Text>
                  </button>
                </Box>
              ))}
            </BlockStack>
          </Card>
        )}

        <InlineStack align="center">
          <Button variant="plain" onClick={() => router.push("/app/help")}>
            ← {tEmbedded("backToHelp")}
          </Button>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
