"use client";

import { useCallback, useEffect, useState } from "react";
import { BlockStack, Text, Badge, Spinner, Banner, InlineStack } from "@shopify/polaris";
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

function getShopId(): string | null {
  return document.cookie.match(/shopify_shop_id=([^;]+)/)?.[1] ?? null;
}

function normalizeDisputeTypeKey(disputeType: string | null): string {
  return (disputeType ?? "GENERAL").toUpperCase().replace(/\s+/g, "_");
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

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardTemplate, setWizardTemplate] = useState<Template | null>(null);
  const [activatedPacks, setActivatedPacks] = useState<{ id: string; name: string }[]>([]);

  const disputeLabel = useCallback(
    (disputeType: string | null) => {
      const key = `disputeTypeLabel.${normalizeDisputeTypeKey(disputeType)}`;
      const label = (tPacks as (k: string) => string)(key);
      if (
        typeof label === "string" &&
        (label.includes("disputeTypeLabel.") || label.startsWith("packs."))
      ) {
        return normalizeDisputeTypeKey(disputeType).replace(/_/g, " ");
      }
      return label;
    },
    [tPacks]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [tplRes, autoRes] = await Promise.all([
          fetch(`/api/templates?locale=${encodeURIComponent(locale)}`),
          fetch("/api/setup/automation"),
        ]);
        if (cancelled) return;

        if (tplRes.ok) {
          const data = (await tplRes.json()) as { templates: Template[] };
          setTemplates(data.templates ?? []);
        } else {
          setTemplates([]);
          setError(t("fetchError"));
        }

        if (autoRes.ok) {
          const autoBody = (await autoRes.json()) as {
            installedTemplateIds?: string[];
          };
          setInstalledIds(new Set(autoBody.installedTemplateIds ?? []));
        } else {
          setInstalledIds(new Set());
        }

        const shopId = getShopId();
        if (shopId) {
          const packsRes = await fetch(
            `/api/packs?shopId=${encodeURIComponent(shopId)}&status=ACTIVE`
          );
          if (packsRes.ok && !cancelled) {
            const packsBody = (await packsRes.json()) as {
              packs?: { id: string; name: string }[];
            };
            setActivatedPacks(
              (packsBody.packs ?? []).map((p) => ({ id: p.id, name: p.name }))
            );
          }
        } else if (!cancelled) {
          setActivatedPacks([]);
        }
      } catch {
        if (!cancelled) setError(t("fetchError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
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
        body: JSON.stringify({ activate: true }),
      });

      if (!res.ok) {
        setError(t("installError"));
        return;
      }

      setInstalledIds((prev) => new Set(prev).add(wizardTemplate.id));

      const sid = getShopId();
      if (sid) {
        const packsRes = await fetch(
          `/api/packs?shopId=${encodeURIComponent(sid)}&status=ACTIVE`
        );
        if (packsRes.ok) {
          const packsBody = (await packsRes.json()) as {
            packs?: { id: string; name: string }[];
          };
          setActivatedPacks(
            (packsBody.packs ?? []).map((p) => ({ id: p.id, name: p.name }))
          );
        }
      }
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
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
          }}
        >
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

          <div
            style={{
              width: "100%",
              maxWidth: 640,
              marginTop: 20,
              paddingTop: 20,
              borderTop: "1px solid #E3E5E8",
              textAlign: "left",
            }}
          >
            <BlockStack gap="300">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("activatedInLibrary")}
              </Text>
              {activatedPacks.length === 0 ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("activatedPacksEmptyHint")}
                </Text>
              ) : (
                <InlineStack gap="200" wrap blockAlign="center">
                  {activatedPacks.map((p) => (
                    <Badge key={p.id} tone="success">
                      {p.name}
                    </Badge>
                  ))}
                </InlineStack>
              )}
            </BlockStack>
          </div>
        </div>

        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <Text as="p" variant="bodyMd">
              {error}
            </Text>
          </Banner>
        )}

        {templates.length === 0 ? (
          <Banner tone="info">
            <Text as="p" variant="bodyMd">
              {t("empty")}
            </Text>
          </Banner>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {templates.map((tpl) => {
              const isInstalled = installedIds.has(tpl.id);
              const isInstalling = installing === tpl.id;
              const typeLabel = disputeLabel(tpl.dispute_type);

              return (
                <div
                  key={tpl.id}
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 16,
                    padding: "18px 20px",
                    borderRadius: 8,
                    border: isInstalled
                      ? "1px solid #BBF7D0"
                      : "1px solid #D3D4D6",
                    borderLeft: isInstalled ? "3px solid #22C55E" : "3px solid #C4CDD5",
                    background: isInstalled ? "#F0FDF4" : "#F4F5F6",
                    transition: "border-color 150ms, background 150ms",
                  }}
                  aria-label={
                    isInstalled
                      ? `${tpl.name} — ${t("installedBtn")}`
                      : `${tpl.name} — ${t("notInstalledLabel")}`
                  }
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 16,
                            color: isInstalled ? "#202223" : "#5C5F62",
                            lineHeight: 1.35,
                          }}
                        >
                          {tpl.name}
                        </div>
                        {!isInstalled && (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              letterSpacing: "0.02em",
                              textTransform: "uppercase",
                              color: "#6D7175",
                              background: "#E4E5E7",
                              padding: "3px 8px",
                              borderRadius: 4,
                              lineHeight: 1.2,
                            }}
                          >
                            {t("notInstalledLabel")}
                          </span>
                        )}
                      </div>
                      {(tpl.dispute_type || tpl.is_recommended) && (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          {tpl.dispute_type && (
                            <Badge tone="info">{typeLabel}</Badge>
                          )}
                          {tpl.is_recommended && (
                            <Badge tone="warning">{t("recommended")}</Badge>
                          )}
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: 14,
                          color: isInstalled ? "#6D7175" : "#8C9196",
                          lineHeight: 1.5,
                        }}
                      >
                        {tpl.short_description}
                      </div>
                    </div>
                  </div>

                  <div style={{ flexShrink: 0, alignSelf: "center" }}>
                    {isInstalled ? (
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "10px 16px",
                          borderRadius: 8,
                          background: "#22C55E",
                          color: "#FFFFFF",
                          fontSize: 14,
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                        }}
                      >
                        <CheckCircle size={18} color="#FFFFFF" strokeWidth={2.5} />
                        <span>{t("installedBtn")}</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleInstallClick(tpl)}
                        disabled={isInstalling}
                        style={{
                          padding: "10px 18px",
                          borderRadius: 8,
                          border: "1px solid #BABFC3",
                          background: isInstalling ? "#E4E5E7" : "#FFFFFF",
                          color: isInstalling ? "#8C9196" : "#374151",
                          fontSize: 14,
                          fontWeight: 600,
                          cursor: isInstalling ? "not-allowed" : "pointer",
                          whiteSpace: "nowrap",
                          boxShadow: "0 1px 0 rgba(0, 0, 0, 0.05)",
                        }}
                      >
                        {isInstalling ? `${t("installBtn")}…` : t("installBtn")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

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

      {wizardTemplate && (
        <TemplateSetupWizardModal
          open={wizardOpen}
          onClose={handleWizardClose}
          onComplete={handleWizardComplete}
          templateName={wizardTemplate.name}
          templateType={
            disputeLabel(wizardTemplate.dispute_type) ||
            (wizardTemplate.dispute_type ?? "General")
          }
        />
      )}
    </div>
  );
}
