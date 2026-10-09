"use client";

import { Banner, BlockStack, Button, InlineStack, Text } from "@shopify/polaris";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { withShopParams } from "@/lib/withShopParams";

/** `evidence_packs.failure_code` written when a finished build finds no
 *  pack credit left to consume (lib/jobs/handlers/buildPackJob.ts). */
export const PACK_LIMIT_REACHED = "pack_limit_reached";

/**
 * A build that ran out of credit is a billing halt, not a system failure:
 * the evidence was collected and nothing is broken. Shown instead of the
 * generic "we couldn't finish building this pack" banner, which told the
 * merchant to retry and contact support for something only a plan change
 * or a credit grant resolves.
 */
export function PackCreditNeededBanner({
  onRetry,
  retrying,
}: {
  onRetry: () => void;
  retrying: boolean;
}) {
  const t = useTranslations("disputes.overviewExtra");
  const searchParams = useSearchParams();
  return (
    <Banner tone="warning" title={t("failureCopy.pack_limit_reached.title")}>
      <BlockStack gap="300">
        <Text as="p" variant="bodyMd">
          {t("failureCopy.pack_limit_reached.body")}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {t("failureCopy.pack_limit_reached.help")}
        </Text>
        <InlineStack gap="200">
          <Button variant="primary" url={withShopParams("/app/billing", searchParams)}>
            {t("failureCopy.pack_limit_reached.cta")}
          </Button>
          <Button onClick={onRetry} disabled={retrying} loading={retrying}>
            {t("retryBuild")}
          </Button>
        </InlineStack>
      </BlockStack>
    </Banner>
  );
}
