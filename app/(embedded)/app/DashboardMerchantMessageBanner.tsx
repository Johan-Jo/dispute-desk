"use client";

/**
 * Renders the active admin→merchant message for this shop, if any.
 *
 * Ops composes these on the admin shop-detail page (Messages card).
 * Typical use: we see upside on an account but have no working contact
 * channel, so we ask — inside the app — for an email or phone number,
 * and the answer is mailed to the ops address.
 *
 * Deliberately a dismissible Polaris Banner rather than a blocking
 * modal: a merchant who isn't interested dismisses it once and it
 * stays gone (dismissal is server-side, so it holds across devices).
 * A modal that intercepts the session would be hostile to the merchant
 * and a Shopify App Store review risk.
 *
 * Copy is admin-authored free text (see lib/merchantMessages/types.ts
 * for why it isn't tokenized); only the surrounding form chrome is
 * localized.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Banner,
  BlockStack,
  Button,
  InlineStack,
  TextField,
  Text,
} from "@shopify/polaris";
import type { ActiveMerchantMessage } from "@/lib/merchantMessages/types";

export function DashboardMerchantMessageBanner() {
  const t = useTranslations();
  const [message, setMessage] = useState<ActiveMerchantMessage | null>(null);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/message")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setMessage(d.message ?? null);
      })
      .catch(() => {
        /* a missing banner is not worth surfacing an error for */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!message || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    fetch("/api/dashboard/message/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: message.id }),
    }).catch(() => {
      /* swallow — next load re-offers it, which is the safe direction */
    });
  };

  const submit = async () => {
    if (!email.trim() && !phone.trim()) return;
    setSubmitting(true);
    setError(false);
    try {
      const res = await fetch("/api/dashboard/message/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id, email, phone }),
      });
      if (!res.ok) throw new Error("submit failed");
      setSubmitted(true);
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <Banner tone="success" title={t("dashboard.merchantMessage.thanksTitle")}>
        <Text as="p">{t("dashboard.merchantMessage.thanksBody")}</Text>
      </Banner>
    );
  }

  return (
    <Banner tone={message.tone} onDismiss={dismiss} title={message.title}>
      <BlockStack gap="300">
        <Text as="p" variant="bodyMd" fontWeight="semibold">
          {message.body}
        </Text>
        {message.askForContact ? (
          <>
            <InlineStack gap="300" blockAlign="end" wrap>
              <div style={{ minWidth: 240 }}>
                <TextField
                  label={t("dashboard.merchantMessage.emailLabel")}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={setEmail}
                />
              </div>
              <div style={{ minWidth: 200 }}>
                <TextField
                  label={t("dashboard.merchantMessage.phoneLabel")}
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={setPhone}
                />
              </div>
              <Button
                variant="primary"
                onClick={submit}
                loading={submitting}
                disabled={!email.trim() && !phone.trim()}
              >
                {t("dashboard.merchantMessage.cta")}
              </Button>
            </InlineStack>
            {error ? (
              <Text as="p" tone="critical">
                {t("dashboard.merchantMessage.error")}
              </Text>
            ) : null}
          </>
        ) : null}
      </BlockStack>
    </Banner>
  );
}
