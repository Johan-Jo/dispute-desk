/**
 * Embedded Automation page — Figma-matched layout.
 *
 * Per-family routing view backed by the canonical pack-based automation
 * system. One row per dispute family from DISPUTE_FAMILIES; each row's
 * segmented toggle edits the modes of all packs in that family. Saves go
 * through POST /api/setup/automation (pack_modes branch) — same pipeline
 * the setup wizard uses, so coverage and rules always agree.
 *
 * Also includes:
 * - Safeguards section: high-value review threshold (standalone rule with
 *   __dd_safeguard__: prefix, survives pack-based saves)
 * - Custom rules: read-only list of user-created rules from /portal/rules
 */
"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  Button,
  Spinner,
  InlineStack,
  BlockStack,
  Banner,
  Icon,
  Checkbox,
  TextField,
} from "@shopify/polaris";
import {
  ShieldPersonIcon,
  AlertTriangleIcon,
  DeliveryIcon,
  OrderIcon,
  ReceiptRefundIcon,
  DuplicateIcon,
  ClipboardCheckFilledIcon,
  InfoIcon,
  XIcon,
} from "@shopify/polaris-icons";
import { DISPUTE_FAMILIES } from "@/lib/coverage/deriveCoverage";
import { TemplateLibraryModal } from "@/components/packs/TemplateLibraryModal";
import {
  disputeTypeToPrimaryReason,
  type PackHandlingUiMode,
} from "@/lib/rules/packHandlingAutomation";

// ─── Constants ──────────────────────────────────────────────────────────

const SAFEGUARD_RULE_NAME = "__dd_safeguard__:high_value";
const DEFAULT_SAFEGUARD_AMOUNT = 500;
const EXPLAINER_DISMISSED_KEY = "dd_automation_explainer_dismissed";

const FAMILY_TO_DISPUTE_TYPE: Record<string, string> = {
  fraud: "FRAUD",
  pnr: "PNR",
  not_as_described: "NOT_AS_DESCRIBED",
  subscription: "SUBSCRIPTION",
  refund: "REFUND",
  duplicate: "DUPLICATE",
  general: "GENERAL",
};

const FAMILY_ICONS: Record<string, typeof ShieldPersonIcon> = {
  fraud: ShieldPersonIcon,
  pnr: DeliveryIcon,
  not_as_described: AlertTriangleIcon,
  subscription: OrderIcon,
  refund: ReceiptRefundIcon,
  duplicate: DuplicateIcon,
  general: ClipboardCheckFilledIcon,
};

const FAMILY_ICON_COLOR: Record<string, string> = {
  fraud: "#DC2626",
  pnr: "#3B82F6",
  not_as_described: "#F59E0B",
  subscription: "#22C55E",
  refund: "#8B5CF6",
  duplicate: "#06B6D4",
  general: "#6D7175",
};

// ─── Types ──────────────────────────────────────────────────────────────

interface ActivePack {
  id: string;
  name: string;
  dispute_type: string;
  template_id: string | null;
  status: string;
}

interface AutomationData {
  activePacks: ActivePack[];
  pack_modes: Record<string, PackHandlingUiMode>;
}

interface CustomRule {
  id: string;
  name: string | null;
  enabled: boolean;
  match: {
    reason?: string[];
    status?: string[];
    amount_range?: { min?: number; max?: number };
  };
  action: {
    mode: string;
    pack_template_id?: string | null;
  };
  priority: number;
}

interface SafeguardState {
  ruleId: string | null;
  enabled: boolean;
  amount: number;
}

function isSetupOrSafeguardRule(name: string | null | undefined): boolean {
  return Boolean(
    name?.startsWith("__dd_setup__") || name?.startsWith("__dd_safeguard__"),
  );
}

type FamilyMode = "auto" | "review" | "none";

// ─── Component ──────────────────────────────────────────────────────────

export default function EmbeddedRulesPage() {
  const searchParams = useSearchParams();
  const locale = useLocale();
  const tr = useTranslations("rules");
  const tn = useTranslations("nav");
  const tc = useTranslations("coverage");
  const tp = useTranslations("packs");

  // Data
  const [automation, setAutomation] = useState<AutomationData | null>(null);
  const [customRules, setCustomRules] = useState<CustomRule[]>([]);
  const [pendingModes, setPendingModes] = useState<
    Record<string, PackHandlingUiMode>
  >({});
  const [safeguard, setSafeguard] = useState<SafeguardState>({
    ruleId: null,
    enabled: false,
    amount: DEFAULT_SAFEGUARD_AMOUNT,
  });
  const [savedSafeguard, setSavedSafeguard] = useState<SafeguardState>({
    ruleId: null,
    enabled: false,
    amount: DEFAULT_SAFEGUARD_AMOUNT,
  });

  // UI state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [highlightedFamilyId, setHighlightedFamilyId] = useState<
    string | null
  >(null);
  const [shopId, setShopId] = useState<string | null>(null);
  const [installModalFamily, setInstallModalFamily] = useState<string | null>(null);
  const [explainerOpen, setExplainerOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(EXPLAINER_DISMISSED_KEY) !== "1";
  });
  const familyRowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const dismissExplainer = useCallback(() => {
    setExplainerOpen(false);
    try { localStorage.setItem(EXPLAINER_DISMISSED_KEY, "1"); } catch {}
  }, []);

  // ─── Data fetching ────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [automationRes, rulesRes, stateRes] = await Promise.all([
        fetch("/api/setup/automation"),
        fetch("/api/rules"),
        fetch("/api/setup/state"),
      ]);

      if (stateRes.ok) {
        const stateData = await stateRes.json();
        if (stateData?.shopId) setShopId(stateData.shopId);
      }

      if (automationRes.ok) {
        const data = await automationRes.json();
        const next: AutomationData = {
          activePacks: data.activePacks ?? [],
          pack_modes: data.pack_modes ?? {},
        };
        setAutomation(next);
        setPendingModes(next.pack_modes);
      }

      if (rulesRes.ok) {
        const allRules = (await rulesRes.json()) as CustomRule[];
        const arr = Array.isArray(allRules) ? allRules : [];

        const sg = arr.find((r) => r.name === SAFEGUARD_RULE_NAME);
        if (sg) {
          const sgState: SafeguardState = {
            ruleId: sg.id,
            enabled: sg.enabled,
            amount: sg.match?.amount_range?.min ?? DEFAULT_SAFEGUARD_AMOUNT,
          };
          setSafeguard(sgState);
          setSavedSafeguard(sgState);
        }

        setCustomRules(arr.filter((r) => !isSetupOrSafeguardRule(r.name)));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // ─── Derived state ────────────────────────────────────────────────────

  const familyPacks = useMemo(() => {
    const map: Record<string, ActivePack[]> = {};
    for (const family of DISPUTE_FAMILIES) {
      if (!automation) {
        map[family.id] = [];
        continue;
      }
      map[family.id] = automation.activePacks.filter((p) => {
        const reason = disputeTypeToPrimaryReason(p.dispute_type);
        return family.reasons.includes(reason);
      });
    }
    return map;
  }, [automation]);

  const familyModes = useMemo(() => {
    const out: Record<string, FamilyMode> = {};
    for (const family of DISPUTE_FAMILIES) {
      const packs = familyPacks[family.id] ?? [];
      if (packs.length === 0) {
        out[family.id] = "none";
        continue;
      }
      const anyAuto = packs.some((p) => pendingModes[p.id] === "auto");
      out[family.id] = anyAuto ? "auto" : "review";
    }
    return out;
  }, [familyPacks, pendingModes]);

  const summary = useMemo(() => {
    let auto = 0;
    let review = 0;
    let noPlaybook = 0;
    for (const family of DISPUTE_FAMILIES) {
      const m = familyModes[family.id];
      if (m === "auto") auto++;
      else if (m === "review") review++;
      else noPlaybook++;
    }
    return { auto, review, noPlaybook, total: DISPUTE_FAMILIES.length };
  }, [familyModes]);

  const packModesDirty = useMemo(() => {
    if (!automation) return false;
    const allKeys = new Set([
      ...Object.keys(automation.pack_modes),
      ...Object.keys(pendingModes),
    ]);
    for (const id of allKeys) {
      if (automation.pack_modes[id] !== pendingModes[id]) return true;
    }
    return false;
  }, [automation, pendingModes]);

  const safeguardDirty = useMemo(
    () =>
      safeguard.enabled !== savedSafeguard.enabled ||
      safeguard.amount !== savedSafeguard.amount,
    [safeguard, savedSafeguard],
  );

  const dirty = packModesDirty || safeguardDirty;

  // ─── Deep link from coverage ──────────────────────────────────────────

  useEffect(() => {
    if (loading) return;
    const familyId = searchParams?.get("family");
    if (!familyId) return;
    requestAnimationFrame(() => {
      const el = familyRowRefs.current[familyId];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightedFamilyId(familyId);
        setTimeout(() => setHighlightedFamilyId(null), 2500);
      }
    });
  }, [loading, searchParams]);

  // ─── Actions ──────────────────────────────────────────────────────────

  const setFamilyMode = useCallback(
    (familyId: string, mode: "auto" | "review") => {
      const packs = familyPacks[familyId] ?? [];
      if (packs.length === 0) return;
      setPendingModes((prev) => {
        const next = { ...prev };
        for (const p of packs) {
          next[p.id] = mode;
        }
        return next;
      });
    },
    [familyPacks],
  );

  const applyQuickConfig = useCallback(
    (mode: "auto" | "review") => {
      if (!automation) return;
      setPendingModes((prev) => {
        const next = { ...prev };
        for (const p of automation.activePacks) {
          next[p.id] = mode;
        }
        return next;
      });
    },
    [automation],
  );

  const save = useCallback(async () => {
    setSaving(true);
    setErrorMsg(null);
    setSavedBanner(false);
    try {
      if (packModesDirty) {
        const res = await fetch("/api/setup/automation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pack_modes: pendingModes }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            typeof body?.error === "string" ? body.error : "save_failed",
          );
        }
      }

      if (safeguardDirty) {
        const rulePayload = {
          name: SAFEGUARD_RULE_NAME,
          match: { amount_range: { min: safeguard.amount } },
          action: { mode: "review" as const },
          enabled: safeguard.enabled,
          priority: 5,
        };

        if (safeguard.ruleId) {
          const res = await fetch(`/api/rules/${safeguard.ruleId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(rulePayload),
          });
          if (!res.ok) throw new Error("safeguard_save_failed");
        } else if (safeguard.enabled) {
          const res = await fetch("/api/rules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(rulePayload),
          });
          if (!res.ok) throw new Error("safeguard_save_failed");
        }
      }

      await fetchAll();
      setSavedBanner(true);
    } catch {
      setErrorMsg("starterRulesError");
    } finally {
      setSaving(false);
    }
  }, [pendingModes, packModesDirty, safeguard, safeguardDirty, fetchAll]);

  // ─── Render ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Page title={tn("automation")} subtitle={tr("purposeLine")}>
        <Layout>
          <Layout.Section>
            <Card>
              <div style={{ padding: "2rem", textAlign: "center" }}>
                <Spinner size="large" />
              </div>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const configuredCount = summary.auto + summary.review;

  // Custom rules live in the merchant portal, not in the embedded app.
  // Open in a new tab so the iframe doesn't try to load disputedesk.app
  // inside Shopify Admin (which CSP refuses).
  const portalRulesUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://disputedesk.app"}/portal/rules`;

  return (
    <Page
      title={tn("automation")}
      subtitle={tr("purposeLine")}
      primaryAction={{
        content: tr("primaryAddCustom"),
        url: portalRulesUrl,
        external: true,
      }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {savedBanner && (
              <Banner tone="success" onDismiss={() => setSavedBanner(false)}>
                <p>{tr("starterRulesSaved")}</p>
              </Banner>
            )}
            {errorMsg && (
              <Banner tone="critical" onDismiss={() => setErrorMsg(null)}>
                <p>{tr(errorMsg)}</p>
              </Banner>
            )}

            {/* ── Dismissable explainer ────────────────────────────── */}
            {explainerOpen && (
              <div
                style={{
                  background: "#EBF5FA",
                  border: "1px solid #B4E1FA",
                  borderRadius: 8,
                  padding: 16,
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    flexShrink: 0,
                    marginTop: 2,
                    color: "#005BD3",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon source={InfoIcon} tone="info" />
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#202223", marginBottom: 8 }}>
                    {tr("explainerTitle")}
                  </div>
                  <ul style={{ listStyle: "disc", margin: 0, paddingLeft: 18, color: "#202223", fontSize: 14, lineHeight: 1.5 }}>
                    <li style={{ marginBottom: 6 }}>{tr("explainerBullet1")}</li>
                    <li style={{ marginBottom: 6 }}>{tr("explainerBullet2")}</li>
                    <li>{tr("explainerBullet3")}</li>
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={dismissExplainer}
                  aria-label="Dismiss"
                  style={{
                    flexShrink: 0,
                    background: "transparent",
                    border: "none",
                    padding: 4,
                    cursor: "pointer",
                    color: "#6D7175",
                    display: "inline-flex",
                  }}
                >
                  <span style={{ width: 20, height: 20, display: "inline-flex" }}>
                    <Icon source={XIcon} />
                  </span>
                </button>
              </div>
            )}

            {/* ── Status summary ─────────────────────────────────── */}
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">
                  {tr("figmaSummary", {
                    automated: summary.auto,
                    total: summary.total,
                    review: summary.review,
                  })}
                </Text>
                <InlineStack gap="200" wrap>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 600,
                      background: "#D1FAE5",
                      color: "#065F46",
                    }}
                  >
                    {`${summary.auto} ${tr("modeAutomaticShort")}`}
                  </span>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 600,
                      background: "#DBEAFE",
                      color: "#1E40AF",
                    }}
                  >
                    {`${summary.review} ${tr("review")}`}
                  </span>
                  {summary.noPlaybook > 0 && (
                    <Badge tone="attention">
                      {`${summary.noPlaybook} ${tr("notConfigured")}`}
                    </Badge>
                  )}
                </InlineStack>
              </BlockStack>
            </Card>

            {/* ── Automation rules card ──────────────────────────── */}
            <Card padding="0">
              {/* Header */}
              <div
                style={{
                  padding: "16px 20px",
                  borderBottom: "1px solid #E1E3E5",
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 600, color: "#202223", marginBottom: 4 }}>
                  {tr("automationRulesTitle")}
                </div>
                <div style={{ fontSize: 14, color: "#6D7175" }}>
                  {tr("automationRulesSubtitle")}
                </div>
              </div>

              {/* Family rows */}
              <div>
                {DISPUTE_FAMILIES.map((family, index) => {
                  const FamilyIcon =
                    FAMILY_ICONS[family.id] ?? ClipboardCheckFilledIcon;
                  const familyColor = FAMILY_ICON_COLOR[family.id] ?? "#6D7175";
                  const mode = familyModes[family.id];
                  const packs = familyPacks[family.id] ?? [];
                  const isHighlighted = highlightedFamilyId === family.id;
                  const familyLabel = tc(
                    family.labelKey.replace("coverage.", ""),
                  );
                  const playbookNames = packs
                    .map((p) =>
                      tp.has(`disputeTypeLabel.${p.dispute_type}`)
                        ? tp(`disputeTypeLabel.${p.dispute_type}`)
                        : p.name,
                    )
                    .join(", ");

                  return (
                    <div
                      key={family.id}
                      ref={(el) => {
                        familyRowRefs.current[family.id] = el;
                      }}
                      style={{
                        padding: "20px",
                        borderTop: index === 0 ? "none" : "1px solid #E1E3E5",
                        transition: "background-color 400ms ease",
                        background: isHighlighted ? "#FEF3C7" : "transparent",
                        display: "flex",
                        gap: 16,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 8,
                          background: "#F6F8FB",
                          color: familyColor,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Icon source={FamilyIcon} />
                      </div>

                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#202223", marginBottom: 2 }}>
                          {familyLabel}
                        </div>
                        {playbookNames ? (
                          <div style={{ fontSize: 12, color: "#6D7175" }}>
                            {tr("playbooksInUse", { names: playbookNames })}
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: "#6D7175" }}>
                            {tr("noPlaybookBadge")}
                          </div>
                        )}
                      </div>

                      {mode === "none" ? (
                        <Button
                          size="slim"
                          onClick={() => setInstallModalFamily(family.id)}
                        >
                          {tc("installPlaybook")}
                        </Button>
                      ) : (
                        <ModeToggle
                          mode={mode}
                          onChange={(next) => setFamilyMode(family.id, next)}
                          reviewLabel={tr("review")}
                          autoLabel={tr("modeAutomaticShort")}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Bottom toolbar */}
              <div
                style={{
                  padding: "16px 20px",
                  borderTop: "1px solid #E1E3E5",
                  background: "#F6F8FB",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <InlineStack gap="200" wrap>
                  <Button size="slim" onClick={() => applyQuickConfig("auto")}>
                    {tr("quickAutoAll")}
                  </Button>
                  <Button size="slim" onClick={() => applyQuickConfig("review")}>
                    {tr("quickReviewAll")}
                  </Button>
                </InlineStack>
                <Button
                  variant="primary"
                  loading={saving}
                  disabled={saving || !dirty}
                  onClick={save}
                >
                  {configuredCount > 0
                    ? tr("saveNRules", { count: configuredCount })
                    : tr("saveStarterRules")}
                </Button>
              </div>
              <div
                style={{
                  padding: "12px 20px",
                  borderTop: "1px solid #E1E3E5",
                  background: "#F6F8FB",
                  fontSize: 12,
                  color: "#6D7175",
                }}
              >
                {tr("firstMatchWinsHint")}
              </div>
            </Card>

            {/* ── Safeguards ─────────────────────────────────────── */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {tr("safeguardTitle")}
                </Text>
                <Checkbox
                  label={tr("safeguardToggle")}
                  checked={safeguard.enabled}
                  onChange={(checked) =>
                    setSafeguard((prev) => ({ ...prev, enabled: checked }))
                  }
                />
                {safeguard.enabled && (
                  <div style={{ maxWidth: 200 }}>
                    <TextField
                      label={tr("safeguardAmountLabel")}
                      type="number"
                      value={String(safeguard.amount)}
                      onChange={(value) => {
                        const num = parseInt(value, 10);
                        if (!isNaN(num) && num > 0) {
                          setSafeguard((prev) => ({ ...prev, amount: num }));
                        }
                      }}
                      prefix="$"
                      autoComplete="off"
                    />
                  </div>
                )}
                <Text as="p" variant="bodySm" tone="subdued">
                  {tr("safeguardHint")}
                </Text>
                {safeguardDirty && (
                  <InlineStack align="end">
                    <Button
                      variant="primary"
                      loading={saving}
                      disabled={saving}
                      onClick={save}
                    >
                      {tr("saveStarterRules")}
                    </Button>
                  </InlineStack>
                )}
              </BlockStack>
            </Card>

            {/* ── Custom advanced rules ──────────────────────────── */}
            {customRules.length > 0 && (
              <Card>
                <BlockStack gap="400">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      {tr("advancedFiltersTitle")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {tr("advancedFiltersSubtitle")}
                    </Text>
                  </BlockStack>

                  <BlockStack gap="0">
                    {customRules.map((rule, idx) => {
                      const normalizedMode =
                        rule.action?.mode === "auto" ||
                        rule.action?.mode === "auto_pack"
                          ? "auto"
                          : "review";
                      const actionLabel =
                        normalizedMode === "auto"
                          ? tr("autoPack")
                          : tr("review");
                      return (
                        <div
                          key={rule.id}
                          style={{
                            padding: "12px 0",
                            borderTop: idx === 0 ? "none" : "1px solid #E1E3E5",
                          }}
                        >
                          <InlineStack
                            align="space-between"
                            blockAlign="center"
                            wrap={false}
                            gap="300"
                          >
                            <InlineStack gap="300" blockAlign="center" wrap>
                              <Text as="h3" variant="bodyMd" fontWeight="semibold">
                                {rule.name ?? tr("unnamedRule")}
                              </Text>
                              <Badge tone={rule.enabled ? "success" : undefined}>
                                {rule.enabled ? tr("active") : tr("inactive")}
                              </Badge>
                            </InlineStack>
                            <Button url={portalRulesUrl} external>
                              {tr("editRule")}
                            </Button>
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {`${tr("action")}: ${actionLabel}`}
                          </Text>
                        </div>
                      );
                    })}
                  </BlockStack>
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
      {shopId && installModalFamily && (
        <TemplateLibraryModal
          isOpen
          onClose={() => setInstallModalFamily(null)}
          shopId={shopId}
          locale={locale}
          onInstalled={() => {
            setInstallModalFamily(null);
            fetchAll();
          }}
          initialCategory={FAMILY_TO_DISPUTE_TYPE[installModalFamily] ?? ""}
        />
      )}
    </Page>
  );
}

// ─── Mode toggle (segmented) ────────────────────────────────────────────

function ModeToggle({
  mode,
  onChange,
  reviewLabel,
  autoLabel,
}: {
  mode: "auto" | "review";
  onChange: (mode: "auto" | "review") => void;
  reviewLabel: string;
  autoLabel: string;
}) {
  const baseBtn: React.CSSProperties = {
    border: "none",
    padding: "6px 12px",
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 6,
    cursor: "pointer",
    transition: "all 150ms ease",
  };
  return (
    <div
      style={{
        display: "inline-flex",
        padding: 4,
        borderRadius: 8,
        border: "1px solid #C9CCCF",
        background: "#F6F8FB",
        gap: 4,
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        onClick={() => onChange("review")}
        style={{
          ...baseBtn,
          background: mode === "review" ? "#0EA5E9" : "transparent",
          color: mode === "review" ? "#FFFFFF" : "#6D7175",
          boxShadow:
            mode === "review" ? "0 1px 2px rgba(0,0,0,0.1)" : "none",
        }}
      >
        {reviewLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange("auto")}
        style={{
          ...baseBtn,
          background: mode === "auto" ? "#22C55E" : "transparent",
          color: mode === "auto" ? "#FFFFFF" : "#6D7175",
          boxShadow:
            mode === "auto" ? "0 1px 2px rgba(0,0,0,0.1)" : "none",
        }}
      >
        {autoLabel}
      </button>
    </div>
  );
}
