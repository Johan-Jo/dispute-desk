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
 * LAYOUT IS A TRANSCRIPTION of `Automation Rules Page.dc.html` (Claude Design
 * project "Dispute Desk Design Restoration"). Every colour, radius, spacing
 * value and control shape below is read off that file. It is the
 * specification: where it and an older decision disagree, it wins.
 *
 * What the design changed, and it is not only paint:
 *   - ONE explicit "Save changes". The switch, the per-type rows and the
 *     safeguard are all draft state until then. Previously the switch and the
 *     rows each wrote immediately and only the safeguard had a Save, so the
 *     page had three different commit models on one screen.
 *   - Per-type rows are a three-way segmented control (Store default /
 *     Automatic / Review before submit), not a dropdown, and each row carries
 *     an icon and a sub-line naming what it inherits or which playbook runs.
 *   - "Automate all" / "Review all" bulk actions.
 *
 * All persistence still goes through GET|PUT /api/automation/store → the single
 * canonical path in lib/rules/storeAutomation.ts.
 */
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { TemplateLibraryModal } from "@/components/packs/TemplateLibraryModal";
import { AutomationGroupList } from "@/components/automation/AutomationGroupList";
import { ALWAYS_REVIEWED_KEYS } from "@/components/automation/AlwaysReviewedFacts";
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

/** Design tokens, transcribed. Named so a stray hex cannot creep in. */
const CARD: React.CSSProperties = {
  background: "#FFFFFF",
  border: "1px solid #E1E3E5",
  borderRadius: 14,
  boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
};

const BTN_SECONDARY: React.CSSProperties = {
  font: "inherit",
  fontSize: 13,
  fontWeight: 600,
  color: "#202223",
  background: "#FFFFFF",
  border: "1px solid #D1D3D5",
  borderRadius: 8,
  padding: "7px 14px",
  cursor: "pointer",
  boxShadow: "0 1px 0 rgba(16,24,40,0.04)",
};

const BTN_PRIMARY: React.CSSProperties = {
  ...BTN_SECONDARY,
  color: "#FFFFFF",
  background: "#1D4ED8",
  borderColor: "#1D4ED8",
  boxShadow: "0 1px 0 rgba(16,24,40,0.12)",
};

/** The design's responsive rules, keyed on its own `data-r` hooks. */
const RESPONSIVE_CSS = `
@media (max-width: 700px) {
  [data-r="page"] { padding: 16px 12px 48px !important; }
  [data-r="hdr"] > div:last-child { width: 100%; }
  [data-r="hdr"] > div:last-child > button { flex: 1 1 auto; }
  [data-r="modes"] { grid-template-columns: 1fr !important; }
  [data-r="row"] { align-items: flex-start !important; }
  [data-r="seg"] { width: 100%; flex-wrap: wrap; }
  [data-r="seg"] > button { flex: 1 1 auto; }
  [data-r="locked"] { width: 100%; flex-direction: row-reverse; justify-content: flex-end; }
  [data-r="locked"] > span:first-child { text-align: left !important; }
  [data-r="toolbar"] > div, [data-r="toolbar"] > button { width: 100%; }
  [data-r="toolbar"] > div > button { flex: 1 1 auto; }
  [data-r="always"] { grid-template-columns: 1fr !important; }
  [data-r="sgrow"] { align-items: flex-start !important; }
  [data-r="sgrow"] + div { padding-left: 2px !important; }
}
`;

export default function EmbeddedRulesPage() {
  const searchParams = useSearchParams();
  const locale = useLocale();
  const tr = useTranslations("rules");
  const tn = useTranslations("nav");
  const tCommon = useTranslations("common");

  // ─── Draft state ──────────────────────────────────────────────────────
  // The design gives the page ONE commit point, so everything here is a draft
  // until Save. `saved*` is what the server holds; the pair drives `dirty`.
  const [mode, setMode] = useState<StoreAutomationMode>("review");
  const [savedMode, setSavedMode] = useState<StoreAutomationMode>("review");
  const [safeguard, setSafeguard] = useState<SafeguardState>({
    enabled: false,
    amount: DEFAULT_SAFEGUARD_AMOUNT,
  });
  const [savedSafeguard, setSavedSafeguard] = useState<SafeguardState>({
    enabled: false,
    amount: DEFAULT_SAFEGUARD_AMOUNT,
  });
  const [groups, setGroups] = useState<GroupOverrides>({});
  const [savedGroups, setSavedGroups] = useState<GroupOverrides>({});

  const [rulesAllowed, setRulesAllowed] = useState(true);
  const [customRules, setCustomRules] = useState<CustomRule[]>([]);
  const [shopId, setShopId] = useState<string | null>(null);

  // UI state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [playbooksOpen, setPlaybooksOpen] = useState(false);
  const [overridesOpen, setOverridesOpen] = useState(false);
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
        const m: StoreAutomationMode = data.mode === "auto" ? "auto" : "review";
        setMode(m);
        setSavedMode(m);
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
        setOverridesOpen(Object.keys(g).length > 0);
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

  // ─── Dirty tracking + the single save ─────────────────────────────────

  const sameGroups = (a: GroupOverrides, b: GroupOverrides) => {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => a[k as keyof GroupOverrides] === b[k as keyof GroupOverrides]);
  };

  const dirty =
    mode !== savedMode ||
    safeguard.enabled !== savedSafeguard.enabled ||
    (safeguard.enabled && safeguard.amount !== savedSafeguard.amount) ||
    !sameGroups(groups, savedGroups);

  /**
   * How many per-type exceptions the last house-rule click wiped. Shown as a
   * note under the two cards: clearing the list is the intended effect, but an
   * invisible one would be just as confusing as the contradiction it replaced.
   */
  const [clearedCount, setClearedCount] = useState(0);

  /** Any edit clears the "Saved" confirmation — it must never outlive its truth. */
  const touch = useCallback(() => {
    setJustSaved(false);
    setErrorMsg(null);
    setClearedCount(0);
  }, []);

  const save = useCallback(async () => {
    if (!dirty || saving || !rulesAllowed) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/automation/store", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // One commit point, so the draft IS the payload — there is no second
        // control holding unsaved state that this could silently publish.
        body: JSON.stringify({
          mode,
          safeguard: {
            enabled: safeguard.enabled,
            amount: safeguard.amount,
          },
          groups,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(body?.upgrade_required ? "planGateSaveError" : "starterRulesError");
        return;
      }
      setSavedMode(mode);
      setSavedSafeguard(safeguard);
      setSavedGroups(groups);
      setJustSaved(true);
    } catch {
      setErrorMsg("starterRulesError");
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, rulesAllowed, mode, safeguard, groups]);

  /**
   * Picking a house rule CLEARS the per-type list.
   *
   * This is the whole fix. Before, the store-wide choice and the per-type list
   * were two controls at the same level with the list silently winning, so a
   * merchant could select "Review everything" and stare at four rows reading
   * "Automatic" with nothing on screen explaining it. The page contradicted
   * itself and read as broken.
   *
   * Now the house rule is authoritative at the moment you pick it: it wipes
   * every exception and everything follows it. Anything you set on a row
   * AFTERWARDS takes precedence again — that is what the list is for. Clicking
   * the rule you are already on still clears, because "make everything follow
   * this" is exactly what the merchant is asking for.
   *
   * Draft only. Nothing is written until Save changes, so navigating away
   * abandons it.
   */
  const pickMode = useCallback(
    (next: StoreAutomationMode) => {
      if (!rulesAllowed || saving) return;
      touch();
      setClearedCount(Object.keys(groups).length);
      setMode(next);
      setGroups({});
    },
    [rulesAllowed, saving, touch, groups],
  );

  const customisedCount = Object.keys(groups).length;

  const nextRulePriority = useMemo(
    () => customRules.reduce((m, r) => Math.max(m, r.priority), 100000) + 1,
    [customRules],
  );

  // ─── Render ───────────────────────────────────────────────────────────

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

  if (loading) {
    return (
      <div
        data-r="page"
        style={{
          minHeight: "100%",
          background: "#F1F1F1",
          padding: "28px 24px 64px",
          color: "#202223",
        }}
      >
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <div style={{ ...CARD, padding: 48, textAlign: "center", color: "#6D7175" }}>
            {tCommon("loading")}
          </div>
        </div>
      </div>
    );
  }

  const modeCard = (
    active: boolean,
    accent: string,
    tint: string,
  ): React.CSSProperties =>
    active
      ? {
          border: `1.5px solid ${accent}`,
          background: tint,
          boxShadow: `0 0 0 3px ${accent}1f`,
        }
      : { border: "1px solid #E1E3E5", background: "#FFFFFF", boxShadow: "none" };

  const modeIcon = (active: boolean, accent: string) =>
    active
      ? { background: accent, color: "#FFFFFF" }
      : { background: "#F1F2F3", color: "#6D7175" };

  const autoActive = mode === "auto";
  const reviewActive = mode === "review";

  const saveStyle: React.CSSProperties = justSaved
    ? { background: "#DCFCE7", color: "#15803D", borderColor: "#BBF7D0", cursor: "default" }
    : dirty
      ? { background: "#1D4ED8", color: "#FFFFFF", borderColor: "#1D4ED8", cursor: "pointer" }
      : { background: "#F1F2F3", color: "#A9AFB6", borderColor: "#E1E3E5", cursor: "default" };

  return (
    <div
      data-r="page"
      style={{
        minHeight: "100%",
        background: "#F1F1F1",
        padding: "28px 24px 64px",
        color: "#202223",
      }}
    >
      <style>{RESPONSIVE_CSS}</style>
      <div
        style={{
          maxWidth: 1000,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div
          data-r="hdr"
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 24,
            flexWrap: "wrap",
            padding: "0 4px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <h1
              style={{
                margin: 0,
                fontSize: 20,
                lineHeight: 1.3,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: "#202223",
              }}
            >
              {tn("automation")}
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: "#6D7175" }}>
              {tr("purposeLine")}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              style={BTN_SECONDARY}
              disabled={!shopId}
              onClick={() => setPlaybooksOpen(true)}
            >
              {tr("browsePlaybooks")}
            </button>
            <button
              type="button"
              style={BTN_PRIMARY}
              disabled={!rulesAllowed}
              onClick={openNewCustomRule}
            >
              {tr("primaryAddCustom")}
            </button>
          </div>
        </div>

        {/* ── Plan gate — rules writes would 403, say so up front ── */}
        {!rulesAllowed && (
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              background: "#FFF7ED",
              border: "1px solid #FED7AA",
              borderRadius: 12,
              padding: "14px 16px",
            }}
          >
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{tr("planGateTitle")}</div>
              <div style={{ fontSize: 13, color: "#3B4149" }}>{tr("planGateBody")}</div>
            </div>
            <a
              href={withShopParams("/app/billing", searchParams ?? new URLSearchParams())}
              style={{ ...BTN_SECONDARY, flexShrink: 0, textDecoration: "none" }}
            >
              {tr("upgradePlan")}
            </a>
          </div>
        )}

        {errorMsg && (
          <div
            style={{
              background: "#FEF2F2",
              border: "1px solid #FECACA",
              borderRadius: 12,
              padding: "14px 16px",
              fontSize: 13,
              color: "#991B1B",
            }}
          >
            {tr(errorMsg)}
          </div>
        )}

        {/* ── Dismissable explainer ────────────────────────────── */}
        {explainerOpen && (
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              background: "#F0F7FF",
              border: "1px solid #C9E1FB",
              borderRadius: 12,
              padding: "14px 16px",
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#1D4ED8"
              strokeWidth="2"
              strokeLinecap="round"
              style={{ flexShrink: 0, marginTop: 2 }}
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v5M12 7.5v.01" />
            </svg>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#202223" }}>
                {tr("explainerTitle")}
              </div>
              <ul
                style={{
                  margin: 0,
                  // Explicit: a global reset strips markers, and the design
                  // draws a bulleted list.
                  listStyle: "disc",
                  paddingLeft: 18,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: "#3B4149",
                  textWrap: "pretty",
                }}
              >
                <li>{tr("explainerBullet1")}</li>
                <li>{tr("explainerBullet2")}</li>
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
                padding: 2,
                cursor: "pointer",
                color: "#6D7175",
                display: "inline-flex",
                borderRadius: 6,
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        )}

        {/* ── The store-wide switch + per-type overrides ─────────── */}
        <div style={CARD}>
          <div
            style={{
              padding: "18px 20px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 3,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#202223" }}>
              {tr("modeSectionTitle")}
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: "#6D7175" }}>
              {tr("modeSectionSubtitle")}
            </p>
          </div>

          <div
            data-r="modes"
            style={{
              padding: "0 20px 18px",
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 12,
            }}
          >
            <button
              type="button"
              disabled={!rulesAllowed}
              onClick={() => pickMode("auto")}
              style={{
                textAlign: "left",
                font: "inherit",
                cursor: rulesAllowed ? "pointer" : "default",
                borderRadius: 12,
                padding: "15px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                transition: "box-shadow 150ms ease, border-color 150ms ease",
                ...modeCard(autoActive, "#22C55E", "#F6FDF9"),
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    ...modeIcon(autoActive, "#22C55E"),
                  }}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
                  </svg>
                </span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#202223" }}>
                  {tr("modeAutoTitle")}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.02em",
                    padding: "2px 7px",
                    borderRadius: 999,
                    background: "#DCFCE7",
                    color: "#15803D",
                  }}
                >
                  {tr("modeAutoBadge")}
                </span>
              </div>
              <span style={{ fontSize: 13, lineHeight: 1.5, color: "#5C6570", textWrap: "pretty" }}>
                {tr("modeAutoDesc")}
              </span>
            </button>

            <button
              type="button"
              disabled={!rulesAllowed}
              onClick={() => pickMode("review")}
              style={{
                textAlign: "left",
                font: "inherit",
                cursor: rulesAllowed ? "pointer" : "default",
                borderRadius: 12,
                padding: "15px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                transition: "box-shadow 150ms ease, border-color 150ms ease",
                ...modeCard(reviewActive, "#0EA5E9", "#F4FBFE"),
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    ...modeIcon(reviewActive, "#0EA5E9"),
                  }}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" />
                    <circle cx="12" cy="12" r="2.5" />
                  </svg>
                </span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#202223" }}>
                  {tr("modeReviewTitle")}
                </span>
              </div>
              <span style={{ fontSize: 13, lineHeight: 1.5, color: "#5C6570", textWrap: "pretty" }}>
                {tr("modeReviewDesc")}
              </span>
            </button>
          </div>

          {/* Clearing the list is the point of picking a house rule, but an
              invisible effect would be as confusing as the contradiction it
              replaced. Say what just happened. */}
          {clearedCount > 0 && (
            <div style={{ padding: "0 20px 18px" }}>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  background: "#F0F7FF",
                  border: "1px solid #C9E1FB",
                  borderRadius: 10,
                  padding: "10px 14px",
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  color: "#1E3A5F",
                }}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#1D4ED8"
                  strokeWidth="2"
                  strokeLinecap="round"
                  style={{ flexShrink: 0, marginTop: 2 }}
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 11v5M12 7.5v.01" />
                </svg>
                <span>
                  {tr("modeClearedExceptions", {
                    count: clearedCount,
                    mode: mode === "auto" ? tr("modeAutoTitle") : tr("modeReviewTitle"),
                  })}
                </span>
              </div>
            </div>
          )}

          {/* ── Per-type overrides, as progressive disclosure ────── */}
          <div
            style={{
              borderTop: "1px solid #E1E3E5",
              padding: "14px 20px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                flex: 1,
                minWidth: 260,
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#202223" }}>
                  {tr("groupsSectionTitle")}
                </h3>
                {/* Hidden entirely at 0 — a "0 customised" badge is noise on a
                    page most merchants never customise. */}
                {customisedCount > 0 && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "2px 7px",
                      borderRadius: 999,
                      background: "#EEF2FF",
                      color: "#3730A3",
                    }}
                  >
                    {tr("groupsCustomisedBadge", { count: customisedCount })}
                  </span>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 12, color: "#6D7175" }}>
                {tr("groupsSectionSubtitle")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOverridesOpen((open) => !open)}
              aria-expanded={overridesOpen}
              aria-controls="automation-groups"
              style={{
                font: "inherit",
                fontSize: 12,
                fontWeight: 600,
                color: "#1D4ED8",
                background: "transparent",
                border: "1px solid transparent",
                borderRadius: 8,
                padding: "6px 10px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span>{overridesOpen ? tr("groupsHide") : tr("groupsShow")}</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transition: "transform 180ms ease",
                  transform: overridesOpen ? "rotate(180deg)" : "rotate(0deg)",
                }}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </div>

          {overridesOpen && (
            <div id="automation-groups">
              <AutomationGroupList
                storeMode={mode}
                value={groups}
                onChange={(next) => {
                  touch();
                  setGroups(next);
                }}
                t={tr}
                disabled={!rulesAllowed || saving}
              />
            </div>
          )}

          {/* ── One commit point ─────────────────────────────────── */}
          <div
            data-r="toolbar"
            style={{
              borderTop: "1px solid #E1E3E5",
              background: "#F6F8FB",
              borderRadius: "0 0 13px 13px",
              padding: "13px 20px",
              display: "flex",
              gap: 10,
              alignItems: "center",
              justifyContent: "flex-end",
              flexWrap: "wrap",
            }}
          >
            {/* "Automate all" / "Review all" are GONE. Under the house-rule
                model they were a trap: identical in effect to picking the
                matching rule, except they left six exceptions behind that the
                next house-rule click silently wiped. And with every row already
                set they appeared to do nothing at all, which is the complaint
                that started this. The house rule IS the bulk action. */}
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving || !rulesAllowed}
              style={{
                font: "inherit",
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 8,
                padding: "7px 16px",
                border: "1px solid transparent",
                transition: "all 140ms ease",
                ...saveStyle,
              }}
            >
              {justSaved ? tr("saveSaved") : tr("saveChanges")}
            </button>
          </div>
        </div>

        {/* ── Safeguards ─────────────────────────────────────────── */}
        <div
          style={{
            ...CARD,
            padding: "18px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#202223" }}>
              {tr("safeguardTitle")}
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: "#6D7175" }}>
              {tr("safeguardSubtitle")}
            </p>
          </div>

          <label
            data-r="sgrow"
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              cursor: rulesAllowed ? "pointer" : "default",
              borderRadius: 12,
              padding: "14px 16px",
              transition: "background 140ms ease, border-color 140ms ease",
              border: `1px solid ${safeguard.enabled ? "#C9E1FB" : "#E9EBED"}`,
              background: safeguard.enabled ? "#F5FAFF" : "#FFFFFF",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "all 140ms ease",
                background: safeguard.enabled ? "#1D4ED8" : "#F1F2F3",
                color: safeguard.enabled ? "#FFFFFF" : "#6D7175",
              }}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 600, color: "#202223" }}>
                {tr("safeguardToggle")}
              </span>
              <span style={{ fontSize: 12.5, color: "#6D7175", textWrap: "pretty" }}>
                {tr("safeguardHint")}
              </span>
            </span>
            <span
              style={{
                position: "relative",
                width: 38,
                height: 22,
                borderRadius: 999,
                flexShrink: 0,
                transition: "background 160ms ease",
                background: safeguard.enabled ? "#1D4ED8" : "#D1D3D5",
              }}
            >
              <input
                type="checkbox"
                aria-label={tr("safeguardToggle")}
                checked={safeguard.enabled}
                disabled={!rulesAllowed}
                onChange={(e) => {
                  touch();
                  setSafeguard((prev) => ({ ...prev, enabled: e.target.checked }));
                }}
                style={{
                  position: "absolute",
                  inset: 0,
                  opacity: 0,
                  margin: 0,
                  cursor: rulesAllowed ? "pointer" : "default",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  top: 3,
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  background: "#FFFFFF",
                  boxShadow: "0 1px 2px rgba(16,24,40,0.24)",
                  transition: "left 160ms ease",
                  left: safeguard.enabled ? 19 : 3,
                }}
              />
            </span>
          </label>

          {safeguard.enabled && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                padding: "0 2px 0 62px",
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 500, color: "#3B4149" }}>
                {tr("safeguardAmountPrefix")}
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  border: "1px solid #D1D3D5",
                  borderRadius: 8,
                  background: "#FFFFFF",
                  overflow: "hidden",
                  boxShadow: "0 1px 0 rgba(16,24,40,0.04)",
                }}
              >
                <span style={{ padding: "7px 2px 7px 10px", fontSize: 13, color: "#6D7175" }}>
                  $
                </span>
                <input
                  type="number"
                  aria-label={tr("safeguardAmountLabel")}
                  value={String(safeguard.amount)}
                  disabled={!rulesAllowed}
                  onChange={(e) => {
                    const num = parseInt(e.target.value, 10);
                    if (!isNaN(num) && num > 0) {
                      touch();
                      setSafeguard((prev) => ({ ...prev, amount: num }));
                    }
                  }}
                  style={{
                    font: "inherit",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#202223",
                    border: "none",
                    outline: "none",
                    padding: "7px 10px 7px 4px",
                    width: 76,
                    background: "transparent",
                  }}
                />
              </span>
              <span style={{ fontSize: 12.5, color: "#6D7175" }}>
                {tr("safeguardAmountSuffix")}
              </span>
            </div>
          )}

          {/* The five conditions the engine always holds, whatever mode the
              shop picked. Keys shared with the wizard via ALWAYS_REVIEWED_KEYS
              so the two surfaces can never describe the engine differently. */}
          <div
            style={{
              border: "1px solid #E9EBED",
              background: "#FAFBFB",
              borderRadius: 12,
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#64748B"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
              >
                <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
                <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
              </svg>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "#202223" }}>
                {tr("alwaysReviewedHeading")}
              </span>
              <span style={{ fontSize: 12.5, color: "#6D7175" }}>
                {tr("alwaysReviewedHeadingTail")}
              </span>
            </div>
            <div
              data-r="always"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: "8px 16px",
              }}
            >
              {ALWAYS_REVIEWED_KEYS.map((key) => (
                <span
                  key={key}
                  style={{
                    fontSize: 12.5,
                    lineHeight: 1.45,
                    color: "#5C6570",
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                    textWrap: "pretty",
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#94A3B8"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0, marginTop: 2 }}
                  >
                    <path d="M5 12.5l4.5 4.5L19 7" />
                  </svg>
                  {tr(key)}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Advanced custom rules ──────────────────────────────── */}
        <div
          style={{
            ...CARD,
            padding: "18px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#202223" }}>
              {tr("advancedFiltersTitle")}
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: "#6D7175" }}>
              {tr("advancedFiltersSubtitle")}
            </p>
          </div>

          {customRules.length === 0 ? (
            <div
              style={{
                border: "1px dashed #D8DBDE",
                borderRadius: 12,
                background: "#FAFBFB",
                padding: 22,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                textAlign: "center",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  background: "#EEF2FF",
                  color: "#4F46E5",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 6h16M7 12h13M10 18h10M4 12h.01M4 18h.01" />
                </svg>
              </span>
              <span style={{ fontSize: 13, color: "#5C6570", maxWidth: 420, textWrap: "pretty" }}>
                {tr("customRulesEmpty")}
              </span>
              <button
                type="button"
                onClick={openNewCustomRule}
                disabled={!rulesAllowed}
                style={{ ...BTN_SECONDARY, fontSize: 12.5, padding: "6px 14px" }}
              >
                {tr("customRulesEmptyCta")}
              </button>
            </div>
          ) : (
            <div>
              {customRules.map((rule, idx) => {
                const normalizedMode =
                  rule.action?.mode === "auto" || rule.action?.mode === "auto_pack"
                    ? "auto"
                    : "review";
                return (
                  <div
                    key={rule.id}
                    style={{
                      padding: "12px 0",
                      borderTop: idx === 0 ? "none" : "1px solid #F1F2F3",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: "#202223" }}>
                          {rule.name ?? tr("unnamedRule")}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: "2px 7px",
                            borderRadius: 999,
                            background: rule.enabled ? "#DCFCE7" : "#F1F2F3",
                            color: rule.enabled ? "#15803D" : "#6D7175",
                          }}
                        >
                          {rule.enabled ? tr("active") : tr("inactive")}
                        </span>
                      </div>
                      <span style={{ fontSize: 12, color: "#6D7175" }}>
                        {`${tr("action")}: ${
                          normalizedMode === "auto" ? tr("autoPack") : tr("review")
                        }`}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => openEditCustomRule(rule)}
                      style={{ ...BTN_SECONDARY, fontSize: 12.5, padding: "6px 12px" }}
                    >
                      {tr("editRule")}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

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
    </div>
  );
}
