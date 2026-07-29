/**
 * Embedded Automation page — store-wide handling switch.
 *
 * Replaces the per-dispute-type grid (7 family rows, each with an
 * Automatic/Review toggle). That grid presented seven choices where there was
 * really one: the per-type mode is gate #3 of 8 in the auto-save pipeline, and
 * coverage / fatal-loss / Moderate / Weak / product-family / the completeness
 * floor all park or block regardless of what the merchant picked. See
 * docs/technical.md § Store-wide automation mode.
 *
 * Three cards:
 *   1. How disputes are handled — the switch (writes immediately)
 *   2. Safeguards — the amount threshold + the read-only always-reviewed facts
 *   3. Custom rules — unchanged merchant-authored rules
 *
 * All persistence goes through GET|PUT /api/automation/store → the single
 * canonical path in lib/rules/storeAutomation.ts.
 */
"use client";

import { useState, useEffect, useCallback } from "react";
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
  Collapsible,
} from "@shopify/polaris";
import {
  InfoIcon,
  XIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@shopify/polaris-icons";
import { TemplateLibraryModal } from "@/components/packs/TemplateLibraryModal";
import { StoreModeSelector } from "@/components/automation/StoreModeSelector";
import { AlwaysReviewedFacts } from "@/components/automation/AlwaysReviewedFacts";
import { AutomationGroupList } from "@/components/automation/AutomationGroupList";
import type { GroupOverrides } from "@/lib/rules/automationGroups";
import { CustomRuleModal, type CustomRuleDraft } from "./CustomRuleModal";
import {
  DEFAULT_SAFEGUARD_AMOUNT,
  type StoreAutomationMode,
} from "@/lib/rules/storeAutomation";
import { isSetupOwnedRuleName } from "@/lib/rules/storeAutomationNames";
import { withShopParams } from "@/lib/withShopParams";

const EXPLAINER_DISMISSED_KEY = "dd_automation_explainer_dismissed";

interface CustomRule {
  id: string;
  name: string | null;
  enabled: boolean;
  match: {
    reason?: string[];
    status?: string[];
    amount_range?: { min?: number; max?: number };
  };
  action: { mode: string; pack_template_id?: string | null };
  priority: number;
}

interface SafeguardState {
  enabled: boolean;
  amount: number;
}

export default function EmbeddedRulesPage() {
  const searchParams = useSearchParams();
  const locale = useLocale();
  const tr = useTranslations("rules");
  const tn = useTranslations("nav");
  const tCommon = useTranslations("common");

  // Data
  const [mode, setMode] = useState<StoreAutomationMode>("review");
  const [safeguard, setSafeguard] = useState<SafeguardState>({
    enabled: false,
    amount: DEFAULT_SAFEGUARD_AMOUNT,
  });
  const [savedSafeguard, setSavedSafeguard] = useState<SafeguardState>({
    enabled: false,
    amount: DEFAULT_SAFEGUARD_AMOUNT,
  });
  /**
   * Per-group overrides. `groups` is what's on screen, `savedGroups` is what
   * the server has. They differ only for the instant between a change and its
   * response — but the distinction is load-bearing: see `onModeChange`.
   */
  const [groups, setGroups] = useState<GroupOverrides>({});
  const [savedGroups, setSavedGroups] = useState<GroupOverrides>({});
  const [rulesAllowed, setRulesAllowed] = useState(true);
  const [customRules, setCustomRules] = useState<CustomRule[]>([]);
  const [shopId, setShopId] = useState<string | null>(null);

  // UI state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [playbooksOpen, setPlaybooksOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [customRuleDraft, setCustomRuleDraft] = useState<CustomRuleDraft | null>(null);
  const [customRuleModalOpen, setCustomRuleModalOpen] = useState(false);
  const [explainerOpen, setExplainerOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(EXPLAINER_DISMISSED_KEY) !== "1";
  });

  const dismissExplainer = useCallback(() => {
    setExplainerOpen(false);
    try {
      localStorage.setItem(EXPLAINER_DISMISSED_KEY, "1");
    } catch {
      /* private browsing — the banner just reappears next visit */
    }
  }, []);

  // ─── Data fetching ────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [storeRes, rulesRes, stateRes] = await Promise.all([
        fetch("/api/automation/store"),
        fetch("/api/rules"),
        fetch("/api/setup/state"),
      ]);

      if (stateRes.ok) {
        const stateData = await stateRes.json();
        if (stateData?.shopId) setShopId(stateData.shopId);
      }

      if (storeRes.ok) {
        const data = await storeRes.json();
        setMode(data.mode === "auto" ? "auto" : "review");
        const sg: SafeguardState = {
          enabled: Boolean(data.safeguard?.enabled),
          amount: Number(data.safeguard?.amount) || DEFAULT_SAFEGUARD_AMOUNT,
        };
        setSafeguard(sg);
        setSavedSafeguard(sg);
        const g = (data.groups ?? {}) as GroupOverrides;
        setGroups(g);
        setSavedGroups(g);
        // Open the section when the merchant already has overrides; a merchant
        // who has never touched it sees today's page verbatim.
        setGroupsOpen(Object.keys(g).length > 0);
        setRulesAllowed(data.rulesAccess?.allowed !== false);
      }

      if (rulesRes.ok) {
        const allRules = await rulesRes.json();
        const arr = (Array.isArray(allRules) ? allRules : []) as CustomRule[];
        // Setup-owned rules are rendered by the cards above, never in the
        // custom list.
        setCustomRules(arr.filter((r) => !isSetupOwnedRuleName(r.name)));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // ─── Persistence ──────────────────────────────────────────────────────

  const persist = useCallback(
    async (next: {
      mode: StoreAutomationMode;
      safeguard: SafeguardState;
      groups: GroupOverrides;
    }) => {
      setSaving(true);
      setErrorMsg(null);
      try {
        const res = await fetch("/api/automation/store", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: next.mode,
            safeguard: {
              enabled: next.safeguard.enabled,
              amount: next.safeguard.amount,
            },
            // This page renders the group controls, so it always sends the
            // full set — the route reads an explicit `groups` as a replace.
            groups: next.groups,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setErrorMsg(body?.upgrade_required ? "planGateSaveError" : "starterRulesError");
          return false;
        }
        setSavedSafeguard(next.safeguard);
        setSavedGroups(next.groups);
        setSavedBanner(true);
        return true;
      } catch {
        setErrorMsg("starterRulesError");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  /**
   * The switch writes immediately — a single binary choice with no other
   * pending state doesn't warrant a Save button. Optimistic, reverted on
   * failure so the UI never claims a mode the server didn't accept.
   */
  const onModeChange = useCallback(
    async (next: StoreAutomationMode) => {
      if (next === mode || saving) return;
      const previous = mode;
      setMode(next);
      // `savedSafeguard` / `savedGroups`, NOT `safeguard` / `groups`. A PUT
      // carries the whole config, so passing the on-screen values would
      // silently commit unsaved edits from the other controls on a switch
      // click. The easiest thing on this page to get wrong.
      const ok = await persist({
        mode: next,
        safeguard: savedSafeguard,
        groups: savedGroups,
      });
      if (!ok) setMode(previous);
    },
    [mode, saving, persist, savedSafeguard, savedGroups],
  );

  /** The safeguard has a free-text amount, so it keeps an explicit Save. */
  const saveSafeguard = useCallback(async () => {
    await persist({ mode, safeguard, groups: savedGroups });
  }, [persist, mode, safeguard, savedGroups]);

  /**
   * A group is a discrete choice like the switch, so it writes immediately —
   * no Save button. Optimistic, reverted on failure so the UI never claims an
   * override the server didn't accept.
   */
  const onGroupsChange = useCallback(
    async (next: GroupOverrides) => {
      if (saving) return;
      const previous = groups;
      setGroups(next);
      const ok = await persist({ mode, safeguard: savedSafeguard, groups: next });
      if (!ok) setGroups(previous);
    },
    [saving, groups, persist, mode, savedSafeguard],
  );

  const customisedCount = Object.keys(groups).length;

  const safeguardDirty =
    safeguard.enabled !== savedSafeguard.enabled ||
    (safeguard.enabled && safeguard.amount !== savedSafeguard.amount);

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

  const openNewCustomRule = () => {
    setCustomRuleDraft(null);
    setCustomRuleModalOpen(true);
  };

  const openEditCustomRule = (rule: CustomRule) => {
    setCustomRuleDraft({
      id: rule.id,
      name: rule.name,
      match: {
        reason: rule.match?.reason,
        amount_range: rule.match?.amount_range,
      },
      action: {
        mode:
          rule.action?.mode === "auto" || rule.action?.mode === "auto_pack"
            ? "auto"
            : "review",
      },
      enabled: rule.enabled,
      priority: rule.priority,
    });
    setCustomRuleModalOpen(true);
  };

  // Newly created rules sort below the catch-all (priority 100000) so the
  // store-wide switch and the safeguard continue to win first.
  const nextRulePriority =
    customRules.reduce((m, r) => Math.max(m, r.priority), 100000) + 1;

  return (
    <Page
      title={tn("automation")}
      subtitle={tr("purposeLine")}
      primaryAction={{
        content: tr("primaryAddCustom"),
        onAction: openNewCustomRule,
        disabled: !rulesAllowed,
      }}
      secondaryActions={[
        {
          content: tr("browsePlaybooks"),
          onAction: () => setPlaybooksOpen(true),
          disabled: !shopId,
        },
      ]}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {savedBanner && (
              <Banner tone="success" onDismiss={() => setSavedBanner(false)}>
                <p>{tr("modeSaved")}</p>
              </Banner>
            )}
            {errorMsg && (
              <Banner tone="critical" onDismiss={() => setErrorMsg(null)}>
                <p>{tr(errorMsg)}</p>
              </Banner>
            )}

            {/* ── Plan gate — rules writes would 403, say so up front ── */}
            {!rulesAllowed && (
              <Banner
                tone="warning"
                title={tr("planGateTitle")}
                action={{
                  content: tr("upgradePlan"),
                  url: withShopParams(
                    "/app/billing",
                    searchParams ?? new URLSearchParams(),
                  ),
                }}
              >
                <p>{tr("planGateBody")}</p>
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
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "#202223",
                      marginBottom: 8,
                    }}
                  >
                    {tr("explainerTitle")}
                  </div>
                  <ul
                    style={{
                      listStyle: "disc",
                      margin: 0,
                      paddingLeft: 18,
                      color: "#202223",
                      fontSize: 14,
                      lineHeight: 1.5,
                    }}
                  >
                    <li style={{ marginBottom: 6 }}>{tr("explainerBullet1")}</li>
                    <li style={{ marginBottom: 6 }}>{tr("explainerBullet2")}</li>
                    <li>{tr("explainerBullet3")}</li>
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={dismissExplainer}
                  aria-label={tCommon("dismiss")}
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

            {/* ── The store-wide switch ──────────────────────────── */}
            <Card>
              <BlockStack gap="300">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    {tr("modeSectionTitle")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {tr("modeSectionSubtitle")}
                  </Text>
                </BlockStack>
                <StoreModeSelector
                  value={mode}
                  onChange={onModeChange}
                  t={tr}
                  disabled={!rulesAllowed || saving}
                />

                {/* ── Per-type overrides, as progressive disclosure ──────
                    Closed when nothing is overridden, so a merchant who never
                    opens it sees the page exactly as it was. */}
                <div style={{ borderTop: "1px solid #E1E3E5", paddingTop: 16 }}>
                  <button
                    type="button"
                    onClick={() => setGroupsOpen((open) => !open)}
                    aria-expanded={groupsOpen}
                    aria-controls="automation-groups"
                    style={{
                      width: "100%",
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <InlineStack align="space-between" blockAlign="center" gap="200">
                      <BlockStack gap="050">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="h3" variant="headingSm">
                            {tr("groupsSectionTitle")}
                          </Text>
                          {/* Hidden entirely at 0 — a "0 customised" badge is
                              noise on a page most merchants never customise. */}
                          {customisedCount > 0 && (
                            <Badge tone="info">
                              {tr("groupsCustomisedBadge", { count: customisedCount })}
                            </Badge>
                          )}
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {tr("groupsSectionSubtitle")}
                        </Text>
                      </BlockStack>
                      <Icon source={groupsOpen ? ChevronUpIcon : ChevronDownIcon} />
                    </InlineStack>
                  </button>

                  <Collapsible
                    open={groupsOpen}
                    id="automation-groups"
                    transition={{ duration: "150ms", timingFunction: "ease-in-out" }}
                  >
                    <div style={{ paddingTop: 16 }}>
                      <AutomationGroupList
                        storeMode={mode}
                        value={groups}
                        onChange={onGroupsChange}
                        t={tr}
                        disabled={!rulesAllowed || saving}
                      />
                    </div>
                  </Collapsible>
                </div>
              </BlockStack>
            </Card>

            {/* ── Safeguards ─────────────────────────────────────── */}
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    {tr("safeguardTitle")}
                  </Text>
                  <Checkbox
                    label={tr("safeguardToggle")}
                    checked={safeguard.enabled}
                    disabled={!rulesAllowed}
                    onChange={(checked) =>
                      setSafeguard((prev) => ({ ...prev, enabled: checked }))
                    }
                  />
                  {safeguard.enabled && (
                    <div style={{ maxWidth: 200 }}>
                      <TextField
                        label={tr("safeguardAmountLabel")}
                        type="number"
                        disabled={!rulesAllowed}
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
                        disabled={saving || !rulesAllowed}
                        onClick={saveSafeguard}
                      >
                        {tr("saveStarterRules")}
                      </Button>
                    </InlineStack>
                  )}
                </BlockStack>

                <div style={{ borderTop: "1px solid #E1E3E5", paddingTop: 16 }}>
                  <AlwaysReviewedFacts t={tr} />
                </div>
              </BlockStack>
            </Card>

            {/* ── Custom advanced rules ──────────────────────────── */}
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

                {customRules.length === 0 ? (
                  <BlockStack gap="300">
                    <Text as="p" variant="bodySm" tone="subdued">
                      {tr("customRulesEmpty")}
                    </Text>
                    <InlineStack>
                      <Button onClick={openNewCustomRule} disabled={!rulesAllowed}>
                        {tr("customRulesEmptyCta")}
                      </Button>
                    </InlineStack>
                  </BlockStack>
                ) : (
                  <BlockStack gap="0">
                    {customRules.map((rule, idx) => {
                      const normalizedMode =
                        rule.action?.mode === "auto" ||
                        rule.action?.mode === "auto_pack"
                          ? "auto"
                          : "review";
                      const actionLabel =
                        normalizedMode === "auto" ? tr("autoPack") : tr("review");
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
                            <Button onClick={() => openEditCustomRule(rule)}>
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
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      {shopId && playbooksOpen && (
        <TemplateLibraryModal
          isOpen
          onClose={() => setPlaybooksOpen(false)}
          shopId={shopId}
          locale={locale}
          onInstalled={() => {
            setPlaybooksOpen(false);
            fetchAll();
          }}
          initialCategory=""
        />
      )}
      <CustomRuleModal
        open={customRuleModalOpen}
        shopId={shopId}
        initial={customRuleDraft}
        defaultPriority={nextRulePriority}
        tr={tr}
        tCommon={tCommon}
        onClose={() => setCustomRuleModalOpen(false)}
        onSaved={() => {
          setCustomRuleModalOpen(false);
          fetchAll();
        }}
      />
    </Page>
  );
}
