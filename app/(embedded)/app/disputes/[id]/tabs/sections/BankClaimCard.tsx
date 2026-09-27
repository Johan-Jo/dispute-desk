/**
 * BankClaimCard — asks the merchant to copy the bank's claim from Shopify.
 *
 * DESIGN: Claude Design project b198374f-7223-4455-bc61-fa136135ece2,
 * `Bank Claim Card.dc.html` (2026-09-27). Transcribed literally (CLAUDE.md
 * rule 8): header (warning icon, "Action required" badge, subtitle, title,
 * intro, response-due block), two numbered step tiles, the claim textarea
 * with its character-count label and privacy note, the "no claim shown"
 * checkbox tile, and the footer status line + primary save button. The DS
 * Badge and Button are this repo's `components/ui` (the design system is
 * synced from them); colours are the global `--dd-*` tokens.
 *
 * Behaviour: the bank's explanation (Shopify's "issuer claim") is shown only
 * in the chargeback details on the order page in Shopify Admin; the Admin API
 * has no field for it. For a reopened dispute, or a `general` one with no
 * network reason code, it is the only statement of what the response has to
 * answer — nothing is filed until the merchant adds it or confirms Shopify
 * shows none (lib/disputes/bankClaim.ts). `?section=bank-claim` (the email
 * link) scrolls here. Visibility comes from the server's `bankClaim.trigger`.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getShopifyOrderUrl } from "@/lib/shopify/shopifyAdminUrl";
import type { useDisputeWorkspace } from "../../hooks/useDisputeWorkspace";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

/** Matches BANK_CLAIM_MAX_TEXT in lib/disputes/bankClaim.ts. */
const MAX_TEXT = 8000;
const DAY_MS = 86_400_000;

export function BankClaimCard({ workspace }: { workspace: Workspace }) {
  const t = useTranslations("disputes.bankClaim");
  const locale = useLocale();
  const { data, derived, actions } = workspace;
  const searchParams = useSearchParams();
  const ref = useRef<HTMLDivElement | null>(null);

  const [claim, setClaim] = useState("");
  const [noClaim, setNoClaim] = useState(false);
  const [saving, setSaving] = useState(false);
  // Kept on screen after a save in this session so the merchant sees the
  // design's "Saved" state; the server stops asking once it has the answer.
  const [saved, setSaved] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const trigger = data?.bankClaim?.trigger ?? null;
  const answer = data?.bankClaim?.answer ?? null;
  const visible = saved || (trigger !== null && answer === null);

  useEffect(() => {
    if (visible && searchParams?.get("section") === "bank-claim") {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [visible, searchParams]);

  if (!visible || !data?.dispute) return null;
  if (!saved && (derived.isBuilding || derived.isRegenerating)) return null;

  const dispute = data.dispute;
  const orderUrl = getShopifyOrderUrl(dispute.shopDomain, dispute.orderGid);
  const ready = noClaim || claim.trim().length > 0;

  const dueDate = dispute.dueAt
    ? new Date(dispute.dueAt).toLocaleDateString(locale || undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;
  const daysLeft = dispute.dueAt
    ? Math.max(0, Math.ceil((new Date(dispute.dueAt).getTime() - Date.now()) / DAY_MS))
    : null;

  const countLabel = noClaim
    ? t("countNotNeeded")
    : claim.length
      ? t("countChars", { count: claim.length })
      : t("countRequired");
  const dot = saved ? "var(--dd-success)" : errorMessage ? "var(--dd-danger)" : ready ? "var(--dd-primary)" : "var(--dd-warning)";
  const status = saved
    ? t("statusSaved")
    : errorMessage
      ? errorMessage
      : ready
        ? t("statusReady")
        : t("statusHold");

  async function onSave() {
    if (!ready || saved || saving) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      const result = await actions.submitBankClaim(noClaim ? null : claim.trim() || null, noClaim);
      if (!result.ok) {
        setErrorMessage(
          result.code === "WINDOW_CLOSED"
            ? t("errorWindowClosed")
            : t("errorGeneric", { code: result.code ?? "unknown" }),
        );
        return;
      }
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div id="bank-claim" ref={ref}>
      <style>{`#bank-claim textarea:focus{outline:none;border-color:var(--dd-primary-deep)!important;box-shadow:0 0 0 3px rgba(79,70,229,.15)}#bank-claim a{color:var(--dd-primary)}#bank-claim a:hover{color:var(--dd-primary-hover)}`}</style>
      <div
        style={{
          background: "var(--dd-surface)",
          border: "1px solid var(--dd-border)",
          borderRadius: 12,
          overflow: "hidden",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            padding: "20px 24px",
            borderBottom: "1px solid var(--dd-border)",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start", minWidth: 0 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "#FEF3C7",
                color: "#B45309",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
                <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              </svg>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexShrink: 0, whiteSpace: "nowrap" }}>
                  <Badge variant="warning">{t("badge")}</Badge>
                </div>
                <span style={{ fontSize: 12, color: "var(--dd-text-subtle)" }}>
                  {trigger === "general_reason" ? t("subGeneral") : t("subReopened")}
                </span>
              </div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--dd-text)", letterSpacing: "-0.01em" }}>
                {t("title")}
              </h2>
              <p style={{ margin: 0, fontSize: 14, lineHeight: "20px", color: "var(--dd-text-subtle)", maxWidth: 620, textWrap: "pretty" }}>
                {trigger === "general_reason" ? t("introGeneral") : t("introReopened")}
              </p>
            </div>
          </div>
          {dueDate ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
              <span style={{ fontSize: 12, color: "var(--dd-text-subtle)" }}>{t("dueLabel")}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--dd-text)" }}>{dueDate}</span>
              {daysLeft !== null ? (
                <span style={{ fontSize: 12, fontWeight: 500, color: "#B45309" }}>
                  {daysLeft === 0 ? t("dueToday") : t("daysLeft", { count: daysLeft })}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Steps */}
        <div style={{ padding: "20px 24px", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "14px 16px", border: "1px solid var(--dd-border)", borderRadius: 10, background: "var(--dd-bg)" }}>
            <StepNumber n={1} />
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--dd-text)" }}>{t("step1Title")}</span>
                <span style={{ fontSize: 13, lineHeight: "18px", color: "var(--dd-text-subtle)" }}>
                  {t("step1Path", { order: dispute.orderName || "—" })}
                </span>
              </div>
              {orderUrl ? (
                <div style={{ display: "flex", whiteSpace: "nowrap" }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => window.open(orderUrl, "_blank", "noopener,noreferrer")}
                  >
                    {t("openInShopify")}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "14px 16px", border: "1px solid var(--dd-border)", borderRadius: 10, background: "var(--dd-bg)" }}>
            <StepNumber n={2} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--dd-text)" }}>{t("step2Title")}</span>
              <span style={{ fontSize: 13, lineHeight: "18px", color: "var(--dd-text-subtle)" }}>{t("step2Body")}</span>
            </div>
          </div>
        </div>

        {/* Claim */}
        <div style={{ padding: "0 24px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <label htmlFor="bank-claim-text" style={{ fontSize: 14, fontWeight: 500, color: "var(--dd-text)" }}>
              {t("textLabel")}
            </label>
            <span style={{ fontSize: 12, color: "var(--dd-text-muted)" }}>{countLabel}</span>
          </div>
          <textarea
            id="bank-claim-text"
            rows={4}
            maxLength={MAX_TEXT}
            placeholder={t("textPlaceholder")}
            value={claim}
            onChange={(e) => {
              setClaim(e.target.value);
              setSaved(false);
              setErrorMessage(null);
            }}
            disabled={noClaim || saving}
            style={{
              width: "100%",
              boxSizing: "border-box",
              resize: "vertical",
              minHeight: 104,
              padding: "12px 14px",
              font: "inherit",
              fontSize: 14,
              lineHeight: "20px",
              color: "var(--dd-text)",
              border: "1px solid var(--dd-border)",
              borderRadius: 8,
              background: noClaim ? "var(--dd-bg)" : "var(--dd-surface)",
            }}
          />
          <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--dd-text-subtle)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span>{t("privacyNote")}</span>
          </div>
          <label
            style={{
              marginTop: 8,
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              padding: "12px 14px",
              border: `1px solid ${noClaim ? "var(--dd-primary)" : "var(--dd-border)"}`,
              borderRadius: 8,
              cursor: "pointer",
              background: noClaim ? "#EFF4FF" : "var(--dd-surface)",
            }}
          >
            <input
              type="checkbox"
              checked={noClaim}
              onChange={(e) => {
                setNoClaim(e.target.checked);
                setSaved(false);
                setErrorMessage(null);
              }}
              disabled={saving}
              style={{ margin: "2px 0 0", width: 16, height: 16, accentColor: "var(--dd-primary)" }}
            />
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: "var(--dd-text)" }}>{t("noClaimShown")}</span>
              <span style={{ fontSize: 13, color: "var(--dd-text-subtle)" }}>{t("noClaimShownHelp")}</span>
            </span>
          </label>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            padding: "14px 24px",
            borderTop: "1px solid var(--dd-border)",
            background: "var(--dd-bg)",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--dd-text-subtle)" }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: dot, flexShrink: 0 }} />
            <span role={errorMessage ? "alert" : undefined}>{status}</span>
          </div>
          <div style={{ display: "flex", flexShrink: 0, whiteSpace: "nowrap" }}>
            <Button variant="primary" type="button" disabled={!ready || saved || saving} onClick={onSave}>
              {saved ? t("saved") : t("save")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span
      style={{
        width: 24,
        height: 24,
        borderRadius: 999,
        background: "var(--dd-primary)",
        color: "#fff",
        fontSize: 12,
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {n}
    </span>
  );
}
