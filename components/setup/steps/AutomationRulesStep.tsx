"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BlockStack,
  Text,
  Banner,
  Card,
  Spinner,
} from "@shopify/polaris";
import { Info } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { StepId } from "@/lib/setup/types";
import { withShopParams } from "@/lib/withShopParams";
import type { AutomationSetupPayload } from "@/lib/rules/setupAutomation";
import type { TemplateListItem } from "@/lib/types/templates";
import { RULE_PRESETS } from "@/lib/rules/presets";
import {
  applyStarterModeChange,
  coerceFraudPnrAutoWhenNoTemplates,
  starterModesFromPayload,
} from "@/lib/rules/starterAutomationMapping";
import { EmbeddedStarterRulesWorkflow } from "@/components/rules/EmbeddedStarterRulesWorkflow";
import { agentLogClient } from "@/lib/debug/agentLogClient";
import { useDdDebug } from "@/lib/setup/useDdDebug";

const CONTENT_MAX_WIDTH_PX = 640;

type RulesDebugSnap = {
  autoHttp: number | null;
  tplHttp: number | null;
  reasonRows: number | null;
  hasGeneral: boolean | null;
  loadError: string | null;
  shopIdCookieLen: number | null;
};

function AutomationRulesDebugHud({ snap }: { snap: RulesDebugSnap }) {
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        left: 8,
        bottom: 8,
        zIndex: 9999,
        maxWidth: 380,
        padding: "10px 12px",
        fontSize: 11,
        fontFamily: "ui-monospace, monospace",
        lineHeight: 1.4,
        background: "#1e293b",
        color: "#E2E8F0",
        borderRadius: 8,
        border: "1px solid #475569",
        boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
        pointerEvents: "none",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6, color: "#7DD3FC" }}>
        dd_debug · automation step
      </div>
      <div>GET /api/setup/automation → HTTP {snap.autoHttp ?? "…"}</div>
      <div>GET /api/templates → HTTP {snap.tplHttp ?? "…"}</div>
      <div>
        reason_rows: {snap.reasonRows ?? "…"} · has GENERAL:{" "}
        {String(snap.hasGeneral)}
      </div>
      <div>loadError: {snap.loadError ?? "—"}</div>
      <div>shopify_shop_id cookie len: {snap.shopIdCookieLen ?? "…"}</div>
    </div>
  );
}

interface AutomationRulesStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

function getShopId(): string | null {
  return document.cookie.match(/shopify_shop_id=([^;]+)/)?.[1] ?? null;
}

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
          <a
            href={rulesHref}
            style={{ color: "#2C6ECB", fontWeight: 600, textDecoration: "none" }}
          >
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
  const [activatedPacks, setActivatedPacks] = useState<{ id: string; name: string }[]>(
    []
  );
  const showDebug = useDdDebug();
  const [debugSnap, setDebugSnap] = useState<RulesDebugSnap>({
    autoHttp: null,
    tplHttp: null,
    reasonRows: null,
    hasGeneral: null,
    loadError: null,
    shopIdCookieLen: null,
  });

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

  const hasInstalledPacks = installedTemplateIds.length > 0;
  const packsPrereqBannerId = useId();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [autoRes, tplRes] = await Promise.all([
          fetch("/api/setup/automation"),
          fetch(`/api/templates?locale=${encodeURIComponent(locale)}`),
        ]);
        if (cancelled) return;
        const sidLen = getShopId()?.length ?? 0;
        setDebugSnap((d) => ({
          ...d,
          autoHttp: autoRes.status,
          tplHttp: tplRes.status,
          shopIdCookieLen: sidLen,
        }));
        agentLogClient({
          hypothesisId: "H2",
          location: "AutomationRulesStep.load",
          message: "automation_fetch",
          data: {
            autoStatus: autoRes.status,
            tplStatus: tplRes.status,
          },
        });
        if (!autoRes.ok) {
          setLoadError("load_failed");
          setDebugSnap((d) => ({ ...d, loadError: "load_failed" }));
          return;
        }
        const autoBody = (await autoRes.json()) as AutomationSetupPayload & {
          installedTemplateIds?: string[];
        };
        const tplBody = (await tplRes.json()) as { templates?: TemplateListItem[] };
        const installed = autoBody.installedTemplateIds ?? [];
        const raw: AutomationSetupPayload = {
          reason_rows: autoBody.reason_rows,
          safeguards: autoBody.safeguards,
        };
        const coerced = coerceFraudPnrAutoWhenNoTemplates(raw, installed);
        setPayload(coerced);
        setInstalledTemplateIds(installed);
        setCatalog(tplBody.templates ?? []);
        const hasGeneral = Boolean(
          autoBody.reason_rows?.some((r) => r.reason === "GENERAL")
        );
        agentLogClient({
          hypothesisId: "H4",
          location: "AutomationRulesStep.load",
          message: "payload_ready",
          data: {
            reasonRows: autoBody.reason_rows?.length ?? 0,
            hasGeneral,
          },
        });
        setDebugSnap((d) => ({
          ...d,
          reasonRows: autoBody.reason_rows?.length ?? 0,
          hasGeneral,
          loadError: null,
        }));
      } catch {
        if (!cancelled) {
          setLoadError("load_failed");
          setDebugSnap((d) => ({ ...d, loadError: "exception" }));
        }
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

  const starterModes = useMemo(
    () => (payload ? starterModesFromPayload(payload) : {}),
    [payload]
  );

  const handleStarterModeChange = useCallback(
    (presetId: string, mode: "auto_pack" | "review") => {
      const preset = RULE_PRESETS.find((p) => p.id === presetId);
      if (!preset || !payload) return;
      setPayload((prev) => {
        if (!prev) return prev;
        let next = applyStarterModeChange(prev, preset, mode, {
          installedTemplateIds,
          catalog,
        });
        next = coerceFraudPnrAutoWhenNoTemplates(next, installedTemplateIds);
        return next;
      });
    },
    [payload, installedTemplateIds, catalog]
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

  if (loadError) {
    return (
      <>
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
        {showDebug ? <AutomationRulesDebugHud snap={debugSnap} /> : null}
      </>
    );
  }

  if (!payload) {
    return (
      <>
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
        {showDebug ? <AutomationRulesDebugHud snap={debugSnap} /> : null}
      </>
    );
  }

  return (
    <>
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
            <Text as="h1" variant="headingXl">
              {t("title")}
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              {t("subtitle")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("introOneLiner")}{" "}
              <a
                href={packsHref}
                style={{ color: "#2C6ECB", fontWeight: 600, textDecoration: "none" }}
              >
                {t("packsLinkLabel")}
              </a>
            </Text>
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

          <Card>
            <EmbeddedStarterRulesWorkflow
              tr={tRules}
              starterModes={starterModes}
              onStarterModeChange={handleStarterModeChange}
              activatedPacks={activatedPacks}
              allowAutoPackForFraudAndPnr={hasInstalledPacks}
              highValueMin={payload.safeguards.high_value_min}
              onHighValueMinChange={(value) =>
                setPayload((p) =>
                  p
                    ? {
                        ...p,
                        safeguards: { ...p.safeguards, high_value_min: value },
                      }
                    : p
                )
              }
              highValueReviewEnabled={payload.safeguards.high_value_review_enabled}
              highValueMinLabel={t("highValueMinLabel")}
            />
          </Card>

          <ChangeLaterCallout
            title={t("changeLaterTitle")}
            body={t("changeLaterBody")}
            rulesHref={rulesHref}
            linkLabel={t("changeLaterRulesLink")}
          />
        </BlockStack>
      </div>
      {showDebug ? <AutomationRulesDebugHud snap={debugSnap} /> : null}
    </>
  );
}
