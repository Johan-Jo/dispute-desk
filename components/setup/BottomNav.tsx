"use client";

import { InlineStack, Button } from "@shopify/polaris";
import { useTranslations } from "next-intl";

interface BottomNavProps {
  onBack?: () => void;
  onSaveAndContinue: () => void;
  onSkip?: () => void;
  isFirst: boolean;
  isLast: boolean;
  saving?: boolean;
}

export function BottomNav({
  onBack,
  onSaveAndContinue,
  onSkip,
  isFirst,
  isLast,
  saving,
}: BottomNavProps) {
  const t = useTranslations("setup");
  return (
    <div
      style={{
        borderTop: "1px solid #E1E3E5",
        paddingTop: 16,
        marginTop: 24,
      }}
    >
      <InlineStack gap="300" align="space-between">
        <div>
          {!isFirst && onBack && (
            <Button onClick={onBack}>{t("back")}</Button>
          )}
        </div>
        <InlineStack gap="300">
          {!isLast && onSkip && (
            <Button onClick={onSkip}>{t("skipForNow")}</Button>
          )}
          <Button
            variant="primary"
            onClick={onSaveAndContinue}
            loading={saving}
          >
            {isLast ? t("finishSetup") : t("saveAndContinue")}
          </Button>
        </InlineStack>
      </InlineStack>
    </div>
  );
}
