"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Spinner,
  Banner,
} from "@shopify/polaris";
import { FileText, CheckCircle } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import type { StepId } from "@/lib/setup/types";
import { TemplateSetupWizardModal } from "@/components/setup/modals/TemplateSetupWizardModal";

interface Template {
  id: string;
  name: string;
  short_description: string;
  dispute_type: string | null;
  is_recommended: boolean;
}

interface PacksStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

export function PacksStep({ stepId, onSaveRef }: PacksStepProps) {
  const t = useTranslations("setup.packs");
  const tPacks = useTranslations("packs");
  const locale = useLocale();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Wizard modal state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardTemplate, setWizardTemplate] = useState<Template | null>(null);

  useEffect(() => {
    fetch(`/api/templates?locale=${encodeURIComponent(locale)}`)
      .then((r) => r.json())
      .then((data: { templates: Template[] }) => {
        setTemplates(data.templates ?? []);
      })
      .catch(() => setError(t("fetchError")))
      .finally(() => setLoading(false));
  }, [t, locale]);

  const handleInstallClick = useCallback((tpl: Template) => {
    setWizardTemplate(tpl);
    setWizardOpen(true);
  }, []);

  const handleWizardComplete = useCallback(async () => {
    if (!wizardTemplate) return;

    setWizardOpen(false);
    setInstalling(wizardTemplate.id);
    setError(null);

    try {
      const res = await fetch(`/api/templates/${wizardTemplate.id}/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        setError(t("installError"));
        return;
      }

      setInstalledIds((prev) => new Set(prev).add(wizardTemplate.id));
    } catch {
      setError(t("installError"));
    } finally {
      setInstalling(null);
      setWizardTemplate(null);
    }
  }, [wizardTemplate, t]);

  const handleWizardClose = useCallback(() => {
    setWizardOpen(false);
    setWizardTemplate(null);
  }, []);

  // Register save handler for the setup wizard shell
  useEffect(() => {
    onSaveRef.current = async () => {
      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId,
          payload: { installedTemplates: Array.from(installedIds) },
        }),
      });
      return res.ok;
    };
  }, [stepId, onSaveRef, installedIds]);

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          padding: "60px 0",
        }}
      >
        <Spinner size="large" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <BlockStack gap="600">
        {/* Hero header */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 14,
              background: "#D89A2B",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 20,
            }}
          >
            <FileText size={28} color="#fff" />
          </div>
          <Text as="h2" variant="headingLg">
            {t("title")}
          </Text>
          <div style={{ marginTop: 8, maxWidth: 600 }}>
            <Text as="p" variant="bodyMd" tone="subdued">
              {t("subtitle")}
            </Text>
          </div>
        </div>

        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <Text as="p" variant="bodyMd">
              {error}
            </Text>
          </Banner>
        )}

        {/* Template cards */}
        {templates.length === 0 ? (
          <Banner tone="info">
            <Text as="p" variant="bodyMd">
              {t("empty")}
            </Text>
          </Banner>
        ) : (
          <BlockStack gap="300">
            {templates.map((tpl) => {
              const isInstalled = installedIds.has(tpl.id);
              const isInstalling = installing === tpl.id;

              return (
                <div
                  key={tpl.id}
                  style={{
                    border: `1px solid ${isInstalled ? "#22C55E" : "#E1E3E5"}`,
                    borderLeft: isInstalled
                      ? "4px solid #22C55E"
                      : "1px solid #E1E3E5",
                    borderRadius: 12,
                    padding: "16px 20px",
                    background: isInstalled ? "#F0FDF4" : "#FFFFFF",
                    transition: "border-color 150ms, background 150ms",
                  }}
                >
                  <InlineStack align="space-between" blockAlign="center" wrap={false}>
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h3" variant="headingSm">
                          {tpl.name}
                        </Text>
                        {tpl.dispute_type && (
                          <Badge>
                            {(tPacks as (k: string) => string)(
                              `disputeTypeLabel.${tpl.dispute_type.toUpperCase().replace(/\s+/g, "_")}`
                            ) || tpl.dispute_type}
                          </Badge>
                        )}
                        {tpl.is_recommended && (
                          <Badge tone="warning">{t("recommended")}</Badge>
                        )}
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {tpl.short_description}
                      </Text>
                    </BlockStack>

                    <div style={{ flexShrink: 0, marginLeft: 16 }}>
                      {isInstalled ? (
                        <InlineStack gap="100" blockAlign="center">
                          <CheckCircle size={18} color="#22C55E" />
                          <Text as="span" variant="bodySm" fontWeight="semibold">
                            {t("installedBtn")}
                          </Text>
                        </InlineStack>
                      ) : (
                        <Button
                          onClick={() => handleInstallClick(tpl)}
                          loading={isInstalling}
                          disabled={isInstalling}
                        >
                          {t("installBtn")}
                        </Button>
                      )}
                    </div>
                  </InlineStack>
                </div>
              );
            })}
          </BlockStack>
        )}

        {/* Info note */}
        <div
          style={{
            background: "#FFF7ED",
            border: "1px solid #FCD9A4",
            borderRadius: 14,
            padding: 20,
          }}
        >
          <Text as="p" variant="bodyMd" fontWeight="bold">
            {t("changeLaterTitle")}
          </Text>
          <div style={{ marginTop: 4 }}>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("changeLaterDesc")}
            </Text>
          </div>
        </div>
      </BlockStack>

      {/* Wizard modal */}
      {wizardTemplate && (
        <TemplateSetupWizardModal
          open={wizardOpen}
          onClose={handleWizardClose}
          onComplete={handleWizardComplete}
          templateName={wizardTemplate.name}
          templateType={
            (tPacks as (k: string) => string)(
              `disputeTypeLabel.${(wizardTemplate.dispute_type ?? "GENERAL").toUpperCase().replace(/\s+/g, "_")}`
            ) || (wizardTemplate.dispute_type ?? "General")
          }
        />
      )}
    </div>
  );
}
