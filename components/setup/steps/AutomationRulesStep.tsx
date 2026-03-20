"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BlockStack,
  Text,
  Banner,
  Button,
  Select,
  TextField,
  Checkbox,
  Divider,
  InlineStack,
  Spinner,
} from "@shopify/polaris";
import { Zap, Info } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { StepId } from "@/lib/setup/types";
import { withShopParams } from "@/lib/withShopParams";
import type {
  AutomationSetupPayload,
  HandlingModeUi,
} from "@/lib/rules/setupAutomation";
import type { TemplateListItem } from "@/lib/types/templates";

/** Same inner width as `PacksStep` so the card content aligns with the previous wizard step */
const SETUP_STEP_CONTENT_MAX_WIDTH_PX = 720;

interface AutomationRulesStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

function getShopId(): string | null {
  return document.cookie.match(/shopify_shop_id=([^;]+)/)?.[1] ?? null;
}

const REASON_LABEL_KEY: Record<string, string> = {
  FRAUDULENT: "reasonFraudulent",
  PRODUCT_NOT_RECEIVED: "reasonProductNotReceived",
  SUBSCRIPTION_CANCELED: "reasonSubscriptionCanceled",
  PRODUCT_UNACCEPTABLE: "reasonProductUnacceptable",
  CREDIT_NOT_PROCESSED: "reasonCreditNotProcessed",
  DUPLICATE: "reasonDuplicate",
  GENERAL: "reasonGeneral",
};

/** Figma-aligned: warm callout (amber surface + border). */
function ChangeLaterCallout({
  title,
  body,
  rulesHref,
  linkLabel,
}: {
  title: string;
  body: string;
  rulesHref: string;
  linkLabel: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        padding: "14px 16px",
        borderRadius: 10,
        border: "1px solid #FCD34D",
        background: "#FFFBEB",
      }}
    >
      <div
        style={{
          flexShrink: 0,
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "#FFF7ED",
          border: "1px solid #FDBA74",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Info size={16} color="#EA580C" strokeWidth={2.5} aria-hidden />
      </div>
      <BlockStack gap="100">
        <Text as="p" variant="bodyMd" fontWeight="semibold">
          {title}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {body}{" "}
          <a href={rulesHref} style={{ color: "#2C6ECB", fontWeight: 600, textDecoration: "none" }}>
            {linkLabel}
          </a>
        </Text>
      </BlockStack>
    </div>
  );
}

export function AutomationRulesStep({ stepId, onSaveRef }: AutomationRulesStepProps) {
  const t = useTranslations("setup.rules");
  const tRules = useTranslations("rules");
  const locale = useLocale();
  const searchParams = useSearchParams();

  const [payload, setPayload] = useState<AutomationSetupPayload | null>(null);
  const [installedTemplateIds, setInstalledTemplateIds] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<TemplateListItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const packsHref = useMemo(
    () => withShopParams("/app/packs", searchParams),
    [searchParams]
  );

  const rulesHref = useMemo(
    () => withShopParams("/app/rules", searchParams),
    [searchParams]
  );

  const templateNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const tpl of catalog) {
      m.set(tpl.id, tpl.name);
    }
    return m;
  }, [catalog]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [autoRes, tplRes] = await Promise.all([
          fetch("/api/setup/automation"),
          fetch(`/api/templates?locale=${encodeURIComponent(locale)}`),
        ]);
        if (cancelled) return;
        if (!autoRes.ok) {
          setLoadError("load_failed");
          return;
        }
        const autoBody = (await autoRes.json()) as AutomationSetupPayload & {
          installedTemplateIds?: string[];
        };
        const tplBody = (await tplRes.json()) as { templates?: TemplateListItem[] };
        setPayload({
          reason_rows: autoBody.reason_rows,
          safeguards: autoBody.safeguards,
        });
        setInstalledTemplateIds(autoBody.installedTemplateIds ?? []);
        setCatalog(tplBody.templates ?? []);
      } catch {
        if (!cancelled) setLoadError("load_failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const validatePayload = useCallback(
    (p: AutomationSetupPayload): string | null => {
      const installed = new Set(installedTemplateIds);
      for (const row of p.reason_rows) {
        if (row.mode === "auto_build") {
          if (!row.pack_template_id) return "validationAutoBuildTemplate";
          if (!installed.has(row.pack_template_id)) return "validationTemplateInstalled";
        }
        if (row.pack_template_id && !installed.has(row.pack_template_id)) {
          return "validationTemplateInstalled";
        }
      }
      return null;
    },
    [installedTemplateIds]
  );

  const applyRecommended = useCallback(() => {
    setPayload((prev) => {
      if (!prev) return prev;
      const installed = new Set(installedTemplateIds);
      const byType = (dt: string) =>
        catalog
          .filter((x) => installed.has(x.id) && x.dispute_type === dt)
          .sort((a, b) => Number(b.is_recommended) - Number(a.is_recommended))[0]
            ?.id ?? null;

      const fraudTpl = byType("FRAUD");
      const pnrTpl = byType("PNR");

      const reason_rows = prev.reason_rows.map((row) => {
        if (row.reason === "FRAUDULENT" && fraudTpl) {
          return {
            ...row,
            mode: "auto_build" as const,
            pack_template_id: fraudTpl,
          };
        }
        if (row.reason === "PRODUCT_NOT_RECEIVED" && pnrTpl) {
          return {
            ...row,
            mode: "auto_build" as const,
            pack_template_id: pnrTpl,
          };
        }
        if (row.reason === "SUBSCRIPTION_CANCELED") {
          return { ...row, mode: "review" as const, pack_template_id: null };
        }
        return { ...row, mode: "manual" as const, pack_template_id: null };
      });

      return { ...prev, reason_rows };
    });
  }, [catalog, installedTemplateIds]);

  const updateRow = useCallback(
    (reason: string, patch: Partial<AutomationSetupPayload["reason_rows"][number]>) => {
      setPayload((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          reason_rows: prev.reason_rows.map((row) =>
            row.reason === reason ? { ...row, ...patch } : row
          ),
        };
      });
    },
    []
  );

  useEffect(() => {
    onSaveRef.current = async () => {
      setValidationError(null);
      const shopId = getShopId();
      if (!shopId || !payload) return false;

      const err = validatePayload(payload);
      if (err) {
        setValidationError(err);
        return false;
      }

      const autoRes = await fetch("/api/setup/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shopId, ...payload }),
      });
      if (!autoRes.ok) return false;

      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId,
          payload: { automationVersion: 2 },
        }),
      });
      return res.ok;
    };
  }, [stepId, onSaveRef, payload, validatePayload]);

  const modeOptions = useMemo(
    () => [
      { label: t("modeAutoBuild"), value: "auto_build" },
      { label: t("modeReviewFirst"), value: "review" },
      { label: t("modeManual"), value: "manual" },
    ],
    [t]
  );

  const templateChoicesForRow = useCallback(
    (mode: HandlingModeUi) => {
      const opts: { label: string; value: string }[] = [];
      if (mode === "review") {
        opts.push({ label: t("templateNoneOptional"), value: "" });
      }
      for (const id of installedTemplateIds) {
        const name = templateNameById.get(id) ?? id;
        opts.push({ label: name, value: id });
      }
      if (mode === "auto_build" && installedTemplateIds.length === 0) {
        opts.push({ label: t("noTemplatesInstalled"), value: "" });
      }
      return opts;
    },
    [installedTemplateIds, templateNameById, t]
  );

  function reasonLabel(reason: string): string {
    const key = REASON_LABEL_KEY[reason];
    return key ? tRules(key) : reason.replace(/_/g, " ");
  }

  if (loadError) {
    return (
      <div
        style={{
          maxWidth: SETUP_STEP_CONTENT_MAX_WIDTH_PX,
          margin: "0 auto",
          width: "100%",
        }}
      >
        <Banner tone="critical">
          <Text as="p">{t(loadError)}</Text>
        </Banner>
      </div>
    );
  }

  if (!payload) {
    return (
      <div
        style={{
          maxWidth: SETUP_STEP_CONTENT_MAX_WIDTH_PX,
          margin: "0 auto",
          width: "100%",
          padding: "48px 0",
          textAlign: "center",
        }}
      >
        <Spinner accessibilityLabel={t("loading")} />
        <div style={{ marginTop: 12 }}>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("loading")}
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: SETUP_STEP_CONTENT_MAX_WIDTH_PX,
        margin: "0 auto",
        width: "100%",
      }}
    >
    <BlockStack gap="500">
      {/* Figma: centered hero + lightning icon */}
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 56,
            height: 56,
            borderRadius: 12,
            background: "linear-gradient(145deg, #FB923C 0%, #EA580C 100%)",
            boxShadow: "0 1px 2px rgba(15, 23, 42, 0.08)",
            marginBottom: 4,
          }}
        >
          <Zap size={28} color="#FFFFFF" strokeWidth={2.25} aria-hidden />
        </div>
        <div style={{ marginTop: 12, maxWidth: 420, marginLeft: "auto", marginRight: "auto" }}>
          <Text as="h2" variant="headingLg">
            {t("title")}
          </Text>
        </div>
        <div
          style={{
            marginTop: 8,
            maxWidth: 440,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          <Text as="p" variant="bodyMd" tone="subdued">
            {t("subtitle")}
          </Text>
        </div>
        <div
          style={{
            marginTop: 12,
            maxWidth: 480,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          <Text as="p" variant="bodySm" tone="subdued">
            {t("heroIntro")}
          </Text>
        </div>
      </div>

      <Banner tone="info">
        <BlockStack gap="150">
          <Text as="p" variant="bodySm" fontWeight="semibold">
            {t("packsRelationTitle")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("packsRelationBody")}
          </Text>
          <Text as="p" variant="bodySm">
            <a
              href={packsHref}
              style={{ color: "#2C6ECB", fontWeight: 600, textDecoration: "none" }}
            >
              {t("packsLinkLabel")}
            </a>
          </Text>
        </BlockStack>
      </Banner>

      {validationError && (
        <Banner tone="critical" onDismiss={() => setValidationError(null)}>
          <Text as="p">{t(validationError)}</Text>
        </Banner>
      )}

      <InlineStack align="space-between" blockAlign="center" wrap>
        <Text as="h3" variant="headingMd">
          {t("sectionByReason")}
        </Text>
        <Button onClick={applyRecommended}>{t("recommendedButton")}</Button>
      </InlineStack>

      <Text as="p" variant="bodySm" tone="subdued">
        {t("precedenceNote")}
      </Text>
      <Text as="p" variant="bodySm" tone="subdued">
        {t("fallbackNote")}
      </Text>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(100px,1fr) minmax(140px,1.3fr) minmax(120px,1fr)",
          gap: 8,
          padding: "4px 4px 8px",
          fontSize: 12,
          fontWeight: 600,
          color: "#6D7175",
        }}
      >
        <span>{t("colReason")}</span>
        <span>{t("colTemplate")}</span>
        <span>{t("colHandling")}</span>
      </div>

      <BlockStack gap="300">
        {payload.reason_rows.map((row) => (
          <div
            key={row.reason}
            style={{
              border: "1px solid #E1E3E5",
              borderRadius: 12,
              padding: "14px 16px",
              background: "#FFFFFF",
              boxShadow: "0 1px 0 rgba(15, 23, 42, 0.04)",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(100px,1fr) minmax(140px,1.3fr) minmax(120px,1fr)",
                gap: 12,
                alignItems: "start",
              }}
            >
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {reasonLabel(row.reason)}
              </Text>
              {row.mode === "manual" ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("templateNoneDash")}
                </Text>
              ) : (
                <Select
                  label={t("colTemplate")}
                  labelHidden
                  options={templateChoicesForRow(row.mode)}
                  value={row.pack_template_id ?? ""}
                  onChange={(value) => {
                    updateRow(row.reason, {
                      pack_template_id: value || null,
                    });
                  }}
                />
              )}
              <Select
                label={t("colHandling")}
                labelHidden
                options={modeOptions}
                value={row.mode}
                onChange={(value) => {
                  const mode = value as HandlingModeUi;
                  updateRow(row.reason, {
                    mode,
                    pack_template_id: mode === "manual" ? null : row.pack_template_id,
                  });
                }}
              />
            </div>
          </div>
        ))}
      </BlockStack>

      <Divider />

      <Text as="h3" variant="headingMd">
        {t("safeguardsTitle")}
      </Text>
      <Text as="p" variant="bodySm" tone="subdued">
        {t("safeguardsIntro")}
      </Text>

      <Checkbox
        label={t("highValueLabel")}
        checked={payload.safeguards.high_value_review_enabled}
        onChange={(checked) =>
          setPayload((p) =>
            p
              ? {
                  ...p,
                  safeguards: {
                    ...p.safeguards,
                    high_value_review_enabled: checked,
                  },
                }
              : p
          )
        }
      />
      {payload.safeguards.high_value_review_enabled && (
        <div style={{ maxWidth: 220 }}>
          <TextField
            label={t("highValueMinLabel")}
            type="number"
            autoComplete="off"
            value={String(payload.safeguards.high_value_min)}
            onChange={(v) =>
              setPayload((p) =>
                p
                  ? {
                      ...p,
                      safeguards: {
                        ...p.safeguards,
                        high_value_min: Math.max(0, Number.parseFloat(v) || 0),
                      },
                    }
                  : p
              )
            }
          />
        </div>
      )}

      <Checkbox
        label={t("catchAllLabel")}
        checked={payload.safeguards.catch_all_review_enabled}
        onChange={(checked) =>
          setPayload((p) =>
            p
              ? {
                  ...p,
                  safeguards: {
                    ...p.safeguards,
                    catch_all_review_enabled: checked,
                  },
                }
              : p
          )
        }
      />

      <ChangeLaterCallout
        title={t("changeLaterTitle")}
        body={t("changeLaterBody")}
        rulesHref={rulesHref}
        linkLabel={t("changeLaterRulesLink")}
      />
    </BlockStack>
    </div>
  );
}
