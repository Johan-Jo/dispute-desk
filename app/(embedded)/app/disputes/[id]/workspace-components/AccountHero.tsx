"use client";

/**
 * The hero every tab opens with — transcribed from Claude Design
 * `DecidedWorkspaceMock.dc.html` (project fca59ec9…), element by element:
 * themed card, 40px icon tile, title, claim line, chip, amount tile, then the
 * account paragraph, the "as recorded in Shopify" line and the merchant-only
 * note. The design is the spec (CLAUDE.md rule 8).
 *
 * Reads the shared account (lib/disputes/disputeAccount.ts); the paragraph is
 * the joined sentences of the one fact record, so it cannot disagree with any
 * banner, row, pill or timeline step below it.
 */

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { resolveToken } from "@/lib/i18n/resolveToken";
import type { DisputeAccountVm } from "../hooks/useDisputeAccount";

/* Design THEME, plus the existing decided "lost" tone (the design has no lost state). */
const THEME = {
  won: { bg: "#F0FDF4", border: "#BBF7D0", tileBg: "#D1FADF", tileFg: "#067647", chipBg: "#DCFCE7", chipFg: "#067647", chipDot: "#22C55E", amount: "#067647" },
  open: { bg: "#F6F8FB", border: "#E8ECF2", tileBg: "#EFF4FF", tileFg: "#1D4ED8", chipBg: "#EFF4FF", chipFg: "#1D4ED8", chipDot: "#1D4ED8", amount: "#0B1220" },
  lost: { bg: "#F9FAFB", border: "#E5E7EB", tileBg: "#E4E7EC", tileFg: "#475467", chipBg: "#EEF0F3", chipFg: "#344054", chipDot: "#98A2B3", amount: "#0B1220" },
} as const;

const SUBTLE = "#667085";
const pretty = { textWrap: "pretty" } as CSSProperties;
/** Design: `clamp(0px, calc((100% - 420px) * 999), 56px)`. */
const HERO_INDENT = "clamp(0px, calc((100% - 420px) * 999), 56px)";

const ICON_PROPS = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function AccountHero({
  vm,
  size,
  product,
}: {
  vm: DisputeAccountVm;
  /** Design: 22px on Overview, 18px on Evidence and Review. */
  size: 22 | 18;
  /** Product line shown before the claim when the record has one. */
  product?: string | null;
}) {
  const t = useTranslations();
  const { page, account, fmt } = vm;
  const th = THEME[page.theme];
  const r = (tok: Parameters<typeof resolveToken>[1]) => resolveToken(t, tok) as string;
  const i = account.inputs;

  return (
    <div
      data-testid="account-hero"
      style={{
        background: th.bg,
        border: `1px solid ${th.border}`,
        borderRadius: 8,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div
          aria-hidden="true"
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            background: th.tileBg,
            color: th.tileFg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          {page.theme === "won" ? (
            <svg {...ICON_PROPS}>
              <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          ) : page.theme === "lost" ? (
            <svg {...ICON_PROPS}>
              <path d="M4 21V4" />
              <path d="M4 4h12l-2 4 2 4H4" />
            </svg>
          ) : (
            <svg {...ICON_PROPS}>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          )}
        </div>
        <div style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: size, fontWeight: 700, letterSpacing: "-0.015em", lineHeight: 1.2 }}>
            {r(page.hero.title)}
          </div>
          <div style={{ color: SUBTLE, lineHeight: 1.5, ...pretty }}>
            {product ? `${product} · ${r(page.hero.claimLine)}` : r(page.hero.claimLine)}
          </div>
          <span
            style={{
              alignSelf: "flex-start",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginTop: 2,
              padding: "2px 8px",
              borderRadius: 6,
              background: th.chipBg,
              fontSize: 11,
              fontWeight: 600,
              color: th.chipFg,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: th.chipDot }} />
            {r(page.hero.chip)}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            alignItems: "flex-end",
            flex: "none",
            marginLeft: "auto",
          }}
        >
          <span style={{ fontSize: 12, color: SUBTLE }}>{r(page.hero.amountLabel)}</span>
          <span
            style={{
              fontSize: size,
              fontWeight: 700,
              letterSpacing: "-0.015em",
              fontVariantNumeric: "tabular-nums",
              color: th.amount,
            }}
          >
            {fmt.money(i.amount, i.currency)}
          </span>
        </div>
      </div>
      <div
        style={{
          marginLeft: HERO_INDENT,
          maxWidth: 720,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <p data-testid="account-paragraph" style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: "#344054", ...pretty }}>
          {page.hero.account.map((tok) => r(tok)).join(" ")}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {page.hero.asOf ? (
            <span style={{ fontSize: 12, color: SUBTLE, lineHeight: 1.55, ...pretty }}>
              {t("disputes.overviewExtra.orderSituation.asOf", { date: fmt.date(page.hero.asOf) })}
            </span>
          ) : null}
          <span style={{ fontSize: 12, color: SUBTLE, lineHeight: 1.55, ...pretty }}>{r(page.hero.privateNote)}</span>
        </div>
      </div>
    </div>
  );
}
