"use client";

import { useEffect } from "react";
import { BlockStack, Text, Button } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import { openInAdmin } from "@/lib/embedded/openInAdmin";
import type { StepId } from "@/lib/setup/types";

interface OpenInAdminStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

export function OpenInAdminStep({ stepId, onSaveRef }: OpenInAdminStepProps) {
  const t = useTranslations("setup.openInAdmin");

  useEffect(() => {
    onSaveRef.current = async () => {
      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId, payload: {} }),
      });
      return res.ok;
    };
  }, [stepId, onSaveRef]);

  return (
    <BlockStack gap="400">
      <Text as="h2" variant="headingLg">
        {t("title")}
      </Text>
      <Text as="p" variant="bodyMd" tone="subdued">
        {t("description")}
      </Text>
      <Button
        variant="primary"
        onClick={() => openInAdmin({ newContext: true })}
      >
        {t("cta")}
      </Button>
    </BlockStack>
  );
}
