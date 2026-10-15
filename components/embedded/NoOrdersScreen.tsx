"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";

/**
 * Shown in place of the whole embedded app when the store has no orders
 * (docs/plans/no-orders-install-gate.plan.md). Rendered by the `/app/*` layout
 * INSTEAD of the nav and page content, so there is nothing to browse.
 *
 * Transcribed literally from the Claude Design file "No Orders Empty State"
 * (DisputeDesk design-system tokens inlined; Badge = warning, Buttons =
 * secondary/primary md from components/ui).
 */

const SUPPORT_EMAIL = "support@disputedesk.app";

const DD = {
  bg: "#F6F8FB",
  surface: "#FFFFFF",
  border: "#E5E7EB",
  text: "#0B1220",
  textSubtle: "#667085",
  textMuted: "#64748B",
  primary: "#1D4ED8",
  primaryHover: "#1E40AF",
};

const stepNumber: CSSProperties = {
  flex: "none",
  width: 24,
  height: 24,
  borderRadius: 999,
  background: DD.surface,
  border: `1px solid ${DD.border}`,
  fontSize: 12,
  fontWeight: 600,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: DD.text,
  boxSizing: "border-box",
};

const button: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: 40,
  padding: "0 16px",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
  fontFamily: "inherit",
  cursor: "pointer",
  textDecoration: "none",
  boxSizing: "border-box",
  transition: "background-color .15s",
};

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div style={stepNumber}>{n}</div>
      <div style={{ fontSize: 14, lineHeight: "22px", color: DD.text }}>
        <strong style={{ fontWeight: 600 }}>{title}</strong>{" "}
        <span style={{ color: DD.textSubtle }}>{body}</span>
      </div>
    </div>
  );
}

export function NoOrdersScreen() {
  const t = useTranslations("noOrdersGate");
  return (
    <div
      style={{
        minHeight: "100vh",
        background: DD.bg,
        display: "flex",
        justifyContent: "center",
        padding: "120px 20px 48px",
        boxSizing: "border-box",
        fontFamily: "Inter, system-ui, sans-serif",
        color: DD.text,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 600,
          display: "flex",
          flexDirection: "column",
          gap: 32,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
          }}
        >
          <div
            aria-hidden
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: DD.primary,
              color: "#FFFFFF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            D
          </div>
          <span
            style={{
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: DD.text,
            }}
          >
            Dispute<span style={{ color: DD.primary }}>Desk</span>
          </span>
        </div>

        <div
          style={{
            background: DD.surface,
            border: `1px solid ${DD.border}`,
            borderRadius: 12,
            boxShadow: "0 1px 2px rgba(16,24,40,.05)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "32px 32px 24px",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: "#EFF4FF",
                  color: DD.primary,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                  <path d="M3 6h18" />
                  <path d="M16 10a4 4 0 0 1-8 0" />
                </svg>
              </div>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  borderRadius: 6,
                  padding: "4px 8px",
                  fontSize: 12,
                  lineHeight: "16px",
                  fontWeight: 500,
                  background: "#FEF3C7",
                  color: "#92400E",
                  border: "1px solid #FDE68A",
                }}
              >
                {t("badge")}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <h1
                style={{
                  margin: 0,
                  fontSize: 22,
                  lineHeight: "30px",
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                  color: DD.text,
                }}
              >
                {t("title")}
              </h1>
              <p
                style={{
                  margin: 0,
                  fontSize: 15,
                  lineHeight: "24px",
                  color: DD.textSubtle,
                  textWrap: "pretty",
                }}
              >
                {t("body")}
              </p>
            </div>
          </div>

          <div
            style={{
              borderTop: `1px solid ${DD.border}`,
              padding: "20px 32px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
              background: "#FAFBFC",
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                color: DD.textMuted,
              }}
            >
              {t("readyHeading")}
            </div>
            <Step n={1} title={t("step1Title")} body={t("step1Body")} />
            <Step n={2} title={t("step2Title")} body={t("step2Body")} />
          </div>

          <div
            style={{
              borderTop: `1px solid ${DD.border}`,
              padding: "16px 32px",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 13, color: DD.textSubtle }}>
              {t("questions")}{" "}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                style={{ color: DD.primary, textDecoration: "none" }}
              >
                {SUPPORT_EMAIL}
              </a>
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                style={{
                  ...button,
                  background: "#F1F5F9",
                  color: DD.text,
                  border: `1px solid ${DD.border}`,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#E5E7EB")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#F1F5F9")}
              >
                {t("contactSupport")}
              </a>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  ...button,
                  background: DD.primary,
                  color: "#FFFFFF",
                  border: "none",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = DD.primaryHover)}
                onMouseLeave={(e) => (e.currentTarget.style.background = DD.primary)}
              >
                {t("checkAgain")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
