/**
 * Embedded automation rules page.
 *
 * Single unified list: baseline preset rules and custom rules rendered
 * in one priority-ordered list. Baseline rows edit routing inline via a
 * Select; custom rows open /portal/rules for editing. First matching
 * rule wins.
 */
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
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
} from "@shopify/polaris";

import { RULE_PRESETS, type RulePreset } from "@/lib/rules/presets";
import { DISPUTE_FAMILIES } from "@/lib/coverage/deriveCoverage";

interface Rule {
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
    require_fields?: string[];
  };
  priority: number;
}

interface ReasonMapping {
  reason_code: string;
  dispute_phase: "inquiry" | "chargeback";
  template_id: string | null;
  template_name: string | null;
  family: string;
  is_active: boolean;
}

const PRESET_NAMES = new Set(RULE_PRESETS.map((p) => p.name));

const REASON_KEYS: Record<string, string> = {
  PRODUCT_NOT_RECEIVED: "productNotReceived",
  PRODUCT_UNACCEPTABLE: "productUnacceptable",
  FRAUDULENT: "fraudulent",
  CREDIT_NOT_PROCESSED: "creditNotProcessed",
  SUBSCRIPTION_CANCELED: "subscriptionCanceled",
  DUPLICATE: "duplicate",
  GENERAL: "general",
};

function isSetupRuleName(name: string | null | undefined): boolean {
  return Boolean(name?.startsWith("__dd_setup__"));
}

function routingMode(rule: Rule): "auto_pack" | "review" {
  return rule.action?.mode === "auto_pack" ? "auto_pack" : "review";
}

type UnifiedRow =
  | {
      kind: "baseline";
      preset: RulePreset;
      existing: Rule | null;
      priority: number;
    }
  | { kind: "custom"; rule: Rule; priority: number };

export default function EmbeddedRulesPage() {
  const router = useRouter();
  const tr = useTranslations("rules");
  const tn = useTranslations("nav");
  const tc = useTranslations("coverage");
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [_reasonMappings, setReasonMappings] = useState<ReasonMapping[]>([]);
  const [starterModes, setStarterModes] = useState<Record<string, "auto_pack" | "review">>(() => {
    const init: Record<string, "auto_pack" | "review"> = {};
    for (const p of RULE_PRESETS) init[p.id] = p.action.mode;
    return init;
  });
  const [savingStarters, setSavingStarters] = useState(false);
  const [starterError, setStarterError] = useState<string | null>(null);
  const [starterSavedBanner, setStarterSavedBanner] = useState(false);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, mappingsRes] = await Promise.all([
        fetch("/api/rules"),
        fetch("/api/reason-mappings"),
      ]);
      if (rulesRes.ok) {
        const data = await rulesRes.json();
        setRules(Array.isArray(data) ? data : []);
      }
      if (mappingsRes.ok) {
        const body = await mappingsRes.json();
        setReasonMappings(body.mappings ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  useEffect(() => {
    setStarterModes((prev) => {
      const next = { ...prev };
      for (const preset of RULE_PRESETS) {
        const row = rules.find((r) => r.name === preset.name);
        if (row) next[preset.id] = routingMode(row);
      }
      return next;
    });
  }, [rules]);

  const customRules = useMemo(
    () =>
      rules.filter(
        (r) => r.name && !PRESET_NAMES.has(r.name) && !isSetupRuleName(r.name)
      ),
    [rules]
  );

  // Compute policy overview counts — still drives the state sentence.
  const policySummary = useMemo(() => {
    let automated = 0;
    let reviewFirst = 0;
    let manual = 0;
    for (const family of DISPUTE_FAMILIES) {
      const matchingRule = rules.find((r) => {
        if (!r.enabled) return false;
        if (!r.match.reason || r.match.reason.length === 0) return true;
        return family.reasons.some((reason) => r.match.reason!.includes(reason));
      });
      if (!matchingRule) { manual++; continue; }
      if (matchingRule.action.mode === "auto_pack") automated++;
      else if (matchingRule.action.mode === "review") reviewFirst++;
      else manual++;
    }
    return { automated, reviewFirst, manual };
  }, [rules]);

  // Unified, priority-ordered list of every rule the engine will consider.
  const unifiedRows: UnifiedRow[] = useMemo(() => {
    const baselineRows: UnifiedRow[] = RULE_PRESETS.map((preset) => {
      const existing = rules.find((r) => r.name === preset.name) ?? null;
      return {
        kind: "baseline" as const,
        preset,
        existing,
        priority: existing?.priority ?? preset.priority,
      };
    });
    const customRows: UnifiedRow[] = customRules.map((rule) => ({
      kind: "custom" as const,
      rule,
      priority: rule.priority,
    }));
    return [...baselineRows, ...customRows].sort(
      (a, b) => a.priority - b.priority,
    );
  }, [rules, customRules]);

  const saveStarterRules = useCallback(async () => {
    setSavingStarters(true);
    setStarterError(null);
    setStarterSavedBanner(false);
    try {
      for (const preset of RULE_PRESETS) {
        const mode = starterModes[preset.id] ?? preset.action.mode;
        const existing = rules.find((r) => r.name === preset.name);
        if (existing) {
          const res = await fetch(`/api/rules/${existing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: { mode } }),
          });
          if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(
              typeof errBody?.error === "string" ? errBody.error : "patch_failed"
            );
          }
        } else {
          const res = await fetch("/api/rules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: preset.name,
              match: preset.match,
              action: { mode },
              enabled: true,
              priority: preset.priority,
            }),
          });
          if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(
              typeof errBody?.error === "string" ? errBody.error : "post_failed"
            );
          }
        }
      }
      await fetchRules();
      setStarterSavedBanner(true);
    } catch {
      setStarterError("starterRulesError");
    } finally {
      setSavingStarters(false);
    }
  }, [starterModes, rules, fetchRules]);

  function matchSummary(match: Rule["match"]): string {
    const parts: string[] = [];
    if (match.reason?.length) {
      const translated = match.reason.map((r) =>
        REASON_KEYS[r] ? r.replace(/_/g, " ") : r
      );
      parts.push(`${tr("reason")}: ${translated.join(", ")}`);
    }
    if (match.status?.length) parts.push(`${tr("statusLabel")}: ${match.status.join(", ")}`);
    if (match.amount_range) {
      const { min, max } = match.amount_range;
      if (min != null && max != null) parts.push(`$${min}–$${max}`);
      else if (min != null) parts.push(`≥ $${min}`);
      else if (max != null) parts.push(`≤ $${max}`);
    }
    return parts.length ? parts.join(" · ") : tr("matchesAll");
  }

  void _reasonMappings; // keep fetch, may use later

  const totalFamilies = DISPUTE_FAMILIES.length;

  // Plain-language state sentence — priority ordered
  const stateSentence = (() => {
    if (policySummary.automated + policySummary.reviewFirst === 0)
      return tr("stateNoSetup");
    if (policySummary.manual > 0)
      return tr("stateWithGaps", {
        manual: policySummary.manual,
        total: totalFamilies,
      });
    if (policySummary.reviewFirst > 0)
      return tr("stateMostlyAuto", {
        automated: policySummary.automated,
        total: totalFamilies,
        review: policySummary.reviewFirst,
      });
    return tr("stateAllAuto", { total: totalFamilies });
  })();

  const routingChoices = [
    { label: tr("autoPack"), value: "auto_pack" as const },
    { label: tr("review"), value: "review" as const },
  ];

  function renderBaselineRow(row: Extract<UnifiedRow, { kind: "baseline" }>, index: number) {
    const mode = starterModes[row.preset.id] ?? row.preset.action.mode;
    const isSaved = row.existing !== null;
    return (
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center" wrap={false} gap="300">
          <InlineStack gap="300" blockAlign="center" wrap>
            <Text as="span" variant="bodySm" tone="subdued">
              {`${index + 1}.`}
            </Text>
            <Text as="h3" variant="bodyMd" fontWeight="semibold">
              {tr(row.preset.nameKey)}
            </Text>
            <Badge tone="info">{tr("baselineBadge")}</Badge>
            {!isSaved && (
              <Badge tone="attention">{tr("unsavedBadge")}</Badge>
            )}
          </InlineStack>
          <div style={{ minWidth: 180, flexShrink: 0 }}>
            <Select
              label={tr("actionRouting")}
              labelHidden
              options={routingChoices}
              value={mode}
              onChange={(value) =>
                setStarterModes((prev) => ({
                  ...prev,
                  [row.preset.id]: value as "auto_pack" | "review",
                }))
              }
            />
          </div>
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          {tr(row.preset.descriptionKey)}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {`${tr("triggerCondition")}: ${matchSummary(row.preset.match)}`}
        </Text>
      </BlockStack>
    );
  }

  function renderCustomRow(row: Extract<UnifiedRow, { kind: "custom" }>, index: number) {
    const actionLabel =
      row.rule.action?.mode === "auto_pack"
        ? tr("autoPack")
        : row.rule.action?.mode === "manual"
          ? tr("manual")
          : tr("review");
    return (
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center" wrap={false} gap="300">
          <InlineStack gap="300" blockAlign="center" wrap>
            <Text as="span" variant="bodySm" tone="subdued">
              {`${index + 1}.`}
            </Text>
            <Text as="h3" variant="bodyMd" fontWeight="semibold">
              {row.rule.name ?? tr("unnamedRule")}
            </Text>
            <Badge>{tr("customBadge")}</Badge>
            <Badge tone={row.rule.enabled ? "success" : undefined}>
              {row.rule.enabled ? tr("active") : tr("inactive")}
            </Badge>
          </InlineStack>
          <Button onClick={() => router.push("/portal/rules")}>
            {tr("editRule")}
          </Button>
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          {`${tr("triggerCondition")}: ${matchSummary(row.rule.match)}`}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {`${tr("action")}: ${actionLabel}`}
        </Text>
      </BlockStack>
    );
  }

  return (
    <Page
      title={tn("automation")}
      subtitle={tr("purposeLine")}
      primaryAction={{
        content: tr("primaryAddCustom"),
        url: "/portal/rules",
      }}
    >
      <Layout>
        <Layout.Section>
          {loading ? (
            <Card>
              <div style={{ padding: "2rem", textAlign: "center" }}>
                <Spinner size="large" />
              </div>
            </Card>
          ) : (
            <BlockStack gap="400">
              {starterSavedBanner && (
                <Banner tone="success" onDismiss={() => setStarterSavedBanner(false)}>
                  <p>{tr("starterRulesSaved")}</p>
                </Banner>
              )}
              {starterError && (
                <Banner tone="critical" onDismiss={() => setStarterError(null)}>
                  <p>{tr(starterError)}</p>
                </Banner>
              )}

              {/* Current state — plain language */}
              <Card>
                <BlockStack gap="300">
                  <Text as="p" variant="bodyLg" fontWeight="semibold">
                    {stateSentence}
                  </Text>
                  <InlineStack gap="200" wrap>
                    {policySummary.automated > 0 && (
                      <Badge tone="success">{`${policySummary.automated} ${tc("modeAutomated")}`}</Badge>
                    )}
                    {policySummary.reviewFirst > 0 && (
                      <Badge tone="info">{`${policySummary.reviewFirst} ${tc("modeReviewFirst")}`}</Badge>
                    )}
                    {policySummary.manual > 0 && (
                      <Badge tone="attention">{`${policySummary.manual} ${tr("notConfigured")}`}</Badge>
                    )}
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {tr("phaseBlindNote")}
                  </Text>
                </BlockStack>
              </Card>

              {/* Unified rules list */}
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
                    {unifiedRows.map((row, index) => (
                      <div key={row.kind === "baseline" ? row.preset.id : row.rule.id}>
                        {index > 0 && <Divider />}
                        <div style={{ padding: "16px 0" }}>
                          {row.kind === "baseline"
                            ? renderBaselineRow(row, index)
                            : renderCustomRow(row, index)}
                        </div>
                      </div>
                    ))}
                  </BlockStack>

                  <InlineStack align="space-between" blockAlign="center" wrap gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      {tr("firstMatchWinsHint")}
                    </Text>
                    <InlineStack gap="200">
                      <Button onClick={() => router.push("/portal/rules")}>
                        {tr("primaryAddCustom")}
                      </Button>
                      <Button
                        variant="primary"
                        loading={savingStarters}
                        disabled={savingStarters}
                        onClick={saveStarterRules}
                      >
                        {tr("saveStarterRules")}
                      </Button>
                    </InlineStack>
                  </InlineStack>
                </BlockStack>
              </Card>
            </BlockStack>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
