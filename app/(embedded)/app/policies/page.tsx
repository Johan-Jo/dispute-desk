"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Page, Banner, Layout, Card } from "@shopify/polaris";
import { BusinessPoliciesStep } from "@/components/setup/steps/BusinessPoliciesStep";

export default function EmbeddedPoliciesPage() {
  const tNav = useTranslations("nav");
  const t = useTranslations("policies");
  const saveRef = useRef<(() => Promise<boolean>) | null>(null) as React.MutableRefObject<(() => Promise<boolean>) | null>;
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");

  const handleSave = async () => {
    if (!saveRef.current) return;
    setSaving(true);
    setStatus("idle");
    try {
      const ok = await saveRef.current();
      setStatus(ok ? "success" : "error");
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page
      title={tNav("policies")}
      backAction={{ content: tNav("overview"), url: "/app" }}
      primaryAction={{
        content: t("savePolicies"),
        onAction: handleSave,
        loading: saving,
      }}
    >
      <Layout>
        <Layout.Section>
          {status === "success" && (
            <Banner tone="success" onDismiss={() => setStatus("idle")}>
              {t("policiesSaved")}
            </Banner>
          )}
          {status === "error" && (
            <Banner tone="critical" onDismiss={() => setStatus("idle")}>
              {t("policiesSaveError")}
            </Banner>
          )}
          <Card>
            <BusinessPoliciesStep stepId="policies" onSaveRef={saveRef} />
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
