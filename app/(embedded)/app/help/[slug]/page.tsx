"use client";

import React, { use } from "react";
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

/** Turn **bold** markers into <strong> elements. */
function parseBold(text: string): React.ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part
  );
}

const RE_UL = /^[-•]\s+/;
const RE_OL = /^\d+[.)]\s+/;

function isListLine(line: string): boolean {
  const t = line.trim();
  return RE_UL.test(t) || RE_OL.test(t);
}

function stripListPrefix(line: string): string {
  return line.trim().replace(RE_UL, "").replace(RE_OL, "");
}

function renderBlock(block: string, index: number): React.ReactNode {
  const lines = block.split("\n");
  const nonEmpty = lines.filter((l) => l.trim() !== "");

  // Pure list block
  if (nonEmpty.length > 0 && nonEmpty.every((l) => isListLine(l))) {
    const isOrdered = RE_OL.test(nonEmpty[0].trim());
    const ListTag = isOrdered ? "ol" : "ul";
    return (
      <Box key={index}>
        <ListTag style={{ paddingLeft: "1.25rem", margin: 0 }}>
          {nonEmpty.map((l, j) => (
            <li key={j} style={{ marginBottom: "4px" }}>
              <Text as="span" variant="bodyMd">{parseBold(stripListPrefix(l))}</Text>
            </li>
          ))}
        </ListTag>
      </Box>
    );
  }

  // Group consecutive lines by type (text vs list)
  const groups: { type: "text" | "list"; lines: string[] }[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const lineType = isListLine(trimmed) ? "list" : "text";
    const last = groups[groups.length - 1];
    if (last && last.type === lineType) {
      last.lines.push(trimmed);
    } else {
      groups.push({ type: lineType, lines: [trimmed] });
    }
  }

  const hasListGroup = groups.some((g) => g.type === "list");

  // Plain paragraph — preserve line breaks
  if (!hasListGroup) {
    return (
      <Text key={index} as="p" variant="bodyMd">
        {lines.map((line, j) => (
          <React.Fragment key={j}>
            {j > 0 && <br />}
            {parseBold(line)}
          </React.Fragment>
        ))}
      </Text>
    );
  }

  // Mixed text + list
  return (
    <Box key={index}>
      {groups.map((group, gi) => {
        if (group.type === "list") {
          const isOrdered = RE_OL.test(group.lines[0]);
          const ListTag = isOrdered ? "ol" : "ul";
          return (
            <ListTag key={gi} style={{ paddingLeft: "1.25rem", margin: "4px 0" }}>
              {group.lines.map((l, li) => (
                <li key={li} style={{ marginBottom: "4px" }}>
                  <Text as="span" variant="bodyMd">{parseBold(stripListPrefix(l))}</Text>
                </li>
              ))}
            </ListTag>
          );
        }
        return (
          <Text key={gi} as="p" variant="bodyMd">
            {group.lines.map((line, li) => (
              <React.Fragment key={li}>
                {li > 0 && <br />}
                {parseBold(line)}
              </React.Fragment>
            ))}
          </Text>
        );
      })}
    </Box>
  );
}

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
          <Text as="p" tone="subdued">{tEmbedded("articleNotAvailable")}</Text>
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
            {paragraphs.map((p, i) => renderBlock(p, i))}
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
