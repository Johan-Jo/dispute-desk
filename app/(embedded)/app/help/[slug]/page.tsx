"use client";

import React, { use, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Page, Icon, Toast, Frame } from "@shopify/polaris";
import {
  ArrowLeftIcon,
  ClockIcon,
  PageIcon,
  ChevronRightIcon,
} from "@shopify/polaris-icons";
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

// ─── Body parser ──────────────────────────────────────────────

function parseInline(text: string): React.ReactNode[] {
  // Bold: **text** -> <strong>
  // Code: `text` -> <code>
  const out: React.ReactNode[] = [];
  let key = 0;
  const remaining = text;
  let i = 0;
  while (i < remaining.length) {
    const boldMatch = remaining.slice(i).match(/\*\*(.+?)\*\*/);
    const codeMatch = remaining.slice(i).match(/`([^`]+)`/);
    let nextIdx = -1;
    let kind: "bold" | "code" | null = null;
    if (boldMatch && (codeMatch == null || boldMatch.index! <= codeMatch.index!)) {
      nextIdx = boldMatch.index!;
      kind = "bold";
    } else if (codeMatch) {
      nextIdx = codeMatch.index!;
      kind = "code";
    }
    if (nextIdx === -1) {
      out.push(remaining.slice(i));
      break;
    }
    if (nextIdx > 0) out.push(remaining.slice(i, i + nextIdx));
    if (kind === "bold") {
      out.push(<strong key={key++}>{boldMatch![1]}</strong>);
      i += nextIdx + boldMatch![0].length;
    } else {
      out.push(
        <code
          key={key++}
          style={{
            background: "#F6F8FB",
            padding: "1px 5px",
            borderRadius: 3,
            fontSize: "0.92em",
            fontFamily: "ui-monospace, monospace",
          }}
        >
          {codeMatch![1]}
        </code>,
      );
      i += nextIdx + codeMatch![0].length;
    }
  }
  return out;
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

/** Heading detection: a line that is a single bold span on its own. */
function isBoldHeading(line: string): boolean {
  const t = line.trim();
  return /^\*\*([^*]+)\*\*$/.test(t);
}
function stripBoldHeading(line: string): string {
  return line.trim().replace(/^\*\*/, "").replace(/\*\*$/, "");
}

interface RenderedBlock {
  el: React.ReactNode;
}

function renderBlock(block: string, key: number): RenderedBlock {
  const lines = block.split("\n");
  const nonEmpty = lines.filter((l) => l.trim() !== "");

  // Single-line bold heading
  if (nonEmpty.length === 1 && isBoldHeading(nonEmpty[0])) {
    return {
      el: (
        <h2
          key={key}
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "#202223",
            margin: "20px 0 10px",
          }}
        >
          {stripBoldHeading(nonEmpty[0])}
        </h2>
      ),
    };
  }

  // Pure list block
  if (nonEmpty.length > 0 && nonEmpty.every((l) => isListLine(l))) {
    const isOrdered = RE_OL.test(nonEmpty[0].trim());
    const ListTag = isOrdered ? "ol" : "ul";
    return {
      el: (
        <ListTag
          key={key}
          style={{
            paddingLeft: 24,
            margin: "8px 0",
            color: "#6D7175",
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          {nonEmpty.map((l, j) => (
            <li key={j} style={{ marginBottom: 6 }}>
              {parseInline(stripListPrefix(l))}
            </li>
          ))}
        </ListTag>
      ),
    };
  }

  // Mixed: leading bold-heading line followed by paragraph/list
  if (nonEmpty.length > 1 && isBoldHeading(nonEmpty[0])) {
    const heading = stripBoldHeading(nonEmpty[0]);
    const rest = nonEmpty.slice(1);
    const restIsList = rest.every((l) => isListLine(l));
    return {
      el: (
        <div key={key}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "#202223", margin: "20px 0 10px" }}>
            {heading}
          </h2>
          {restIsList ? (
            (() => {
              const isOrdered = RE_OL.test(rest[0].trim());
              const ListTag = isOrdered ? "ol" : "ul";
              return (
                <ListTag style={{ paddingLeft: 24, margin: "8px 0", color: "#6D7175", fontSize: 14, lineHeight: 1.6 }}>
                  {rest.map((l, j) => (
                    <li key={j} style={{ marginBottom: 6 }}>
                      {parseInline(stripListPrefix(l))}
                    </li>
                  ))}
                </ListTag>
              );
            })()
          ) : (
            <p style={{ fontSize: 14, color: "#6D7175", lineHeight: 1.6, margin: "8px 0" }}>
              {rest.map((line, j) => (
                <React.Fragment key={j}>
                  {j > 0 && <br />}
                  {parseInline(line)}
                </React.Fragment>
              ))}
            </p>
          )}
        </div>
      ),
    };
  }

  // Plain paragraph
  return {
    el: (
      <p
        key={key}
        style={{ fontSize: 14, color: "#6D7175", lineHeight: 1.6, margin: "8px 0" }}
      >
        {nonEmpty.map((line, j) => (
          <React.Fragment key={j}>
            {j > 0 && <br />}
            {parseInline(line)}
          </React.Fragment>
        ))}
      </p>
    ),
  };
}

/** Rough read-time: total words ÷ 220, min 1. */
function readTimeMinutes(body: string): number {
  const words = body.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

// ─── Component ────────────────────────────────────────────────

export default function EmbeddedHelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const t = useTranslations();
  const tEmbedded = useTranslations(EMBEDDED_NAMESPACE);
  const router = useRouter();
  const article = getArticleBySlugForEmbedded(slug);
  const [toastActive, setToastActive] = useState(false);

  const onFeedback = useCallback(() => setToastActive(true), []);

  if (!article) {
    return (
      <Page
        title={tEmbedded("title")}
        backAction={{ content: tEmbedded("backToHelp"), onAction: () => router.push("/app/help") }}
      >
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid #C9CCCF",
            borderRadius: 8,
            padding: 24,
            color: "#6D7175",
          }}
        >
          {tEmbedded("articleNotAvailable")}
        </div>
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
    .filter((a): a is NonNullable<typeof a> => Boolean(a));

  const minRead = readTimeMinutes(body);

  // First paragraph is treated as intro lede if it doesn't start with a bold heading.
  const introBlock =
    paragraphs.length > 0 && !isBoldHeading(paragraphs[0].split("\n")[0])
      ? paragraphs[0]
      : null;
  const bodyBlocks = introBlock ? paragraphs.slice(1) : paragraphs;

  return (
    <Frame>
      <Page>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          {/* Back link */}
          <button
            type="button"
            onClick={() => router.push("/app/help")}
            style={{
              background: "transparent",
              border: "none",
              color: "#005BD3",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              padding: 0,
              marginBottom: 16,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ width: 14, height: 14 }}>
              <Icon source={ArrowLeftIcon} tone="base" />
            </span>
            {category
              ? tEmbedded("backToCategory", { category: t(category.labelKey) })
              : tEmbedded("backToHelp")}
          </button>

          {/* Header: category badge + read time, title, intro */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
              {category && (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    background: "#EBF5FA",
                    color: "#005BD3",
                    padding: "3px 10px",
                    borderRadius: 4,
                  }}
                >
                  {t(category.labelKey)}
                </span>
              )}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 12,
                  color: "#6D7175",
                }}
              >
                <span style={{ width: 12, height: 12 }}>
                  <Icon source={ClockIcon} tone="base" />
                </span>
                {tEmbedded("minRead", { count: minRead })}
              </span>
            </div>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 600,
                color: "#202223",
                margin: "0 0 12px",
                lineHeight: 1.3,
              }}
            >
              {t(titleKey)}
            </h1>
            {introBlock && (
              <p
                style={{
                  fontSize: 14,
                  color: "#6D7175",
                  margin: 0,
                  lineHeight: 1.6,
                }}
              >
                {introBlock.split("\n").map((line, j) => (
                  <React.Fragment key={j}>
                    {j > 0 && <br />}
                    {parseInline(line)}
                  </React.Fragment>
                ))}
              </p>
            )}
          </div>

          {/* Body card */}
          <div
            style={{
              background: "#FFFFFF",
              border: "1px solid #C9CCCF",
              borderRadius: 8,
              padding: "20px 24px",
              marginBottom: 24,
            }}
          >
            {bodyBlocks.map((p, i) => renderBlock(p, i).el)}
          </div>

          {/* Was this helpful? */}
          <div
            style={{
              background: "#FFFFFF",
              border: "1px solid #C9CCCF",
              borderRadius: 8,
              padding: 20,
              marginBottom: 24,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: "#202223", marginBottom: 12 }}>
              {tEmbedded("wasArticleHelpful")}
            </div>
            <div style={{ display: "inline-flex", gap: 12 }}>
              <button
                type="button"
                onClick={onFeedback}
                style={{
                  padding: "8px 18px",
                  border: "1px solid #C9CCCF",
                  background: "#FFFFFF",
                  color: "#202223",
                  fontSize: 13,
                  fontWeight: 500,
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                {tEmbedded("helpfulYes")}
              </button>
              <button
                type="button"
                onClick={onFeedback}
                style={{
                  padding: "8px 18px",
                  border: "1px solid #C9CCCF",
                  background: "#FFFFFF",
                  color: "#202223",
                  fontSize: 13,
                  fontWeight: 500,
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                {tEmbedded("helpfulNo")}
              </button>
            </div>
          </div>

          {/* Related Articles */}
          {related.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: "#202223", margin: "0 0 14px" }}>
                {tEmbedded("relatedArticles")}
              </h3>
              <div
                style={{
                  background: "#FFFFFF",
                  border: "1px solid #C9CCCF",
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                {related.map((r, i) => (
                  <button
                    key={r.slug}
                    onClick={() => router.push(`/app/help/${r.slug}`)}
                    style={{
                      width: "100%",
                      background: "transparent",
                      border: "none",
                      borderTop: i === 0 ? "none" : "1px solid #E1E3E5",
                      padding: "12px 20px",
                      cursor: "pointer",
                      textAlign: "left",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ width: 16, height: 16, color: "#6D7175" }}>
                        <Icon source={PageIcon} tone="base" />
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 500, color: "#202223" }}>
                        {t(getEmbeddedArticleTitleKey(r))}
                      </span>
                    </div>
                    <span style={{ width: 16, height: 16, color: "#6D7175" }}>
                      <Icon source={ChevronRightIcon} tone="base" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {toastActive && (
          <Toast content={tEmbedded("feedbackThanks")} onDismiss={() => setToastActive(false)} />
        )}
      </Page>
    </Frame>
  );
}
