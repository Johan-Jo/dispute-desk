"use client";

/**
 * A return on the order, stated to the merchant.
 *
 * MERCHANT-ONLY. The dispute page's timeline is the bank letter's allow-list
 * (lib/defence/chronology.ts) and rightly drops return events, so the merchant
 * was never shown that a return had been opened on the order — while being
 * asked for evidence that return made irrelevant (whj8db-1q #21037,
 * 2026-10-09). This states Shopify's record; it gives no advice and is not
 * rendered anywhere that mirrors the bank document.
 *
 * Reads `lib/disputes/orderSituation.ts`. Shown only when Shopify records a
 * return; an order with no return, or a pack that does not know, shows nothing.
 */

import { Banner, BlockStack, Text } from "@shopify/polaris";
import { useFormatter, useTranslations } from "next-intl";
import { hasReturnOnRecord, type OrderSituation } from "@/lib/disputes/orderSituation";

export function OrderSituationNote({
  situation,
}: {
  situation: (OrderSituation & { asOf: string | null }) | null;
}) {
  const t = useTranslations("disputes.overviewExtra.orderSituation");
  const format = useFormatter();
  if (!situation || !hasReturnOnRecord(situation)) return null;

  const date = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : format.dateTime(d, { dateStyle: "long" });
  };
  const opened = date(situation.returnOpenedAt);
  const asOf = date(situation.asOf);
  const record = [
    opened ? t("opened", { date: opened }) : null,
    situation.refund === "unknown" ? null : t(`refund.${situation.refund}`),
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Banner tone="info" title={t(`title.${situation.returns}`)}>
      <BlockStack gap="200">
        {record && (
          <Text as="p" variant="bodyMd">
            {record}
          </Text>
        )}
        <Text as="p" variant="bodySm" tone="subdued">
          {[asOf ? t("asOf", { date: asOf }) : null, t("privateNote")].filter(Boolean).join(" ")}
        </Text>
      </BlockStack>
    </Banner>
  );
}
