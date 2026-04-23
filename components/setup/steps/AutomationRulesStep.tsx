"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BlockStack, Text, Banner, Spinner, Button, Badge, InlineStack } from "@shopify/polaris";
import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import type { StepId } from "@/lib/setup/types";
import { withShopParams } from "@/lib/withShopParams";
import type { Pack } from "@/lib/types/packs";
import {
  validatePackModes,
  type PackHandlingUiMode,
} from "@/lib/rules/packHandlingAutomation";
import { PackModeSegmentedControl } from "@/components/setup/PackModeSegmentedControl";
import { agentLogClient } from "@/lib/debug/agentLogClient";
import { useDdDebug } from "@/lib/setup/useDdDebug";

const CONTENT_MAX_WIDTH_PX = 720;

type RulesDebugSnap = {
  autoHttp: number | null;
  packCount: number | null;
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
      <div>active packs: {snap.packCount ?? "…"}</div>
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

function normalizeDisputeTypeKey(disputeType: string | null): string {
  return (disputeType ?? "GENERAL").toUpperCase().replace(/\s+/g, "_");
}

export function AutomationRulesStep({ stepId, onSaveRef }: AutomationRulesStepProps) {
  const t = useTranslations("setup.rules");
  const tPacks = useTranslations("packs");
  const searchParams = useSearchParams();

  const [activePacks, setActivePacks] = useState<Pack[]>([]);
  const [packModes, setPackModes] = useState<Record<string, PackHandlingUiMode>>({});
  const [installedTemplateIds, setInstalledTemplateIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const showDebug = useDdDebug();
  const [debugSnap, setDebugSnap] = useState<RulesDebugSnap>({
    autoHttp: null,
    packCount: null,
    loadError: null,
    shopIdCookieLen: null,
  });

  const packsSetupHref = useMemo(
    () => withShopParams("/app/setup/packs", searchParams),
    [searchParams]
  );
  const rulesHref = useMemo(
    () => withShopParams("/app/rules", searchParams),
    [searchParams]
  );

  const installedSet = useMemo(
    () => new Set(installedTemplateIds),
    [installedTemplateIds]
  );

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
      setLoadError(null);
      try {
        const [autoRes, stateRes] = await Promise.all([
          fetch("/api/setup/automation"),
          fetch("/api/setup/state"),
        ]);
        if (cancelled) return;
        const sidLen = getShopId()?.length ?? 0;
        setDebugSnap((d) => ({
          ...d,
          autoHttp: autoRes.status,
          shopIdCookieLen: sidLen,
        }));
        agentLogClient({
          hypothesisId: "H2",
          location: "AutomationRulesStep.load",
          message: "automation_fetch",
          data: { autoStatus: autoRes.status },
        });
        if (!autoRes.ok) {
          setLoadError("load_failed");
          setDebugSnap((d) => ({ ...d, loadError: "load_failed" }));
          return;
        }
        const body = (await autoRes.json()) as {
          activePacks?: Pack[];
          pack_modes?: Record<string, PackHandlingUiMode>;
          installedTemplateIds?: string[];
        };

        // Read evidence confidence from coverage step to set smarter defaults
        const stateBody = stateRes.ok ? await stateRes.json() : null;
        const evidenceConfidence: string =
          stateBody?.steps?.coverage?.payload?.evidenceConfidence ?? "medium";

        const packs = body.activePacks ?? [];
        const modes: Record<string, PackHandlingUiMode> = { ...(body.pack_modes ?? {}) };
        for (const p of packs) {
          if (modes[p.id] === undefined) {
            // Smart default based on evidence confidence
            if (evidenceConfidence === "high") {
              modes[p.id] = "auto";
            } else if (evidenceConfidence === "medium") {
              const dt = (p.dispute_type ?? "").toUpperCase();
              modes[p.id] = (dt === "FRAUD" || dt === "PNR") ? "auto" : "review";
            } else {
              modes[p.id] = "review";
            }
          }
        }
        if (cancelled) return;
        setActivePacks(packs);
        setPackModes(modes);
        setInstalledTemplateIds(body.installedTemplateIds ?? []);
        setDebugSnap((d) => ({
          ...d,
          packCount: packs.length,
          loadError: null,
        }));
      } catch {
        if (!cancelled) {
          setLoadError("load_failed");
          setDebugSnap((d) => ({ ...d, loadError: "exception" }));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPackModes((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const p of activePacks) {
        const can =
          p.template_id != null && installedSet.has(p.template_id);
        if (next[p.id] === "auto" && !can) {
          next[p.id] = "review";
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activePacks, installedSet]);

  const setMode = useCallback((packId: string, mode: PackHandlingUiMode) => {
    setPackModes((prev) => ({ ...prev, [packId]: mode }));
  }, []);

  useEffect(() => {
    onSaveRef.current = async () => {
      setValidationError(null);
      const shopId = getShopId();
      if (!shopId) return false;

      const err = validatePackModes(activePacks, packModes, installedSet);
      if (err) {
        setValidationError(err);
        return false;
      }

      const autoRes = await fetch("/api/setup/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shopId, pack_modes: packModes }),
      });
      if (!autoRes.ok) {
        setValidationError("saveErrorGeneric");
        return false;
      }

      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId,
          payload: { automationVersion: 3 },
        }),
      });
      return res.ok;
    };
  }, [stepId, onSaveRef, activePacks, packModes, installedSet]);

  if (loadError) {
    return (
      <>
        <div style={{ maxWidth: CONTENT_MAX_WIDTH_PX, margin: "0 auto", width: "100%" }}>
          <Banner tone="critical">
            <Text as="p">{t(loadError)}</Text>
          </Banner>
        </div>
        {showDebug ? <AutomationRulesDebugHud snap={debugSnap} /> : null}
      </>
    );
  }

  if (loading) {
    return (
      <>
        <div
          style={{
            maxWidth: CONTENT_MAX_WIDTH_PX,
            margin: "0 auto",
            width: "100%",
            padding: "40px 0",
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

  const hasPacks = activePacks.length > 0;

  return (
    <>
      <div
        style={{
          maxWidth: CONTENT_MAX_WIDTH_PX,
          margin: "0 auto",
          width: "100%",
          padding: "8px 0 24px",
        }}
      >
        <BlockStack gap="600">
          <BlockStack gap="400" inlineAlign="center">
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                background: "linear-gradient(145deg, #1D4ED8 0%, #3B82F6 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 4px 14px rgba(37, 99, 235, 0.25)",
              }}
              aria-hidden
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <Text as="h1" variant="headingXl">
              {t("title")}
            </Text>
            <div style={{ maxWidth: 520, textAlign: "center" }}>
              <Text as="p" variant="bodyMd" tone="subdued">
                {t("packHandlingIntro")}
              </Text>
            </div>
            <div style={{ maxWidth: 560, textAlign: "center" }}>
              <Text as="p" variant="bodyMd" tone="subdued">
                {t("packHandlingHelper")}
              </Text>
            </div>
          </BlockStack>

          {validationError && (
            <Banner tone="critical" onDismiss={() => setValidationError(null)}>
              <Text as="p">
                {validationError === "saveErrorGeneric"
                  ? t("saveErrorGeneric")
                  : t(validationError as "validationTemplateInstalled")}
              </Text>
            </Banner>
          )}

          <div
            style={{
              height: 1,
              background: "linear-gradient(90deg, transparent, #E2E8F0 15%, #E2E8F0 85%, transparent)",
              margin: "8px 0",
            }}
            aria-hidden
          />

          {!hasPacks ? (
            <div
              style={{
                textAlign: "center",
                padding: "32px 20px",
                borderRadius: 16,
                border: "1px solid #E8EAED",
                background: "#FAFBFC",
              }}
            >
              <BlockStack gap="300" inlineAlign="center">
                <Text as="h2" variant="headingMd">
                  {t("emptyPacksTitle")}
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  {t("emptyPacksBody")}
                </Text>
                <Button url={packsSetupHref}>{t("backToPacksCta")}</Button>
              </BlockStack>
            </div>
          ) : (
            <BlockStack gap="500">
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  {t("packHandlingSectionTitle")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("packHandlingPriorityHint")}
                </Text>
              </BlockStack>

              <BlockStack gap="400">
                {activePacks.map((pack, index) => {
                  const mode = packModes[pack.id] ?? "review";
                  const canAuto =
                    pack.template_id != null &&
                    installedSet.has(pack.template_id);
                  return (
                    <div
                      key={pack.id}
                      style={{
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "stretch",
                        gap: 20,
                        minHeight: 112,
                        padding: "20px 22px",
                        borderRadius: 16,
                        border: "1px solid #E8EAED",
                        background: "#FFFFFF",
                        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.03)",
                      }}
                    >
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          flexShrink: 0,
                          borderRadius: 12,
                          background: "linear-gradient(135deg, #2563EB, #60A5FA)",
                          color: "#fff",
                          fontWeight: 700,
                          fontSize: 15,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        aria-hidden
                      >
                        {index + 1}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <BlockStack gap="200">
                          <InlineStack gap="200" wrap blockAlign="center">
                            <Text as="h3" variant="headingSm">
                              {pack.name}
                            </Text>
                            {pack.status === "ACTIVE" ? (
                              <Badge tone="success">{t("badgeActiveRow")}</Badge>
                            ) : (
                              <Badge tone="attention">{t("badgeDraftRow")}</Badge>
                            )}
                            {index === 0 ? (
                              <Badge tone="info">{t("badgeRecommendedRow")}</Badge>
                            ) : null}
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {disputeLabel(pack.dispute_type)}
                          </Text>
                        </BlockStack>
                      </div>
                      <div style={{ flexShrink: 0, alignSelf: "center" }}>
                        <PackModeSegmentedControl
                          value={mode === "auto" && !canAuto ? "review" : mode}
                          onChange={(next) => {
                            if (next === "auto" && !canAuto) return;
                            setMode(pack.id, next);
                          }}
                          disabled={false}
                          disabledAuto={!canAuto}
                          reviewLabel={t("segmentManual")}
                          autoLabel={t("segmentAuto")}
                          reviewHint={t("segmentManualHint")}
                          autoHint={t("segmentAutoHint")}
                          autoDisabledReason={t("packAutoDisabledHint")}
                        />
                      </div>
                    </div>
                  );
                })}
              </BlockStack>
            </BlockStack>
          )}

          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              padding: "16px 18px",
              borderRadius: 14,
              border: "1px solid #E2E8F0",
              background: "#F8FAFC",
            }}
          >
            <div
              style={{
                flexShrink: 0,
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "#EFF6FF",
                border: "1px solid #BFDBFE",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Info size={15} color="#2563EB" strokeWidth={2.5} aria-hidden />
            </div>
            <BlockStack gap="100">
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                {t("changeLaterTitle")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("changeLaterBody")}{" "}
                <a href={rulesHref} style={{ color: "#2563EB", fontWeight: 600, textDecoration: "none" }}>
                  {t("changeLaterRulesLink")}
                </a>
              </Text>
            </BlockStack>
          </div>
        </BlockStack>
      </div>
      {showDebug ? <AutomationRulesDebugHud snap={debugSnap} /> : null}
    </>
  );
}
