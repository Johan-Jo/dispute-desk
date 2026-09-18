"use client";

/**
 * Renders the active admin→merchant message for this shop, if any.
 *
 * Ops composes these on the admin shop-detail page (Messages card).
 * Typical use: we see upside on an account but have no working contact
 * channel, so we ask — inside the app — for an email or phone number,
 * and the answer is mailed to the ops address.
 *
 * Visual spec: "Red top alert banner" handoff (Claude Design),
 * `Dashboard.dc.html` — a white card with a solid #B42318 header bar,
 * #FCA5A5 border, and a red-shadow lift. Transcribed literally from the
 * design rather than expressed as a Polaris <Banner>, because Polaris
 * has no solid-header banner variant and the design's whole point is
 * that this outshouts the ordinary tonal banners around it.
 *
 * Deliberately NOT a blocking modal. A merchant who isn't interested
 * dismisses it once and it stays gone (dismissal is server-side, so it
 * holds across their devices). A modal that intercepted the session
 * would be hostile to the merchant and a Shopify App Store review risk.
 *
 * Message copy is admin-authored free text (see lib/merchantMessages/
 * types.ts for why it isn't tokenized); only the form chrome and the
 * helper/confirmation lines are localized.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { ActiveMerchantMessage } from "@/lib/merchantMessages/types";

/* Palette lifted verbatim from Dashboard.dc.html. */
const RED_HEADER = "#B42318";
const RED_BORDER = "#FCA5A5";
const RED_SHADOW = "0 8px 20px -14px rgba(180,35,24,0.5)";
const TITLE_ON_RED = "#FFFFFF";
const DISMISS_IDLE = "#FEE4E2";
const BODY_STRONG = "#0B1220";
const BODY_MUTED = "#475467";
const HELPER = "#667085";
const FIELD_BORDER = "#E5E7EB";
/* DisputeDeskUI.Button variant="danger": bg #EF4444, hover #DC2626. */
const BTN_DANGER = "#EF4444";
const BTN_DANGER_HOVER = "#DC2626";
/* Confirmation state. The design covers the ask, not the acknowledgement;
 * these follow the same success family the admin card already uses. */
const OK_BG = "#F0FDF4";
const OK_BORDER = "#BBF7D0";
const OK_TEXT = "#166534";
const OK_MUTED = "#15803D";

/** Matches the design-system TextField: h-40px, 8px radius, 14px text. */
const fieldStyle: React.CSSProperties = {
  width: "100%",
  height: 40,
  padding: "0 12px",
  border: `1px solid ${FIELD_BORDER}`,
  borderRadius: 8,
  fontSize: 14,
  fontFamily: "inherit",
  color: BODY_STRONG,
  outline: "none",
  boxSizing: "border-box",
};

export function DashboardMerchantMessageBanner() {
  const t = useTranslations();
  const [message, setMessage] = useState<ActiveMerchantMessage | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [hoverDismiss, setHoverDismiss] = useState(false);
  const [hoverSend, setHoverSend] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/message")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setMessage(d.message ?? null);
      })
      .catch(() => {
        /* a missing banner is not worth surfacing an error for */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!message || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    fetch("/api/dashboard/message/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: message.id }),
    }).catch(() => {
      /* swallow — next load re-offers it, which is the safe direction */
    });
  };

  /* The design enables Send on a plausible email OR ~7 digits of phone:
   * either channel alone is a complete answer. */
  const canSend =
    /\S+@\S+\.\S+/.test(email) || phone.replace(/\D/g, "").length >= 7;

  const submit = async () => {
    if (!canSend || submitting) return;
    setSubmitting(true);
    setError(false);
    try {
      const res = await fetch("/api/dashboard/message/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id, name, email, phone }),
      });
      if (!res.ok) throw new Error("submit failed");
      setSubmitted(true);
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  };

  const helperText = error
    ? t("dashboard.merchantMessage.error")
    : t("dashboard.merchantMessage.helper");

  return (
    <div
      style={{
        background: "#FFFFFF",
        border: `1px solid ${RED_BORDER}`,
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: RED_SHADOW,
        marginBottom: 20,
      }}
    >
      {/* Solid red header bar: warning triangle, title, dismiss. */}
      <div
        style={{
          background: RED_HEADER,
          padding: "12px 18px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span style={{ flex: "0 0 auto", color: TITLE_ON_RED, display: "flex" }}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </span>
        <span
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: TITLE_ON_RED,
          }}
        >
          {message.title}
        </span>
        <button
          type="button"
          onClick={dismiss}
          onMouseEnter={() => setHoverDismiss(true)}
          onMouseLeave={() => setHoverDismiss(false)}
          aria-label={t("dashboard.merchantMessage.dismiss")}
          style={{
            flex: "0 0 auto",
            width: 26,
            height: 26,
            border: 0,
            borderRadius: 7,
            background: hoverDismiss ? "rgba(255,255,255,0.2)" : "transparent",
            color: hoverDismiss ? "#FFFFFF" : DISMISS_IDLE,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* White body: message, optional contact form, helper line. */}
      <div
        style={{
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {/* pre-wrap, not the HTML default: the admin composes this in a
         *  textarea, so the paragraph breaks they type are meaningful —
         *  a bilingual message needs its two halves to stay apart.
         *  Long lines still wrap normally. */}
        <p
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 600,
            lineHeight: 1.5,
            color: BODY_STRONG,
            whiteSpace: "pre-wrap",
          }}
        >
          {message.body}
        </p>

        {message.askForContact && submitted ? (
          /* Sent: the form is gone entirely and replaced by a green
           * confirmation panel echoing what we received, so the state
           * reads as finished rather than as a filled-in form. */
          <div
            style={{
              background: OK_BG,
              border: `1px solid ${OK_BORDER}`,
              borderRadius: 10,
              padding: "14px 16px",
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
            }}
          >
            <span style={{ flex: "0 0 auto", color: OK_TEXT, marginTop: 1 }}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="8.5 12.5 11 15 15.5 9.5" />
              </svg>
            </span>
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  fontWeight: 600,
                  color: OK_TEXT,
                }}
              >
                {t("dashboard.merchantMessage.thanksTitle")}
              </p>
              <p
                style={{
                  margin: "2px 0 0",
                  fontSize: 14,
                  lineHeight: 1.5,
                  color: OK_MUTED,
                }}
              >
                {t("dashboard.merchantMessage.thanksBody")}
              </p>
              {/* Echo what we actually received — proof it landed, and a
               * chance to spot a typo before we try to reach them. */}
              <p
                style={{
                  margin: "8px 0 0",
                  fontSize: 13,
                  color: OK_MUTED,
                  wordBreak: "break-word",
                }}
              >
                {[name.trim(), email.trim(), phone.trim()]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </div>
        ) : message.askForContact ? (
          <>
            <p
              style={{
                margin: "-8px 0 0",
                fontSize: 14,
                lineHeight: 1.5,
                color: BODY_MUTED,
              }}
            >
              {t("dashboard.merchantMessage.subtitle")}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {/* Name first: these messages ask who is responsible for the
               *  account, so it is the field that answers the question.
               *  It is not part of canSend — a name with no channel is
               *  not reachable, so email-or-phone still gates Send. */}
              <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                <input
                  type="text"
                  autoComplete="name"
                  placeholder={t("dashboard.merchantMessage.nameLabel")}
                  aria-label={t("dashboard.merchantMessage.nameLabel")}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError(false);
                  }}
                  style={fieldStyle}
                />
              </div>
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <input
                  type="email"
                  autoComplete="email"
                  placeholder={t("dashboard.merchantMessage.emailLabel")}
                  aria-label={t("dashboard.merchantMessage.emailLabel")}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError(false);
                  }}
                  style={fieldStyle}
                />
              </div>
              <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                <input
                  type="tel"
                  autoComplete="tel"
                  placeholder={t("dashboard.merchantMessage.phoneLabel")}
                  aria-label={t("dashboard.merchantMessage.phoneLabel")}
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setError(false);
                  }}
                  style={fieldStyle}
                />
              </div>
              <button
                type="button"
                onClick={submit}
                disabled={!canSend || submitting}
                onMouseEnter={() => setHoverSend(true)}
                onMouseLeave={() => setHoverSend(false)}
                style={{
                  flex: "0 0 auto",
                  height: 40,
                  padding: "0 24px",
                  minWidth: 110,
                  border: 0,
                  borderRadius: 8,
                  background:
                    hoverSend && canSend ? BTN_DANGER_HOVER : BTN_DANGER,
                  color: "#FFFFFF",
                  fontSize: 14,
                  fontWeight: 500,
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                  cursor: canSend ? "pointer" : "not-allowed",
                  opacity: canSend ? 1 : 0.5,
                  transition: "background 120ms",
                }}
              >
                {submitting
                  ? t("dashboard.merchantMessage.sending")
                  : t("dashboard.merchantMessage.cta")}
              </button>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: HELPER }}>
              {helperText}
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
