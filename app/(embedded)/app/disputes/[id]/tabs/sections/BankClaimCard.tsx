/**
 * BankClaimCard — asks the merchant to copy the bank's claim from Shopify.
 *
 * The bank's explanation of what the buyer is disputing (Shopify's "issuer
 * claim") is shown only in the chargeback details on the order page in
 * Shopify Admin; the Admin API has no field for it. For a reopened dispute,
 * or a `general` one with no network reason code, it is the only statement
 * of what the response has to answer — so nothing is filed until the
 * merchant copies it here or confirms Shopify shows none
 * (lib/disputes/bankClaim.ts, plan docs/plans/bank-claim-capture.plan.md).
 *
 * `?section=bank-claim` (the link in the bank-claim email) scrolls here.
 * Visibility comes from the server's `bankClaim.trigger`, never a local
 * re-derivation, so the card and the filing gate cannot disagree.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { Banner, BlockStack, Button, Card, Checkbox, InlineStack, Text, TextField } from "@shopify/polaris";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { getShopifyOrderUrl } from "@/lib/shopify/shopifyAdminUrl";
import type { useDisputeWorkspace } from "../../hooks/useDisputeWorkspace";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

/** Matches BANK_CLAIM_MAX_TEXT in lib/disputes/bankClaim.ts. */
const MAX_TEXT = 8000;

export function BankClaimCard({ workspace }: { workspace: Workspace }) {
  const t = useTranslations("disputes.bankClaim");
  const { data, derived, actions } = workspace;
  const searchParams = useSearchParams();
  const ref = useRef<HTMLDivElement | null>(null);

  const [text, setText] = useState("");
  const [noClaimShown, setNoClaimShown] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const trigger = data?.bankClaim?.trigger ?? null;
  const answer = data?.bankClaim?.answer ?? null;
  const visible = trigger !== null && answer === null;

  useEffect(() => {
    if (visible && searchParams?.get("section") === "bank-claim") {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [visible, searchParams]);

  if (!visible || !data?.dispute) return null;
  if (derived.isBuilding || derived.isRegenerating) return null;

  const orderUrl = getShopifyOrderUrl(data.dispute.shopDomain, data.dispute.orderGid);
  const canSubmit = !submitting && (text.trim().length > 0 || noClaimShown);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await actions.submitBankClaim(text.trim() || null, noClaimShown);
      if (!result.ok) {
        setErrorMessage(
          result.code === "WINDOW_CLOSED"
            ? t("errorWindowClosed")
            : t("errorGeneric", { code: result.code ?? "unknown" }),
        );
        return;
      }
      setText("");
      setNoClaimShown(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div id="bank-claim" ref={ref}>
      <Card>
        <BlockStack gap="300">
          <BlockStack gap="100">
            <Text as="p" variant="bodySm" tone="caution" fontWeight="semibold">
              {t("eyebrow")}
            </Text>
            <Text as="h3" variant="headingMd">
              {t("title")}
            </Text>
            <Text as="p" variant="bodyMd">
              {trigger === "reopened" ? t("introReopened") : t("introGeneral")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("why")}
            </Text>
          </BlockStack>

          <BlockStack gap="100">
            <Text as="p" variant="bodySm">
              {t("step1")}
            </Text>
            <Text as="p" variant="bodySm">
              {t("step2")}
            </Text>
          </BlockStack>

          {orderUrl ? (
            <InlineStack>
              <Button url={orderUrl} target="_blank" external>
                {t("openInShopify")}
              </Button>
            </InlineStack>
          ) : null}

          {errorMessage ? (
            <Banner tone="warning" onDismiss={() => setErrorMessage(null)}>
              <p>{errorMessage}</p>
            </Banner>
          ) : null}

          <TextField
            label={t("textLabel")}
            value={text}
            onChange={setText}
            multiline={5}
            maxLength={MAX_TEXT}
            autoComplete="off"
            placeholder={t("textPlaceholder")}
            helpText={t("textHelp")}
            disabled={submitting || noClaimShown}
          />
          <Checkbox
            label={t("noClaimShown")}
            helpText={t("noClaimShownHelp")}
            checked={noClaimShown}
            onChange={(v) => setNoClaimShown(v)}
            disabled={submitting}
          />
          <Text as="p" variant="bodySm" tone="subdued">
            {t("holdNote")}
          </Text>
          <InlineStack align="end">
            <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>
              {t("submit")}
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </div>
  );
}
