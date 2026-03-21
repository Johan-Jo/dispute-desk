"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BlockStack,
  Text,
  Banner,
  Button,
  Collapsible,
  Select,
  TextField,
  InlineStack,
  Spinner,
  Badge,
} from "@shopify/polaris";
import { Info, Zap } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { StepId } from "@/lib/setup/types";
import { withShopParams } from "@/lib/withShopParams";
import type {
  AutomationSetupPayload,
  HandlingModeUi,
  ReasonRowState,
} from "@/lib/rules/setupAutomation";
import type { TemplateListItem } from "@/lib/types/templates";
import { DISPUTE_REASONS_ORDER } from "@/lib/rules/disputeReasons";

const CONTENT_MAX_WIDTH_PX = 560;

/** Reasons shown under “exceptions” — default (GENERAL) is separate */
const EXCEPTION_REASONS = DISPUTE_REASONS_ORDER.filter((r) => r !== "GENERAL");

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

const REASON_HELP_KEY: Record<string, string> = {
  FRAUDULENT: "reasonHelpFraudulent",
  PRODUCT_NOT_RECEIVED: "reasonHelpPnr",
  SUBSCRIPTION_CANCELED: "reasonHelpSub",
  PRODUCT_UNACCEPTABLE: "reasonHelpUnacceptable",
  CREDIT_NOT_PROCESSED: "reasonHelpCredit",
  DUPLICATE: "reasonHelpDuplicate",
  GENERAL: "reasonHelpGeneral",
};

type PresetId = "manual" | "review" | "auto";

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
        borderRadius: 12,
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

function sectionCardStyle(): React.CSSProperties {
  return {
    border: "1px solid #E8EAED",
    borderRadius: 14,
    padding: 20,
    background: "#FFFFFF",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05)",
  };
}

function SafeguardSwitch({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "4px 0",
      }}
    >
      <label htmlFor={id} style={{ flex: 1, cursor: "pointer" }}>
        <Text as="span" variant="bodyMd">
          {label}
        </Text>
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        style={{
          width: 44,
          height: 26,
          borderRadius: 13,
          border: "none",
          padding: 0,
          background: checked ? "#2C6ECB" : "#D2D5D8",
          position: "relative",
          cursor: "pointer",
          flexShrink: 0,
          transition: "background 0.2s ease",
        }}
      >
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 3,
            left: checked ? 21 : 3,
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 2px rgba(0,0,0,0.12)",
            transition: "left 0.2s ease",
          }}
        />
      </button>
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
  const [activePreset, setActivePreset] = useState<PresetId | null>(null);
  const [exceptionsOpen, setExceptionsOpen] = useState(false);
  const [activatedPacks, setActivatedPacks] = useState<{ id: string; name: string }[]>([]);

  const packsHref = useMemo(
    () => withShopParams("/app/packs", searchParams),
    [searchParams]
  );
  const packsSetupHref = useMemo(
    () => withShopParams("/app/setup/packs", searchParams),
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

  const hasInstalledPacks = installedTemplateIds.length > 0;
  const packsPrereqBannerId = useId();
  const safeguardHighValueId = useId();
  const safeguardCatchAllId = useId();
  const exceptionsCollapsibleId = useId();

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

  useEffect(() => {
    let cancelled = false;
    const shopId = getShopId();
    if (!shopId) {
      setActivatedPacks([]);
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `/api/packs?shopId=${encodeURIComponent(shopId)}&status=ACTIVE`
        );
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { packs?: { id: string; name: string }[] };
        if (cancelled) return;
        setActivatedPacks(
          (body.packs ?? []).map((p) => ({ id: p.id, name: p.name }))
        );
      } catch {
        if (!cancelled) setActivatedPacks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const generalRow = useMemo(
    () => payload?.reason_rows.find((r) => r.reason === "GENERAL"),
    [payload]
  );

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

  const applyManualPreset = useCallback(() => {
    setActivePreset("manual");
    setPayload((prev) =>
      prev
        ? {
            ...prev,
            reason_rows: prev.reason_rows.map((row) => ({
              ...row,
              mode: "manual" as const,
              pack_template_id: null,
            })),
          }
        : prev
    );
  }, []);

  const applyReviewPreset = useCallback(() => {
    setActivePreset("review");
    setPayload((prev) =>
      prev
        ? {
            ...prev,
            reason_rows: prev.reason_rows.map((row) => ({
              ...row,
              mode: "review" as const,
              pack_template_id: null,
            })),
          }
        : prev
    );
  }, []);

  const applyAutoPreset = useCallback(() => {
    setActivePreset("auto");
    applyRecommended();
  }, [applyRecommended]);

  const updateRow = useCallback(
    (reason: string, patch: Partial<ReasonRowState>) => {
      setActivePreset(null);
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

  function reasonHelp(reason: string): string {
    const key = REASON_HELP_KEY[reason];
    return key ? t(key as "reasonHelpFraudulent") : "";
  }

  const modeSummaryLabel = useCallback(
    (row: ReasonRowState): string => {
      if (row.mode === "manual") return t("modeManual");
      if (row.mode === "review") return t("modeReviewFirst");
      const tn = row.pack_template_id
        ? templateNameById.get(row.pack_template_id) ?? ""
        : "";
      return tn ? `${t("modeAutoBuild")} (${tn})` : t("modeAutoBuild");
    },
    [t, templateNameById]
  );

  const summaryLines = useMemo(() => {
    if (!payload || !generalRow) return [];
    const lines: string[] = [];
    lines.push(
      t("summaryDefault", { mode: modeSummaryLabel(generalRow) })
    );
    for (const r of payload.reason_rows.filter((x) => x.reason !== "GENERAL")) {
      lines.push(
        t("summaryReason", {
          reason: reasonLabel(r.reason),
          mode: modeSummaryLabel(r),
        })
      );
    }
    if (payload.safeguards.high_value_review_enabled) {
      lines.push(
        t("summaryHighValue", {
          amount: String(payload.safeguards.high_value_min),
        })
      );
    }
    if (payload.safeguards.catch_all_review_enabled) {
      lines.push(t("summaryCatchAll"));
    }
    return lines;
  }, [payload, generalRow, t, modeSummaryLabel]);

  const controlsLocked = !hasInstalledPacks;

  if (loadError) {
    return (
      <div
        style={{
          maxWidth: CONTENT_MAX_WIDTH_PX,
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

  if (!payload || !generalRow) {
    return (
      <div
        style={{
          maxWidth: CONTENT_MAX_WIDTH_PX,
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

  const presetCards: { id: PresetId; titleKey: string; lineKey: string; onClick: () => void; suggested?: boolean }[] = [
    { id: "manual", titleKey: "presetManualTitle", lineKey: "presetManualLine", onClick: applyManualPreset, suggested: true },
    { id: "review", titleKey: "presetReviewTitle", lineKey: "presetReviewLine", onClick: applyReviewPreset },
    { id: "auto", titleKey: "presetAutoTitle", lineKey: "presetAutoLine", onClick: applyAutoPreset },
  ];

  return (
    <div
      style={{
        maxWidth: CONTENT_MAX_WIDTH_PX,
        margin: "0 auto",
        width: "100%",
        paddingBottom: 24,
      }}
    >
      <BlockStack gap="600">
        <BlockStack gap="300">
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 56,
                height: 56,
                borderRadius: 12,
                background: "linear-gradient(145deg, #1D4ED8 0%, #3B82F6 100%)",
                boxShadow: "0 1px 2px rgba(15, 23, 42, 0.08)",
              }}
            >
              <Zap size={28} color="#FFFFFF" strokeWidth={2.25} aria-hidden />
            </div>
          </div>
          <BlockStack gap="400">
            <BlockStack gap="200">
              <Text as="h1" variant="headingXl">
                {t("title")}
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                {t("subtitle")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("introOneLiner")}{" "}
                <a href={packsHref} style={{ color: "#2C6ECB", fontWeight: 600, textDecoration: "none" }}>
                  {t("packsLinkLabel")}
                </a>
              </Text>
            </BlockStack>

            <div
              style={{
                paddingTop: 4,
                borderTop: "1px solid #E3E5E8",
              }}
            >
              <BlockStack gap="300">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  {t("activatedPackagesTitle")}
                </Text>
                {activatedPacks.length === 0 ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("activatedPackagesEmpty")}
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
          </BlockStack>
        </BlockStack>

        {validationError && (
          <Banner tone="critical" onDismiss={() => setValidationError(null)}>
            <Text as="p">{t(validationError)}</Text>
          </Banner>
        )}

        {!hasInstalledPacks && (
          <div id={packsPrereqBannerId}>
            <Banner tone="warning">
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  {t("packsPrereqTitle")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("packsPrereqBody")}{" "}
                  <a href={packsSetupHref} style={{ color: "#2C6ECB", fontWeight: 600 }}>
                    {t("packsPrereqSetupLink")}
                  </a>
                </Text>
              </BlockStack>
            </Banner>
          </div>
        )}

        {/* Presets */}
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            {t("presetSectionTitle")}
          </Text>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 12,
            }}
          >
            {presetCards.map((pc) => {
              const selected = activePreset === pc.id;
              const showSuggestedBadge =
                Boolean(pc.suggested) &&
                (activePreset === null || activePreset === "manual");
              return (
                <button
                  key={pc.id}
                  type="button"
                  onClick={pc.onClick}
                  disabled={pc.id === "auto" && !hasInstalledPacks}
                  style={{
                    textAlign: "left",
                    padding: 16,
                    borderRadius: 12,
                    border: selected
                      ? "2px solid #2C6ECB"
                      : "1px solid #E8EAED",
                    background: selected ? "#F0F6FF" : "#FDFDFE",
                    boxShadow: selected ? "0 0 0 1px rgba(44, 110, 203, 0.12)" : "0 1px 2px rgba(15, 23, 42, 0.04)",
                    cursor: pc.id === "auto" && !hasInstalledPacks ? "not-allowed" : "pointer",
                    opacity: pc.id === "auto" && !hasInstalledPacks ? 0.55 : 1,
                    transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
                  }}
                >
                  <BlockStack gap="150">
                    <InlineStack gap="200" blockAlign="center" wrap>
                      <Text as="span" variant="bodyMd" fontWeight="bold">
                        {t(pc.titleKey as "presetManualTitle")}
                      </Text>
                      {showSuggestedBadge && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                            color: "#64748B",
                            background: "#F1F5F9",
                            padding: "2px 6px",
                            borderRadius: 4,
                          }}
                        >
                          {t("presetBadgeSuggested")}
                        </span>
                      )}
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t(pc.lineKey as "presetManualLine")}
                    </Text>
                  </BlockStack>
                </button>
              );
            })}
          </div>
        </BlockStack>

        {/* Default rule GENERAL */}
        <BlockStack gap="300">
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center" wrap>
              <Text as="h2" variant="headingMd">
                {t("defaultSectionTitle")}
              </Text>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#64748B",
                  background: "#F1F5F9",
                  padding: "4px 8px",
                  borderRadius: 6,
                  letterSpacing: "0.02em",
                }}
              >
                {t("defaultFallbackBadge")}
              </span>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("defaultSectionSubtitle")}
            </Text>
          </BlockStack>
          <div
            style={{
              ...sectionCardStyle(),
              ...(controlsLocked
                ? { opacity: 0.58, background: "#F6F6F7" }
                : {}),
            }}
            role={controlsLocked ? "group" : undefined}
            aria-describedby={controlsLocked ? packsPrereqBannerId : undefined}
            aria-label={controlsLocked ? t("rulesTableLockedAria") : undefined}
          >
            <BlockStack gap="300">
              <Text as="p" variant="bodySm" tone="subdued">
                {reasonHelp("GENERAL")}
              </Text>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}
              >
                {generalRow.mode === "manual" ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("templateNoneDash")}
                  </Text>
                ) : (
                  <Select
                    label={t("colTemplate")}
                    options={templateChoicesForRow(generalRow.mode)}
                    value={generalRow.pack_template_id ?? ""}
                    disabled={controlsLocked}
                    onChange={(value) =>
                      updateRow("GENERAL", { pack_template_id: value || null })
                    }
                  />
                )}
                <Select
                  label={t("colHandling")}
                  options={modeOptions}
                  value={generalRow.mode}
                  disabled={controlsLocked}
                  onChange={(value) => {
                    const mode = value as HandlingModeUi;
                    updateRow("GENERAL", {
                      mode,
                      pack_template_id: mode === "manual" ? null : generalRow.pack_template_id,
                    });
                  }}
                />
              </div>
            </BlockStack>
          </div>
        </BlockStack>

        {/* Exceptions — progressive disclosure */}
        <BlockStack gap="300">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              {t("exceptionsSectionTitle")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("exceptionsSectionSubtitle")}
            </Text>
            <div>
              <Button
                variant="plain"
                disclosure={exceptionsOpen ? "up" : "down"}
                onClick={() => setExceptionsOpen((o) => !o)}
                ariaExpanded={exceptionsOpen}
                ariaControls={exceptionsCollapsibleId}
              >
                {exceptionsOpen ? t("exceptionsToggleHide") : t("exceptionsToggleShow")}
              </Button>
            </div>
          </BlockStack>
          <Collapsible id={exceptionsCollapsibleId} open={exceptionsOpen}>
            <BlockStack gap="300">
              {EXCEPTION_REASONS.map((reason) => {
                const row = payload.reason_rows.find((r) => r.reason === reason);
                if (!row) return null;
                return (
                  <div
                    key={reason}
                    style={{
                      ...sectionCardStyle(),
                      ...(controlsLocked
                        ? { opacity: 0.58, background: "#F6F6F7" }
                        : {}),
                    }}
                  >
                    <BlockStack gap="300">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {reasonLabel(reason)}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {reasonHelp(reason)}
                      </Text>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 12,
                        }}
                      >
                        {row.mode === "manual" ? (
                          <Text as="p" variant="bodySm" tone="subdued">
                            {t("templateNoneDash")}
                          </Text>
                        ) : (
                          <Select
                            label={t("colTemplate")}
                            options={templateChoicesForRow(row.mode)}
                            value={row.pack_template_id ?? ""}
                            disabled={controlsLocked}
                            onChange={(value) =>
                              updateRow(reason, { pack_template_id: value || null })
                            }
                          />
                        )}
                        <Select
                          label={t("colHandling")}
                          options={modeOptions}
                          value={row.mode}
                          disabled={controlsLocked}
                          onChange={(value) => {
                            const mode = value as HandlingModeUi;
                            updateRow(reason, {
                              mode,
                              pack_template_id: mode === "manual" ? null : row.pack_template_id,
                            });
                          }}
                        />
                      </div>
                    </BlockStack>
                  </div>
                );
              })}
            </BlockStack>
          </Collapsible>
        </BlockStack>

        {/* Safeguards */}
        <div
          style={{
            ...sectionCardStyle(),
            borderColor: "#E2E8F0",
            background: "#FAFBFC",
          }}
        >
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                {t("safeguardsSectionTitle")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("safeguardsOverrideNote")}
              </Text>
            </BlockStack>
            <SafeguardSwitch
              id={safeguardHighValueId}
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
              <div style={{ maxWidth: 240 }}>
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
            <SafeguardSwitch
              id={safeguardCatchAllId}
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
          </BlockStack>
        </div>

        {/* Summary */}
        <div
          style={{
            ...sectionCardStyle(),
            background: "#F6F7F8",
            borderStyle: "dashed",
          }}
        >
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              {t("summarySectionTitle")}
            </Text>
            <ul style={{ margin: 0, paddingLeft: 20, color: "#374151", fontSize: 14, lineHeight: 1.6 }}>
              {summaryLines.map((line, idx) => (
                <li key={`summary-${idx}`}>{line}</li>
              ))}
            </ul>
          </BlockStack>
        </div>

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
