"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Page, Banner } from "@shopify/polaris";
import { BusinessPoliciesStep } from "@/components/setup/steps/BusinessPoliciesStep";

export default function EmbeddedPoliciesPage() {
  const t = useTranslations("nav");
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
      title={t("policies")}
      backAction={{ content: t("overview"), url: "/app" }}
      primaryAction={{
        content: "Save policies",
        onAction: handleSave,
        loading: saving,
      }}
    >
      {status === "success" && (
        <Banner tone="success" onDismiss={() => setStatus("idle")}>
          Policies saved.
        </Banner>
      )}
      {status === "error" && (
        <Banner tone="critical" onDismiss={() => setStatus("idle")}>
          Could not save policies. Pick a flow and try again.
        </Banner>
      )}
      <BusinessPoliciesStep stepId="policies" onSaveRef={saveRef} />
    </Page>
  );
}
