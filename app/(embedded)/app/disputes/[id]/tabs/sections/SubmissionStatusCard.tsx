/**
 * SubmissionStatusCard — Section 1 of ReviewSubmitTab.
 *
 * Single source of truth for "is this ready to send?" — renders one
 * of two states:
 *   - submitted:        formatted timestamp + Open-in-Shopify link
 *   - ready_to_submit:  the CTA (label + severity from the backend
 *                       nextAction; this card never invents which CTA
 *                       fires for which gate state)
 *
 * `onSubmit` is invoked unconditionally on click. The parent decides
 * whether to route through the override modal based on `cta.requiresOverride`.
 *
 * Timestamp is formatted via Intl.DateTimeFormat using the active
 * next-intl locale — never rendered as a raw ISO string.
 *
 * NO percentages. NO predictive copy.
 */

"use client";

import { Card, BlockStack, InlineStack, Text, Badge, Button, Link } from "@shopify/polaris";
import { useLocale, useTranslations } from "next-intl";
import type {
  ReviewState,
  ReviewViewModel,
} from "../useReviewView";

interface Props {
  state: ReviewState;
  submittedAt: ReviewViewModel["submittedAt"];
  shopifyAdminUrl: ReviewViewModel["shopifyAdminUrl"];
  cta: ReviewViewModel["cta"];
  onSubmit?: () => void;
}

function ctaTone(
  severity: "info" | "warning" | "critical",
): "success" | "critical" | undefined {
  // Polaris Button tone is constrained to success | critical | undefined.
  // Treat "warning" as the neutral primary (no tone) so the button still
  // looks actionable; the severity is conveyed by the section's CTA copy
  // and the status badge above it.
  if (severity === "critical") return "critical";
  if (severity === "info") return "success";
  return undefined;
}

function formatTimestamp(iso: string, locale: string): string {
  // Defensive — bad ISO strings should not crash the card. Fall back
  // to the raw value so the merchant at least sees something.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

export function SubmissionStatusCard({
  state,
  submittedAt,
  shopifyAdminUrl,
  cta,
  onSubmit,
}: Props) {
  const t = useTranslations("disputes.reviewTab.sections.status");
  const locale = useLocale();

  if (state === "submitted") {
    const formatted = submittedAt ? formatTimestamp(submittedAt, locale) : null;
    return (
      <Card>
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="center">
            <Badge tone="success">{t("submitted")}</Badge>
            {formatted ? (
              <Text as="span" variant="bodySm" tone="subdued">
                {t("submittedAt", { timestamp: formatted })}
              </Text>
            ) : null}
          </InlineStack>
          {shopifyAdminUrl ? (
            <Link url={shopifyAdminUrl} external>
              {t("openInShopify")}
            </Link>
          ) : null}
        </BlockStack>
      </Card>
    );
  }

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack gap="200" blockAlign="center">
          <Badge tone="attention">{t("readyToSubmit")}</Badge>
        </InlineStack>
        {cta ? (
          <InlineStack>
            <Button
              variant="primary"
              tone={ctaTone(cta.severity)}
              disabled={!cta.enabled}
              onClick={onSubmit}
            >
              {cta.label}
            </Button>
          </InlineStack>
        ) : null}
      </BlockStack>
    </Card>
  );
}
