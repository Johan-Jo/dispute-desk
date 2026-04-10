/**
 * Lifecycle-aware automation policy page.
 *
 * Restructured from raw rules to policy sections:
 * 1. Policy overview (inquiry/chargeback posture)
 * 2. Default templates by phase (from reason_template_mappings)
 * 3. Starter rules workflow (existing, reframed)
 * 4. Custom rules (secondary)
 *
 * Rules remain phase-blind — both phases show same automation mode.
 * Lifecycle differentiation comes from reason_template_mappings.
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
  Divider,
} from "@shopify/polaris";

import { RULE_PRESETS } from "@/lib/rules/presets";
import { EmbeddedStarterRulesWorkflow } from "@/components/rules/EmbeddedStarterRulesWorkflow";
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

export default function EmbeddedRulesPage() {
  const router = useRouter();
  const tr = useTranslations("rules");
  const tn = useTranslations("nav");
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [activatedPacks, setActivatedPacks] = useState<{ id: string; name: string }[]>([]);
  const [reasonMappings, setReasonMappings] = useState<ReasonMapping[]>([]);
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
      const [rulesRes, packsRes, mappingsRes] = await Promise.all([
        fetch("/api/rules"),
        fetch("/api/packs?status=ACTIVE"),
        fetch("/api/reason-mappings"),
      ]);
      if (rulesRes.ok) {
        const data = await rulesRes.json();
        setRules(Array.isArray(data) ? data : []);
      }
      if (packsRes.ok) {
        const body = (await packsRes.json()) as { packs?: { id: string; name: string }[] };
        setActivatedPacks(
          (body.packs ?? []).map((p) => ({ id: p.id, name: p.name }))
        );
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

  // Compute policy overview counts
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

  // Group reason mappings by family for the template defaults table
  const templateDefaults = useMemo(() => {
    return DISPUTE_FAMILIES.map((family) => {
      const inquiryMapping = reasonMappings.find(
        (m) =>
          m.dispute_phase === "inquiry" &&
          m.is_active &&
          family.reasons.includes(m.reason_code) &&
          m.template_id != null,
      );
      const chargebackMapping = reasonMappings.find(
        (m) =>
          m.dispute_phase === "chargeback" &&
          m.is_active &&
          family.reasons.includes(m.reason_code) &&
          m.template_id != null,
      );
      return {
        familyId: family.id,
        labelKey: family.labelKey,
        inquiryTemplate: inquiryMapping?.template_name ?? null,
        chargebackTemplate: chargebackMapping?.template_name ?? null,
      };
    });
  }, [reasonMappings]);

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

  const tc = useTranslations("coverage");

  return (
    <Page
      title={tn("automation")}
      subtitle={tr("policySubtitle")}
      primaryAction={{
        content: tr("addRule"),
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

              {/* Policy Overview */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">{tr("policyOverview")}</Text>
                  <InlineStack gap="300" wrap>
                    <Badge tone="success">{`${policySummary.automated} ${tc("modeAutomated")}`}</Badge>
                    <Badge tone="info">{`${policySummary.reviewFirst} ${tc("modeReviewFirst")}`}</Badge>
                    <Badge>{`${policySummary.manual} ${tc("modeManual")}`}</Badge>
                  </InlineStack>
                  <Banner tone="info">
                    <p>{tr("phaseBlindNote")}</p>
                  </Banner>
                </BlockStack>
              </Card>

              {/* Default Templates by Phase */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">{tr("defaultTemplates")}</Text>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: "2px solid var(--p-color-border)" }}>
                          <th style={{ textAlign: "left", padding: "8px 12px", fontSize: "12px", fontWeight: 600, color: "#6D7175" }}>
                            {tc("title")}
                          </th>
                          <th style={{ textAlign: "left", padding: "8px 12px", fontSize: "12px", fontWeight: 600, color: "#6D7175" }}>
                            {tr("inquiryTemplate")}
                          </th>
                          <th style={{ textAlign: "left", padding: "8px 12px", fontSize: "12px", fontWeight: 600, color: "#6D7175" }}>
                            {tr("chargebackTemplate")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {templateDefaults.map((row) => (
                          <tr key={row.familyId} style={{ borderBottom: "1px solid var(--p-color-border-subdued)" }}>
                            <td style={{ padding: "10px 12px" }}>
                              <Text as="span" variant="bodySm" fontWeight="semibold">
                                {tc(row.labelKey.replace("coverage.", ""))}
                              </Text>
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              {row.inquiryTemplate ? (
                                <Text as="span" variant="bodySm">{row.inquiryTemplate}</Text>
                              ) : (
                                <Text as="span" variant="bodySm" tone="subdued">{tr("noTemplateConfigured")}</Text>
                              )}
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              {row.chargebackTemplate ? (
                                <Text as="span" variant="bodySm">{row.chargebackTemplate}</Text>
                              ) : (
                                <Text as="span" variant="bodySm" tone="subdued">{tr("noTemplateConfigured")}</Text>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </BlockStack>
              </Card>

              {/* Starter Rules Workflow */}
              <Card>
                <EmbeddedStarterRulesWorkflow
                  tr={tr}
                  starterModes={starterModes}
                  onStarterModeChange={(presetId, mode) =>
                    setStarterModes((prev) => ({ ...prev, [presetId]: mode }))
                  }
                  activatedPacks={activatedPacks}
                  primaryFooter={
                    <Button
                      variant="primary"
                      loading={savingStarters}
                      disabled={savingStarters}
                      onClick={saveStarterRules}
                    >
                      {tr("saveStarterRules")}
                    </Button>
                  }
                />
              </Card>

              {/* Custom Rules */}
              {customRules.length > 0 && (
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    {tr("customRulesTitle")}
                  </Text>
                  {customRules
                    .sort((a, b) => a.priority - b.priority)
                    .map((rule, index) => (
                      <Card key={rule.id}>
                        <InlineStack gap="400" blockAlign="start" wrap={false}>
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              background: "linear-gradient(135deg, #1D4ED8, #3B82F6)",
                              borderRadius: 8,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "white",
                              fontWeight: 700,
                              fontSize: 14,
                              flexShrink: 0,
                            }}
                          >
                            {index + 1}
                          </div>

                          <BlockStack gap="200" as="div" inlineAlign="start">
                            <InlineStack align="space-between" blockAlign="center" wrap>
                              <BlockStack gap="100">
                                <Text as="h3" variant="bodyMd" fontWeight="semibold">
                                  {rule.name ?? tr("unnamedRule")}
                                </Text>
                                <Badge tone={rule.enabled ? "success" : "warning"}>
                                  {rule.enabled ? tr("active") : tr("inactive")}
                                </Badge>
                              </BlockStack>
                              <Button
                                variant="plain"
                                onClick={() => router.push("/portal/rules")}
                              >
                                ›
                              </Button>
                            </InlineStack>

                            <BlockStack gap="100">
                              <InlineStack gap="200" blockAlign="start">
                                <Text as="span" variant="bodySm" fontWeight="medium" tone="subdued">
                                  {tr("triggerCondition")}:
                                </Text>
                                <Text as="span" variant="bodySm">
                                  {matchSummary(rule.match)}
                                </Text>
                              </InlineStack>
                              <InlineStack gap="200" blockAlign="start">
                                <Text as="span" variant="bodySm" fontWeight="medium" tone="subdued">
                                  {tr("action")}:
                                </Text>
                                <Text as="span" variant="bodySm">
                                  {rule.action?.mode === "auto_pack"
                                    ? tr("autoPack")
                                    : rule.action?.mode === "manual"
                                      ? tr("manual")
                                      : tr("review")}
                                </Text>
                              </InlineStack>
                            </BlockStack>
                          </BlockStack>
                        </InlineStack>
                      </Card>
                    ))}
                </BlockStack>
              )}
            </BlockStack>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
