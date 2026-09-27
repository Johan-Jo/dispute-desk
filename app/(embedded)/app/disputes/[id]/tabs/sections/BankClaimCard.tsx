/**
 * BankClaimCard — asks the merchant for the bank's claim from Shopify.
 *
 * DESIGN: Claude Design project b198374f-7223-4455-bc61-fa136135ece2,
 * `Bank Claim Card.dc.html`, revision of 2026-09-27 (highlighted card, boxed
 * countdown, file upload). Transcribed literally (CLAUDE.md rule 8):
 * amber-ringed card; header on #FFFBEB with a solid warning icon, "Action
 * required" badge, uppercase "reopened" pill, 22px title, amber intro and a
 * boxed "Response due / N days / date" block; two numbered step tiles (the
 * first with a soft-primary "Open dispute in Shopify ↗" button); the claim
 * field with an "Upload file / Paste text" switch, drop zone, uploaded-file
 * row (Replace / Remove), textarea, privacy note; the "no claim shown"
 * checkbox tile; footer status + Save claim. DS Badge/Button are this repo's
 * `components/ui`; colours are the global `--dd-*` tokens.
 *
 * Behaviour: the issuer claim is shown only in Shopify Admin; the Admin API
 * has no field for it (lib/disputes/bankClaim.ts). A file is stored and its
 * text read for the letter writer (lib/disputes/bankClaimFile.ts).
 * `?section=bank-claim` (the email link) scrolls here.
 */

"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getShopifyDisputeUrl, getShopifyOrderUrl } from "@/lib/shopify/shopifyAdminUrl";
import type { useDisputeWorkspace } from "../../hooks/useDisputeWorkspace";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

/** Matches BANK_CLAIM_MAX_TEXT / BANK_CLAIM_FILE_MAX_BYTES on the server. */
const MAX_TEXT = 8000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FILE_RE = /\.(pdf|txt|docx?|rtf|eml|png|jpe?g)$/i;
const ACCEPT = ".pdf,.txt,.doc,.docx,.rtf,.eml,.png,.jpg,.jpeg,application/pdf,text/plain";
const DAY_MS = 86_400_000;

type Mode = "pdf" | "text";

export function BankClaimCard({ workspace }: { workspace: Workspace }) {
  const t = useTranslations("disputes.bankClaim");
  const locale = useLocale();
  const { data, derived, actions } = workspace;
  const searchParams = useSearchParams();
  const ref = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [claim, setClaim] = useState("");
  const [noClaim, setNoClaim] = useState(false);
  const [mode, setMode] = useState<Mode>("pdf");
  const [file, setFileState] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
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
  // The design's button opens the DISPUTE in Shopify Admin; the order page
  // (whose chargeback details also show the claim) is the fallback when the
  // dispute has no evidence id on record.
  const shopifyUrl =
    getShopifyDisputeUrl(dispute.shopDomain, dispute.disputeEvidenceGid) ??
    getShopifyOrderUrl(dispute.shopDomain, dispute.orderGid);
  const ready = noClaim || (mode === "pdf" ? !!file : claim.trim().length > 0);

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

  const reset = () => {
    setSaved(false);
    setErrorMessage(null);
  };
  function setFile(f: File | null | undefined) {
    if (!f) return;
    if (!FILE_RE.test(f.name)) {
      setErrorMessage(t("errorFileType"));
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setErrorMessage(t("errorFileSize"));
      return;
    }
    setFileState(f);
    reset();
  }
  const pickFile = () => fileRef.current?.click();

  const countLabel = noClaim
    ? t("countNotNeeded")
    : mode === "pdf"
      ? file
        ? t("countFile")
        : t("countRequired")
      : claim.length
        ? t("countChars", { count: claim.length })
        : t("countRequired");

  const fileExt = file ? (file.name.split(".").pop() || "file").slice(0, 4) : "";
  const fileSize = file
    ? file.size > 1048576
      ? `${(file.size / 1048576).toFixed(1)} MB`
      : `${Math.max(1, Math.round(file.size / 1024))} KB`
    : "";

  const dot = saved ? "var(--dd-success)" : errorMessage ? "var(--dd-danger)" : ready ? "var(--dd-primary)" : "var(--dd-warning)";
  const status = saved ? t("statusSaved") : errorMessage ? errorMessage : ready ? t("statusReady") : t("statusHold");

  async function onSave() {
    if (!ready || saved || saving) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      const result = noClaim
        ? await actions.submitBankClaim(null, true)
        : mode === "pdf"
          ? await actions.submitBankClaim(null, false, file)
          : await actions.submitBankClaim(claim.trim(), false);
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

  const tab = (active: boolean) => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    border: 0,
    borderRadius: 6,
    font: "inherit",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    background: active ? "var(--dd-surface)" : "transparent",
    color: active ? "var(--dd-text)" : "var(--dd-text-subtle)",
    boxShadow: active ? "0 1px 2px rgba(11,18,32,.08)" : "none",
  });

  const showDrop = mode === "pdf" && !file && !noClaim;
  const showFile = mode === "pdf" && !!file && !noClaim;
  const showText = mode === "text" || noClaim;

  return (
    <div id="bank-claim" ref={ref}>
      <style>{`#bank-claim textarea:focus{outline:none;border-color:var(--dd-primary-deep)!important;box-shadow:0 0 0 3px rgba(79,70,229,.15)}#bank-claim a{color:var(--dd-primary)}#bank-claim a:hover{color:var(--dd-primary-hover)}`}</style>
      <div
        style={{
          background: "var(--dd-surface)",
          border: "1px solid #FCD34D",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 0 0 4px rgba(245,158,11,.12),0 8px 24px -12px rgba(180,83,9,.25)",
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
            padding: 24,
            borderBottom: "1px solid #FDE68A",
            background: "#FFFBEB",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start", minWidth: 0 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: "var(--dd-warning)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "3px 10px",
                    borderRadius: 999,
                    background: "#FDE68A",
                    border: "1px solid #F59E0B",
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: ".02em",
                    textTransform: "uppercase",
                    color: "#78350F",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#B45309" }} />
                  {trigger === "general_reason" ? t("subGeneral") : t("subReopened")}
                </span>
              </div>
              <h2 style={{ margin: 0, fontSize: 22, lineHeight: "28px", fontWeight: 700, color: "var(--dd-text)", letterSpacing: "-0.01em" }}>
                {t("title")}
              </h2>
              <p style={{ margin: 0, fontSize: 14, lineHeight: "20px", color: "#78350F", maxWidth: 620, textWrap: "pretty" }}>
                {trigger === "general_reason" ? t("introGeneral") : t("introReopened")}
              </p>
            </div>
          </div>
          {dueDate ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 2,
                flexShrink: 0,
                padding: "10px 14px",
                borderRadius: 10,
                background: "var(--dd-surface)",
                border: "1px solid #FDE68A",
              }}
            >
              <span style={{ fontSize: 12, color: "#92400E" }}>{t("dueLabel")}</span>
              <span style={{ fontSize: 20, lineHeight: "24px", fontWeight: 700, color: "var(--dd-text)" }}>
                {daysLeft === 0 ? t("dueToday") : t("daysCount", { count: daysLeft ?? 0 })}
              </span>
              <span style={{ fontSize: 12, fontWeight: 500, color: "#92400E" }}>{dueDate}</span>
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
              {shopifyUrl ? (
                <div style={{ display: "flex", whiteSpace: "nowrap" }}>
                  <Button
                    variant="secondary"
                    size="md"
                    type="button"
                    style={{ background: "#DBEAFE", border: "1px solid #93C5FD", color: "#1E40AF", fontWeight: 600 }}
                    onClick={() => window.open(shopifyUrl, "_blank", "noopener,noreferrer")}
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
          <div
            role="tablist"
            style={{ display: "flex", gap: 4, padding: 4, borderRadius: 8, background: "var(--dd-bg)", border: "1px solid var(--dd-border)", alignSelf: "flex-start" }}
          >
            <button type="button" role="tab" aria-selected={mode === "pdf"} disabled={noClaim || saving} style={tab(mode === "pdf")} onClick={() => { setMode("pdf"); reset(); }}>
              {t("tabUpload")}
            </button>
            <button type="button" role="tab" aria-selected={mode === "text"} disabled={noClaim || saving} style={tab(mode === "text")} onClick={() => { setMode("text"); reset(); }}>
              {t("tabPaste")}
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            style={{ display: "none" }}
            onChange={(e) => {
              setFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {showDrop ? (
            <div
              role="button"
              tabIndex={0}
              onClick={pickFile}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") pickFile();
              }}
              onDragOver={(e: DragEvent) => {
                e.preventDefault();
                if (!drag) setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e: DragEvent) => {
                e.preventDefault();
                setDrag(false);
                setFile(e.dataTransfer.files?.[0]);
              }}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                minHeight: 132,
                padding: 20,
                boxSizing: "border-box",
                border: `1.5px dashed ${drag ? "var(--dd-primary)" : "#CBD5E1"}`,
                borderRadius: 8,
                background: drag ? "#EFF4FF" : "var(--dd-surface)",
                cursor: "pointer",
                textAlign: "center",
              }}
            >
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "#DBEAFE", color: "#1E40AF", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <path d="M17 8l-5-5-5 5" />
                  <path d="M12 3v12" />
                </svg>
              </div>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--dd-text)" }}>
                {t.rich("dropTitle", { browse: (chunks) => <span style={{ color: "var(--dd-primary)" }}>{chunks}</span> })}
              </span>
              <span style={{ fontSize: 12, color: "var(--dd-text-muted)" }}>{t("dropHint")}</span>
            </div>
          ) : null}
          {showFile && file ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", border: "1px solid var(--dd-border)", borderRadius: 8, background: "var(--dd-surface)" }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: "#FEE2E2",
                  color: "#B91C1C",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                }}
              >
                {fileExt}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: "var(--dd-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {file.name}
                </span>
                <span style={{ fontSize: 12, color: "var(--dd-text-subtle)" }}>
                  {saved ? t("fileMetaUploaded", { size: fileSize }) : t("fileMetaReady", { size: fileSize })}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <Button variant="ghost" size="sm" type="button" onClick={pickFile} disabled={saving}>
                  {t("replace")}
                </Button>
                <Button variant="ghost" size="sm" type="button" onClick={() => { setFileState(null); reset(); }} disabled={saving}>
                  {t("remove")}
                </Button>
              </div>
            </div>
          ) : null}
          {showText ? (
            <textarea
              id="bank-claim-text"
              rows={4}
              maxLength={MAX_TEXT}
              placeholder={t("textPlaceholder")}
              value={claim}
              onChange={(e) => {
                setClaim(e.target.value);
                reset();
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
          ) : null}
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
                reset();
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
            <span role={errorMessage ? "alert" : undefined}>{saving ? t("statusSaving") : status}</span>
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
