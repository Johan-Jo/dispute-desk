/**
 * Embedded automation rules page.
 *
 * Per-family routing view backed by the canonical pack-based automation
 * system. One row per dispute family from DISPUTE_FAMILIES; each row's
 * Select edits the modes of all packs belonging to that family. Saves go
 * through POST /api/setup/automation (pack_modes branch), the same
 * pipeline the setup wizard uses, so coverage and rules always agree.
 *
 * Also includes:
 * - Safeguards section: high-value review threshold (standalone rule with
 *   __dd_safeguard__: prefix, survives pack-based saves)
 * - Suggested configurations: quick-action buttons that bulk-set pack modes
 * - Custom rules: read-only list of user-created rules from /portal/rules
 */
"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
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
  Select,
  Divider,
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
} from "@shopify/polaris-icons";
import { withShopParams } from "@/lib/withShopParams";
import { DISPUTE_FAMILIES } from "@/lib/coverage/deriveCoverage";
import {
  disputeTypeToPrimaryReason,
  type PackHandlingUiMode,
} from "@/lib/rules/packHandlingAutomation";

// ─── Constants ──────────────────────────────────────────────────────────

const SAFEGUARD_RULE_NAME = "__dd_safeguard__:high_value";
const DEFAULT_SAFEGUARD_AMOUNT = 500;

const FAMILY_ICONS: Record<string, typeof ShieldPersonIcon> = {
  fraud: ShieldPersonIcon,
  pnr: DeliveryIcon,
  not_as_described: AlertTriangleIcon,
  subscription: OrderIcon,
  refund: ReceiptRefundIcon,
  duplicate: DuplicateIcon,
  general: ClipboardCheckFilledIcon,
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
    mode: "auto_pack" | "review" | "manual";
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const tr = useTranslations("rules");
  const tn = useTranslations("nav");
  const tc = useTranslations("coverage");

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
  const familyRowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // ─── Data fetching ────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [automationRes, rulesRes] = await Promise.all([
        fetch("/api/setup/automation"),
        fetch("/api/rules"),
      ]);

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

        // Find safeguard rule
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

        // Custom rules = everything that isn't setup/safeguard managed
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
          next[p.id] = mode === "auto" ? "auto" : "manual";
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
          next[p.id] = mode === "auto" ? "auto" : "manual";
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
      // Save pack modes
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

      // Save safeguard
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

  const stateSentence = (() => {
    if (summary.auto === 0 && summary.review === 0) return tr("stateNoSetup");
    if (summary.noPlaybook > 0)
      return tr("stateWithGaps", {
        manual: summary.noPlaybook,
        total: summary.total,
      });
    if (summary.review > 0)
      return tr("stateMostlyAuto", {
        automated: summary.auto,
        total: summary.total,
        review: summary.review,
      });
    return tr("stateAllAuto", { total: summary.total });
  })();

  const routingChoices = [
    { label: tr("autoPack"), value: "auto" as const },
    { label: tr("review"), value: "review" as const },
  ];

  return (
    <Page
      title={tn("automation")}
      subtitle={tr("purposeLine")}
      primaryAction={{ content: tr("primaryAddCustom"), url: "/portal/rules" }}
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

            {/* ── State sentence ─────────────────────────────────── */}
            <Card>
              <BlockStack gap="300">
                <Text as="p" variant="bodyLg" fontWeight="semibold">
                  {stateSentence}
                </Text>
                <InlineStack gap="200" wrap>
                  {summary.auto > 0 && (
                    <Badge tone="success">
                      {`${summary.auto} ${tc("modeAutomated")}`}
                    </Badge>
                  )}
                  {summary.review > 0 && (
                    <Badge tone="info">
                      {`${summary.review} ${tc("modeReviewFirst")}`}
                    </Badge>
                  )}
                  {summary.noPlaybook > 0 && (
                    <Badge tone="attention">
                      {`${summary.noPlaybook} ${tr("notConfigured")}`}
                    </Badge>
                  )}
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {tr("phaseBlindNote")}
                </Text>
              </BlockStack>
            </Card>

            {/* ── Per-family rows ────────────────────────────────── */}
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    {tr("automationRulesTitle")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {tr("automationRulesSubtitle")}
                  </Text>
                </BlockStack>

                <BlockStack gap="0">
                  {DISPUTE_FAMILIES.map((family, index) => {
                    const FamilyIcon =
                      FAMILY_ICONS[family.id] ?? ClipboardCheckFilledIcon;
                    const mode = familyModes[family.id];
                    const packs = familyPacks[family.id] ?? [];
                    const isHighlighted = highlightedFamilyId === family.id;
                    const familyLabel = tc(
                      family.labelKey.replace("coverage.", ""),
                    );
                    const iconBg =
                      mode === "auto"
                        ? "#DCFCE7"
                        : mode === "review"
                          ? "#DBEAFE"
                          : "#FEE2E2";
                    const iconColor =
                      mode === "auto"
                        ? "#16A34A"
                        : mode === "review"
                          ? "#2563EB"
                          : "#DC2626";

                    return (
                      <div
                        key={family.id}
                        ref={(el) => {
                          familyRowRefs.current[family.id] = el;
                        }}
                      >
                        {index > 0 && <Divider />}
                        <div
                          style={{
                            padding: "16px 0",
                            transition: "background-color 400ms ease",
                            backgroundColor: isHighlighted
                              ? "#FEF3C7"
                              : "transparent",
                            borderRadius: 8,
                          }}
                        >
                          <BlockStack gap="200">
                            <InlineStack
                              align="space-between"
                              blockAlign="center"
                              wrap={false}
                              gap="300"
                            >
                              <InlineStack
                                gap="300"
                                blockAlign="center"
                                wrap
                              >
                                <div
                                  style={{
                                    width: 32,
                                    height: 32,
                                    borderRadius: 8,
                                    background: iconBg,
                                    color: iconColor,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                  }}
                                >
                                  <Icon source={FamilyIcon} />
                                </div>
                                <Text
                                  as="h3"
                                  variant="bodyMd"
                                  fontWeight="semibold"
                                >
                                  {familyLabel}
                                </Text>
                                {mode === "none" && (
                                  <Badge tone="attention">
                                    {tr("noPlaybookBadge")}
                                  </Badge>
                                )}
                              </InlineStack>
                              {mode === "none" ? (
                                <Button
                                  size="slim"
                                  url={withShopParams(
                                    "/app/packs",
                                    searchParams,
                                  )}
                                >
                                  {tc("installPlaybook")}
                                </Button>
                              ) : (
                                <div style={{ minWidth: 180, flexShrink: 0 }}>
                                  <Select
                                    label={tr("actionRouting")}
                                    labelHidden
                                    options={routingChoices}
                                    value={mode}
                                    onChange={(value) =>
                                      setFamilyMode(
                                        family.id,
                                        value as "auto" | "review",
                                      )
                                    }
                                  />
                                </div>
                              )}
                            </InlineStack>
                            {packs.length > 0 && (
                              <Text as="p" variant="bodySm" tone="subdued">
                                {tr("playbooksInUse", {
                                  names: packs.map((p) => p.name).join(", "),
                                })}
                              </Text>
                            )}
                          </BlockStack>
                        </div>
                      </div>
                    );
                  })}
                </BlockStack>

                {/* Quick actions */}
                <Divider />
                <InlineStack gap="200" wrap>
                  <Button size="slim" onClick={() => applyQuickConfig("auto")}>
                    {tr("quickAutoAll")}
                  </Button>
                  <Button
                    size="slim"
                    onClick={() => applyQuickConfig("review")}
                  >
                    {tr("quickReviewAll")}
                  </Button>
                </InlineStack>

                <InlineStack
                  align="space-between"
                  blockAlign="center"
                  wrap
                  gap="200"
                >
                  <Text as="p" variant="bodySm" tone="subdued">
                    {tr("firstMatchWinsHint")}
                  </Text>
                  <Button
                    variant="primary"
                    loading={saving}
                    disabled={saving || !dirty}
                    onClick={save}
                  >
                    {tr("saveStarterRules")}
                  </Button>
                </InlineStack>
              </BlockStack>
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
                      const actionLabel =
                        rule.action?.mode === "auto_pack"
                          ? tr("autoPack")
                          : rule.action?.mode === "manual"
                            ? tr("manual")
                            : tr("review");
                      return (
                        <div key={rule.id}>
                          {idx > 0 && <Divider />}
                          <div style={{ padding: "12px 0" }}>
                            <InlineStack
                              align="space-between"
                              blockAlign="center"
                              wrap={false}
                              gap="300"
                            >
                              <InlineStack
                                gap="300"
                                blockAlign="center"
                                wrap
                              >
                                <Text
                                  as="h3"
                                  variant="bodyMd"
                                  fontWeight="semibold"
                                >
                                  {rule.name ?? tr("unnamedRule")}
                                </Text>
                                <Badge
                                  tone={rule.enabled ? "success" : undefined}
                                >
                                  {rule.enabled ? tr("active") : tr("inactive")}
                                </Badge>
                              </InlineStack>
                              <Button
                                onClick={() => router.push("/portal/rules")}
                              >
                                {tr("editRule")}
                              </Button>
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {`${tr("action")}: ${actionLabel}`}
                            </Text>
                          </div>
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
    </Page>
  );
}
