/**
 * FIGMA SCREEN MAPPING (file key: 5o2yOdPqVmvwjaK8eTeUUx)
 * Route: app/(embedded)/app/settings/page.tsx
 * Figma Make source: src/app/pages/shopify/shopify-settings.tsx
 * Reference: Settings sections: Store Connection, Notifications (3 toggles),
 * Team Members (with Invite), Billing & Plan card, Security & Privacy.
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { withShopParams } from "@/lib/withShopParams";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  Button,
  BlockStack,
  InlineStack,
  Checkbox,
  Spinner,
  Divider,
  TextField,
  Banner,
} from "@shopify/polaris";
import { IntegrationsCard } from "@/components/settings/IntegrationsCard";

interface ShopInfo {
  shopDomain?: string;
  lastSyncedAt?: string | null;
  plan?: { name: string };
}

interface NotificationPrefs {
  newDispute: boolean;
  beforeDue: boolean;
  evidenceReady: boolean;
  monthlyDigest: boolean;
  /** Outcome-posted email — fires when Shopify reports the dispute
   *  closed (won / lost / accepted). Default-on, opt-out. Surfaced
   *  in Team settings as of 2026-05-20. */
  outcome: boolean;
}

interface AutomationSettings {
  auto_build_enabled: boolean;
  auto_save_enabled: boolean;
  auto_save_min_score: number;
  enforce_no_blockers: boolean;
}

type Involvement = "hands_off" | "stay_involved";
type SaveMode = "auto" | "review";

/** Bordered radio-option card (mockup `.opt` treatment). */
function OptionBox({
  selected,
  onClick,
  title,
  badge,
  desc,
  note,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  badge?: string;
  desc: string;
  note?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: "left",
        fontFamily: "inherit",
        background: selected ? "#F7FAFF" : "#ffffff",
        border: `1.5px solid ${selected ? "#005BD3" : "#E1E3E5"}`,
        boxShadow: selected ? "0 0 0 1px #005BD3" : "none",
        borderRadius: 12,
        padding: 16,
        cursor: "pointer",
        flex: 1,
        minWidth: 220,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: "50%",
            border: `2px solid ${selected ? "#005BD3" : "#C9CCCF"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
            marginTop: 1,
          }}
        >
          {selected ? (
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#005BD3" }} />
          ) : null}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#202223" }}>{title}</span>
            {badge ? (
              <span
                style={{
                  padding: "2px 9px",
                  borderRadius: 999,
                  fontSize: 11.5,
                  fontWeight: 600,
                  background: "#ECFDF5",
                  color: "#065F46",
                }}
              >
                {badge}
              </span>
            ) : null}
          </div>
          <p style={{ fontSize: 12.5, color: "#4B5563", margin: "4px 0 0", lineHeight: 1.5 }}>
            {desc}
          </p>
          {note ? (
            <p style={{ fontSize: 12, color: "#6D7175", margin: "10px 0 0", lineHeight: 1.5 }}>
              {note}
            </p>
          ) : null}
        </div>
      </div>
    </button>
  );
}

export default function EmbeddedSettingsPage() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const tn = useTranslations("nav");
  const searchParams = useSearchParams();
  const [shopInfo, setShopInfo] = useState<ShopInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const [teamEmail, setTeamEmail] = useState("");
  const [savedTeamEmail, setSavedTeamEmail] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [notifNewDispute, setNotifNewDispute] = useState(true);
  const [notifBeforeDue, setNotifBeforeDue] = useState(true);
  const [notifEvidenceReady, setNotifEvidenceReady] = useState(false);
  // Outcome-posted email — default ON (opt-out semantics matching the
  // helper at lib/email/sendOutcomePostedAlert.ts:206).
  const [notifOutcome, setNotifOutcome] = useState(true);
  // Monthly Chargeback Exposure digest. Default ON — opt-out only.
  const [notifMonthlyDigest, setNotifMonthlyDigest] = useState(true);

  const [automation, setAutomation] = useState<AutomationSettings>({
    auto_build_enabled: false,
    auto_save_enabled: false,
    auto_save_min_score: 80,
    enforce_no_blockers: true,
  });
  const [minScoreInput, setMinScoreInput] = useState("80");
  const [automationSaving, setAutomationSaving] = useState(false);
  const [automationSaved, setAutomationSaved] = useState(false);

  // ── Dispute handling (design-alignment plan §12S / §2.4) ──
  // Involvement is presentation-only (notification defaults + optional-
  // opportunity prominence) — it never changes objective classification.
  const [involvement, setInvolvement] = useState<Involvement>("hands_off");
  // Save mode binds to the per-rule action.mode across ALL pack types
  // (decision 3): "auto" only when every pack type resolves to auto.
  const [saveMode, setSaveMode] = useState<SaveMode | null>(null);
  const [saveModeMixed, setSaveModeMixed] = useState(false);
  const [saveModePackIds, setSaveModePackIds] = useState<string[]>([]);
  const [rulesAllowed, setRulesAllowed] = useState(true);
  const [handlingSaved, setHandlingSaved] = useState(false);

  const pickInvolvement = useCallback(async (v: Involvement) => {
    setInvolvement(v);
    setHandlingSaved(false);
    // Involvement drives the progress-notification defaults (plan
    // §12S): the server materializes evidenceReady + monthlyDigest to
    // match; mirror that locally so the toggles update immediately.
    const stayInvolved = v === "stay_involved";
    setNotifEvidenceReady(stayInvolved);
    setNotifMonthlyDigest(stayInvolved);
    await fetch("/api/shop/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ involvement: v }),
    });
    setHandlingSaved(true);
    setTimeout(() => setHandlingSaved(false), 2600);
  }, []);

  const pickSaveMode = useCallback(
    async (v: SaveMode) => {
      if (!rulesAllowed || saveModePackIds.length === 0) return;
      setSaveMode(v);
      setSaveModeMixed(false);
      setHandlingSaved(false);
      const pack_modes: Record<string, SaveMode> = {};
      for (const id of saveModePackIds) pack_modes[id] = v;
      const res = await fetch("/api/setup/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack_modes }),
      });
      if (res.ok) {
        setHandlingSaved(true);
        setTimeout(() => setHandlingSaved(false), 2600);
      }
    },
    [rulesAllowed, saveModePackIds],
  );

  const fetchInfo = useCallback(async () => {
    setLoading(true);
    try {
      const [usageRes, prefsRes, autoRes, modesRes] = await Promise.all([
        fetch("/api/billing/usage"),
        fetch("/api/shop/preferences"),
        fetch("/api/automation/settings"),
        fetch("/api/setup/automation"),
      ]);
      if (modesRes.ok) {
        const m = (await modesRes.json()) as {
          pack_modes?: Record<string, SaveMode>;
          rulesAccess?: { allowed: boolean };
        };
        const modes = Object.values(m.pack_modes ?? {});
        const ids = Object.keys(m.pack_modes ?? {});
        setSaveModePackIds(ids);
        setRulesAllowed(m.rulesAccess?.allowed !== false);
        if (modes.length > 0) {
          const allAuto = modes.every((v) => v === "auto");
          const allReview = modes.every((v) => v === "review");
          setSaveMode(allAuto ? "auto" : "review");
          setSaveModeMixed(!allAuto && !allReview);
        }
      }
      if (usageRes.ok) {
        const data = await usageRes.json();
        setShopInfo({
          shopDomain: data.shop_domain ?? undefined,
          plan: data.plan ? { name: data.plan.name ?? "Free" } : { name: "Free" },
        });
      }
      if (prefsRes.ok) {
        const prefs = await prefsRes.json();
        if (prefs.involvement === "stay_involved" || prefs.involvement === "hands_off") {
          setInvolvement(prefs.involvement);
        }
        const n = prefs.notifications as NotificationPrefs | undefined;
        if (n) {
          setNotifNewDispute(n.newDispute);
          setNotifBeforeDue(n.beforeDue);
          setNotifEvidenceReady(n.evidenceReady);
          // Default to ON when the field is missing entirely — opt-out
          // semantics. The cron also treats `undefined` as enabled, so
          // the UI default mirrors server behavior.
          setNotifMonthlyDigest(n.monthlyDigest ?? true);
          // Same opt-out semantics for the outcome email — the helper
          // sends unless explicitly `outcome === false`.
          setNotifOutcome(n.outcome ?? true);
        }
        if (prefs.teamEmail) {
          setTeamEmail(prefs.teamEmail);
          setSavedTeamEmail(prefs.teamEmail);
        }
      }
      if (autoRes.ok) {
        const a = await autoRes.json() as AutomationSettings;
        setAutomation(a);
        setMinScoreInput(String(a.auto_save_min_score));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const saveAutomation = useCallback(async () => {
    const score = Math.min(100, Math.max(0, parseInt(minScoreInput, 10) || 0));
    setAutomationSaving(true);
    await fetch("/api/automation/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auto_build_enabled: automation.auto_build_enabled,
        auto_save_enabled: automation.auto_save_enabled,
        auto_save_min_score: score,
        enforce_no_blockers: automation.enforce_no_blockers,
      }),
    });
    setAutomationSaving(false);
    setAutomationSaved(true);
    setTimeout(() => setAutomationSaved(false), 3000);
  }, [automation, minScoreInput]);

  const persistNotification = useCallback(
    async (key: keyof NotificationPrefs, value: boolean) => {
      await fetch("/api/shop/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifications: { [key]: value } }),
      });
    },
    []
  );

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

  return (
    <Page
      title={tn("settings")}
      subtitle={t("subtitle")}
    >
      <Layout>
        {/* Store Connection */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="300" blockAlign="center">
                <div
                  style={{
                    width: 32,
                    height: 32,
                    background: "#E0F2FE",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                  }}
                >
                  🔗
                </div>
                <Text as="h2" variant="headingMd">{t("storeConnection")}</Text>
              </InlineStack>
              <Divider />
              {loading ? (
                <Spinner size="small" />
              ) : (
                <InlineStack gap="300" blockAlign="center">
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      background: "#96BF48",
                      borderRadius: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "white",
                      fontWeight: 700,
                      fontSize: 16,
                    }}
                  >
                    S
                  </div>
                  <BlockStack gap="100">
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {shopInfo?.shopDomain ?? tc("notAvailable")}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {t("connectedViaOAuth")}
                    </Text>
                    <InlineStack gap="200">
                      <Badge tone="success">{t("active")}</Badge>
                    </InlineStack>
                  </BlockStack>
                </InlineStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Integrations — Gorgias connection status + connect / test /
            disconnect. First-class home outside the setup wizard so
            reconnect-required states are self-serviceable. */}
        <Layout.Section>
          <IntegrationsCard />
        </Layout.Section>

        {/* Dispute handling — involvement + save-to-Shopify mode
            (design-alignment plan §2.4/§12S; Settings.html mockup).
            Involvement is presentation-only; the save radio drives the
            per-rule auto/review mode across all pack types. */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">{t("disputeHandling.title")}</Text>
                <Text as="p" variant="bodySm" tone="subdued">{t("disputeHandling.help")}</Text>
              </BlockStack>
              <Divider />
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">{t("disputeHandling.involvementTitle")}</Text>
                <Text as="p" variant="bodySm" tone="subdued">{t("disputeHandling.involvementDesc")}</Text>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <OptionBox
                    selected={involvement === "hands_off"}
                    onClick={() => pickInvolvement("hands_off")}
                    title={t("disputeHandling.handsOffTitle")}
                    badge={t("disputeHandling.recommendedBadge")}
                    desc={t("disputeHandling.handsOffDesc")}
                  />
                  <OptionBox
                    selected={involvement === "stay_involved"}
                    onClick={() => pickInvolvement("stay_involved")}
                    title={t("disputeHandling.stayTitle")}
                    desc={t("disputeHandling.stayDesc")}
                  />
                </div>
                <Text as="p" variant="bodySm" tone="subdued">{t("disputeHandling.involvementNote")}</Text>
              </BlockStack>
              <Divider />
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">{t("disputeHandling.savingTitle")}</Text>
                <Text as="p" variant="bodySm" tone="subdued">{t("disputeHandling.savingDesc")}</Text>
                {!rulesAllowed ? (
                  <Banner tone="info">{t("disputeHandling.upgradeNote")}</Banner>
                ) : null}
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", opacity: rulesAllowed ? 1 : 0.5 }}>
                  <OptionBox
                    selected={saveMode === "auto" && !saveModeMixed}
                    onClick={() => pickSaveMode("auto")}
                    title={t("disputeHandling.autoTitle")}
                    badge={t("disputeHandling.recommendedBadge")}
                    desc={t("disputeHandling.autoDesc")}
                    note={t("disputeHandling.autoNote")}
                  />
                  <OptionBox
                    selected={saveMode === "review" && !saveModeMixed}
                    onClick={() => pickSaveMode("review")}
                    title={t("disputeHandling.approveTitle")}
                    desc={t("disputeHandling.approveDesc")}
                  />
                </div>
                {saveModeMixed ? (
                  <Text as="p" variant="bodySm" tone="subdued">{t("disputeHandling.mixedNote")}</Text>
                ) : null}
                {handlingSaved ? (
                  <Text as="p" variant="bodySm" tone="success">{t("disputeHandling.saved")}</Text>
                ) : null}
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Notifications — before automation (daily relevance) */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="300" blockAlign="center">
                <div
                  style={{
                    width: 32,
                    height: 32,
                    background: "#DCFCE7",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                  }}
                >
                  🔔
                </div>
                <Text as="h2" variant="headingMd">{t("notifications")}</Text>
              </InlineStack>
              <Divider />
              <BlockStack gap="300">
                <div style={{ padding: "12px", border: "1px solid var(--p-color-border)", borderRadius: 8 }}>
                  <BlockStack gap="200">
                    <Text as="span" variant="bodyMd" fontWeight="medium">{t("teamEmailLabel")}</Text>
                    <Text as="span" variant="bodySm" tone="subdued">{t("teamEmailDesc")}</Text>
                    <InlineStack gap="200" blockAlign="end">
                      <div style={{ flex: 1 }}>
                        <TextField
                          label=""
                          labelHidden
                          type="email"
                          value={teamEmail}
                          onChange={setTeamEmail}
                          placeholder="team@yourstore.com"
                          autoComplete="email"
                        />
                      </div>
                      {teamEmail !== savedTeamEmail && (
                        <Button
                          size="slim"
                          loading={emailSaving}
                          onClick={async () => {
                            setEmailSaving(true);
                            setEmailError(false);
                            try {
                              const res = await fetch("/api/shop/preferences", {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ teamEmail }),
                              });
                              if (res.ok) {
                                setSavedTeamEmail(teamEmail);
                              } else {
                                setEmailError(true);
                                console.error("[settings] email save failed:", res.status, await res.text());
                              }
                            } catch (err) {
                              setEmailError(true);
                              console.error("[settings] email save error:", err);
                            } finally {
                              setEmailSaving(false);
                            }
                          }}
                        >
                          {tc("save")}
                        </Button>
                      )}
                    </InlineStack>
                    {emailError && (
                      <Banner tone="critical">{t("emailSaveError")}</Banner>
                    )}
                  </BlockStack>
                </div>
                <div style={{ padding: "12px", border: "1px solid var(--p-color-border)", borderRadius: 8 }}>
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <Text as="span" variant="bodyMd" fontWeight="medium">{t("notifNewDispute")}</Text>
                      <Text as="span" variant="bodySm" tone="subdued">{t("notifNewDisputeDesc")}</Text>
                    </BlockStack>
                    <Checkbox
                      label=""
                      checked={notifNewDispute}
                      onChange={(v) => { setNotifNewDispute(v); void persistNotification("newDispute", v); }}
                      labelHidden
                    />
                  </InlineStack>
                </div>
                <div style={{ padding: "12px", border: "1px solid var(--p-color-border)", borderRadius: 8 }}>
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <Text as="span" variant="bodyMd" fontWeight="medium">{t("notifOutcome")}</Text>
                      <Text as="span" variant="bodySm" tone="subdued">{t("notifOutcomeDesc")}</Text>
                    </BlockStack>
                    <Checkbox
                      label=""
                      checked={notifOutcome}
                      onChange={(v) => { setNotifOutcome(v); void persistNotification("outcome", v); }}
                      labelHidden
                    />
                  </InlineStack>
                </div>
                <div style={{ padding: "12px", border: "1px solid var(--p-color-border)", borderRadius: 8 }}>
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <Text as="span" variant="bodyMd" fontWeight="medium">{t("notifBeforeDue")}</Text>
                      <Text as="span" variant="bodySm" tone="subdued">{t("notifBeforeDueDesc")}</Text>
                    </BlockStack>
                    <Checkbox
                      label=""
                      checked={notifBeforeDue}
                      onChange={(v) => { setNotifBeforeDue(v); void persistNotification("beforeDue", v); }}
                      labelHidden
                    />
                  </InlineStack>
                </div>
                <div style={{ padding: "12px", border: "1px solid var(--p-color-border)", borderRadius: 8 }}>
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <Text as="span" variant="bodyMd" fontWeight="medium">{t("notifEvidenceReady")}</Text>
                      <Text as="span" variant="bodySm" tone="subdued">{t("notifEvidenceReadyDesc")}</Text>
                    </BlockStack>
                    <Checkbox
                      label=""
                      checked={notifEvidenceReady}
                      onChange={(v) => { setNotifEvidenceReady(v); void persistNotification("evidenceReady", v); }}
                      labelHidden
                    />
                  </InlineStack>
                </div>
                {/* Approval-required alert — locked ON while the save
                    mode requires approval (plan §12S / Settings.html):
                    a merchant in approve mode cannot silently miss the
                    approvals their own gate creates. Display-only when
                    locked; hidden in auto mode (no approvals exist). */}
                {saveMode === "review" ? (
                  <div style={{ padding: "12px", border: "1px solid var(--p-color-border)", borderRadius: 8 }}>
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="050">
                        <Text as="span" variant="bodyMd" fontWeight="medium">{t("notifApprovalRequired")}</Text>
                        <Text as="span" variant="bodySm" tone="subdued">{t("notifApprovalRequiredDesc")}</Text>
                        <Text as="span" variant="bodySm" tone="caution">{t("notifApprovalRequiredLock")}</Text>
                      </BlockStack>
                      <Checkbox label="" checked disabled labelHidden />
                    </InlineStack>
                  </div>
                ) : null}
                <div style={{ padding: "12px", border: "1px solid var(--p-color-border)", borderRadius: 8 }}>
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <Text as="span" variant="bodyMd" fontWeight="medium">{t("notifMonthlyDigest")}</Text>
                      <Text as="span" variant="bodySm" tone="subdued">{t("notifMonthlyDigestDesc")}</Text>
                    </BlockStack>
                    <Checkbox
                      label=""
                      checked={notifMonthlyDigest}
                      onChange={(v) => { setNotifMonthlyDigest(v); void persistNotification("monthlyDigest", v); }}
                      labelHidden
                    />
                  </InlineStack>
                </div>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Advanced Automation Defaults */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="300" blockAlign="center">
                <div
                  style={{
                    width: 32,
                    height: 32,
                    background: "#DBEAFE",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                  }}
                >
                  ⚡
                </div>
                <BlockStack gap="050">
                  <Text as="h2" variant="headingMd">{t("automationSection")}</Text>
                  <Text as="span" variant="bodySm" tone="subdued">{t("automationSectionHelp")}</Text>
                </BlockStack>
              </InlineStack>
              <Divider />
              {loading ? (
                <Spinner size="small" />
              ) : (
                <BlockStack gap="400">
                  {/* Auto Build */}
                  <div style={{ padding: "12px", border: "1px solid var(--p-color-border)", borderRadius: 8 }}>
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="050">
                        <Text as="span" variant="bodyMd" fontWeight="medium">{t("autoBuildLabel")}</Text>
                        <Text as="span" variant="bodySm" tone="subdued">{t("autoBuildDesc")}</Text>
                      </BlockStack>
                      <Checkbox
                        label=""
                        checked={automation.auto_build_enabled}
                        onChange={(v) => setAutomation((a) => ({ ...a, auto_build_enabled: v }))}
                        labelHidden
                      />
                    </InlineStack>
                  </div>

                  {/* Auto Save */}
                  <div style={{ padding: "12px", border: "1px solid var(--p-color-border)", borderRadius: 8 }}>
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="050">
                        <Text as="span" variant="bodyMd" fontWeight="medium">{t("autoSaveLabel")}</Text>
                        <Text as="span" variant="bodySm" tone="subdued">{t("autoSaveDesc")}</Text>
                      </BlockStack>
                      <Checkbox
                        label=""
                        checked={automation.auto_save_enabled}
                        onChange={(v) => setAutomation((a) => ({ ...a, auto_save_enabled: v }))}
                        labelHidden
                      />
                    </InlineStack>
                  </div>

                  {/* Min Score */}
                  <div style={{ padding: "12px", border: "1px solid var(--p-color-border)", borderRadius: 8 }}>
                    <InlineStack align="space-between" blockAlign="center" wrap={false}>
                      <BlockStack gap="050">
                        <Text as="span" variant="bodyMd" fontWeight="medium">{t("minScore")}</Text>
                        <Text as="span" variant="bodySm" tone="subdued">{t("minScoreHelp")}</Text>
                      </BlockStack>
                      <div style={{ width: 80, flexShrink: 0 }}>
                        <TextField
                          label=""
                          labelHidden
                          type="number"
                          value={minScoreInput}
                          onChange={setMinScoreInput}
                          min={0}
                          max={100}
                          suffix="%"
                          autoComplete="off"
                        />
                      </div>
                    </InlineStack>
                  </div>

                  {/* Blocker Gate */}
                  <div style={{ padding: "12px", border: "1px solid var(--p-color-border)", borderRadius: 8 }}>
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="050">
                        <Text as="span" variant="bodyMd" fontWeight="medium">{t("blockerLabel")}</Text>
                        <Text as="span" variant="bodySm" tone="subdued">{t("blockerDesc")}</Text>
                      </BlockStack>
                      <Checkbox
                        label=""
                        checked={automation.enforce_no_blockers}
                        onChange={(v) => setAutomation((a) => ({ ...a, enforce_no_blockers: v }))}
                        labelHidden
                      />
                    </InlineStack>
                  </div>

                  {automationSaved && (
                    <Banner tone="success">{t("saveAutomation")} ✓</Banner>
                  )}

                  <InlineStack align="end">
                    <Button
                      variant="primary"
                      onClick={() => void saveAutomation()}
                      loading={automationSaving}
                    >
                      {t("saveAutomation")}
                    </Button>
                  </InlineStack>
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Team Members */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="300" blockAlign="center">
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      background: "#FEF3C7",
                      borderRadius: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 16,
                    }}
                  >
                    👥
                  </div>
                  <Text as="h2" variant="headingMd">{t("teamMembers")}</Text>
                </InlineStack>
                <Button variant="primary" url={withShopParams("/portal/team", searchParams)}>
                  {t("inviteMember")}
                </Button>
              </InlineStack>
              <Divider />
              <Text as="p" variant="bodySm" tone="subdued">{t("teamManagedInPortal")}</Text>
              <Button url={withShopParams("/portal/team", searchParams)} variant="plain">{t("manageTeam")}</Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Billing & Plan */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="300" blockAlign="center">
                <div
                  style={{
                    width: 32,
                    height: 32,
                    background: "#FEE2E2",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                  }}
                >
                  💳
                </div>
                <Text as="h2" variant="headingMd">{t("billingPlan")}</Text>
              </InlineStack>
              <Divider />
              <InlineStack align="space-between" blockAlign="center" wrap>
                <BlockStack gap="100">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {shopInfo?.plan?.name ?? "Free"}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("billingDesc")}
                  </Text>
                </BlockStack>
                <Button variant="secondary" url={withShopParams("/app/billing", searchParams)}>
                  {t("viewPricing")}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Security & Privacy */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="300" blockAlign="center">
                <div
                  style={{
                    width: 32,
                    height: 32,
                    background: "#E0E7FF",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                  }}
                >
                  🛡️
                </div>
                <Text as="h2" variant="headingMd">{t("security")}</Text>
              </InlineStack>
              <Divider />
              <BlockStack gap="300">
                {[
                  { title: t("dataEncryption"), desc: t("dataEncryptionDesc") },
                  { title: t("soc2"), desc: t("soc2Desc") },
                  { title: t("gdpr"), desc: t("gdprDesc") },
                ].map(({ title, desc }) => (
                  <InlineStack key={title} gap="300" blockAlign="start">
                    <Text as="span" variant="bodyMd">✅</Text>
                    <BlockStack gap="050">
                      <Text as="span" variant="bodyMd" fontWeight="semibold">{title}</Text>
                      <Text as="span" variant="bodySm" tone="subdued">{desc}</Text>
                    </BlockStack>
                  </InlineStack>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
