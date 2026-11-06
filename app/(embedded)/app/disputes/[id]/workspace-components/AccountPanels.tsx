"use client";

/**
 * The Evidence-tab and Review-tab bodies of a decided dispute, transcribed from
 * Claude Design `DecidedWorkspaceMock.dc.html` (project fca59ec9…): the
 * "Evidence in your defence package" card with its role groups, the "Missing or
 * weak evidence" card, the "Complete Defence Package" card with the pack line
 * and the "Inclusion review" groups. Every sentence is read from the one
 * account (lib/disputes/accountPage.ts) — the Evidence and Review tabs list the
 * same rows because they are built from the same page model.
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { resolveToken } from "@/lib/i18n/resolveToken";
import type { I18nToken } from "@/lib/i18n/token";
import type { AccountEvidenceGroup, AccountPage, EvidenceGroupKind } from "@/lib/disputes/accountPage";

const pretty = { textWrap: "pretty" } as const;

/** Design GROUP table: chip colours for the Evidence tab, accents for the Review tab. */
const GROUP: Record<
  EvidenceGroupKind,
  {
    title: I18nToken;
    caption: I18nToken;
    chipBg: string;
    chipText: string;
    dot: string;
    inc: {
      title: I18nToken;
      tag: I18nToken;
      helper: I18nToken;
      accent: string;
      countBg: string;
      countColor: string;
      tagBg: string;
      tagColor: string;
      glyph: string;
    };
  }
> = {
  positive: {
    title: { key: "disputes.evidenceTab.sections.used.groupUsedInBankArgument" },
    caption: { key: "disputes.evidenceTab.sections.used.groupUsedInBankArgumentCaption" },
    chipBg: "#DCFCE7",
    chipText: "#065F46",
    dot: "#059669",
    inc: {
      title: { key: "disputes.reviewTab.inclusion.groups.usedAsBankArgument" },
      tag: { key: "disputes.reviewTab.inclusion.groupTags.usedAsBankArgument" },
      helper: { key: "disputes.reviewTab.inclusion.groupHelpers.usedAsBankArgument" },
      accent: "#2BAA68",
      countBg: "#CDFEE1",
      countColor: "#0C5132",
      tagBg: "#E3FBE9",
      tagColor: "#0C5132",
      glyph: "✓",
    },
  },
  context: {
    title: { key: "disputes.evidenceTab.sections.used.groupContextOnly" },
    caption: { key: "disputes.evidenceTab.sections.used.groupContextOnlyCaption" },
    chipBg: "#F3F4F6",
    chipText: "#374151",
    dot: "#9CA3AF",
    inc: {
      title: { key: "disputes.reviewTab.inclusion.groups.contextOnly" },
      tag: { key: "disputes.reviewTab.inclusion.groupTags.contextOnly" },
      helper: { key: "disputes.reviewTab.inclusion.groupHelpers.contextOnly" },
      accent: "#8A8A8A",
      countBg: "#E3E3E3",
      countColor: "#303030",
      tagBg: "#F1F1F1",
      tagColor: "#4A4A4A",
      glyph: "–",
    },
  },
  pack: {
    title: { key: "disputes.account.group.pack.title" },
    caption: { key: "disputes.account.group.pack.caption" },
    chipBg: "#F3F4F6",
    chipText: "#374151",
    dot: "#9CA3AF",
    inc: {
      title: { key: "disputes.account.group.pack.title" },
      tag: { key: "disputes.account.group.pack.tag" },
      helper: { key: "disputes.account.group.pack.caption" },
      accent: "#8A8A8A",
      countBg: "#E3E3E3",
      countColor: "#303030",
      tagBg: "#F1F1F1",
      tagColor: "#4A4A4A",
      glyph: "–",
    },
  },
};

function useR() {
  const t = useTranslations();
  return (tok: I18nToken) => resolveToken(t, tok) as string;
}

/** "Evidence in your defence package" + "Missing or weak evidence". */
export function AccountEvidenceBody({ page }: { page: AccountPage }) {
  const t = useTranslations();
  const r = useR();
  const groups = page.evidence.groups;
  const missing = page.evidence.missing;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "#FFFFFF", border: "1px solid #E1E3E5", borderRadius: 12, padding: 20 }}>
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "#202223", margin: 0, lineHeight: 1.3 }}>
            {t("disputes.evidenceTab.sections.used.title")}
          </h2>
          {page.evidence.explainer ? (
            <p style={{ fontSize: 13, color: "#6D7175", lineHeight: 1.5, margin: "4px 0 0", ...pretty }}>
              {r(page.evidence.explainer)}
            </p>
          ) : null}
        </div>
        {groups.map((g, gi) => {
          const meta = GROUP[g.kind];
          const first = gi === 0;
          return (
            <div
              key={g.kind}
              style={{
                paddingTop: first ? 0 : 12,
                marginTop: first ? 0 : 16,
                borderTop: first ? 0 : "1px solid #E1E3E5",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "3px 10px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 600,
                    background: meta.chipBg,
                    color: meta.chipText,
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.dot }} />
                  {r(meta.title)} <span style={{ fontVariantNumeric: "tabular-nums" }}>{g.rows.length}</span>
                </span>
              </div>
              <p style={{ fontSize: 12.5, color: "#6D7175", lineHeight: 1.4, margin: "0 0 12px", ...pretty }}>
                {r(meta.caption)}
              </p>
              {g.rows.map((row) => (
                <div key={row.field} style={{ padding: "12px 0", borderTop: "1px dashed #EBEBEB" }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "#202223", lineHeight: 1.4, margin: 0, ...pretty }}>
                    {row.title}
                  </p>
                  {row.desc ? (
                    <p style={{ fontSize: 12.5, color: "#4B5563", lineHeight: 1.5, margin: "4px 0 0", ...pretty }}>
                      {r(row.desc)}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {missing.length > 0 ? (
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: 12,
            boxShadow: "0 0 0 1px rgba(0,0,0,0.08), 0 1px 0 rgba(26,26,26,0.07)",
            padding: 16,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <h2 style={{ margin: "0 0 8px", fontSize: 14, lineHeight: "20px", fontWeight: 650, color: "#303030" }}>
            {t("disputes.evidenceTab.sections.missing.title")}
          </h2>
          {missing.map((m) => (
            <p
              key={m.field}
              style={{
                margin: 0,
                padding: "12px 0",
                borderTop: "1px solid #EBEBEB",
                fontSize: 13,
                lineHeight: "20px",
                color: "#303030",
                ...pretty,
              }}
            >
              {m.kind === "fact"
                ? `${m.prefix ? r(m.prefix) : ""}${r(m.fact)}${m.suffix ? ` ${r(m.suffix)}` : ""}`
                : `${m.title}: ${m.why}`}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function IncGroup({ g, r }: { g: AccountEvidenceGroup; r: (t: I18nToken) => string }) {
  const meta = GROUP[g.kind].inc;
  return (
    <div style={{ position: "relative", borderTop: "1px solid #E1E3E5", padding: "18px 20px 18px 28px" }}>
      <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 4, background: meta.accent }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 13, lineHeight: "20px", fontWeight: 650, color: "#303030" }}>{r(meta.title)}</h3>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 22,
            height: 20,
            padding: "0 7px",
            borderRadius: 10,
            background: meta.countBg,
            color: meta.countColor,
            fontSize: 11,
            fontWeight: 600,
            boxSizing: "border-box",
          }}
        >
          {g.rows.length}
        </span>
        <span
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 22,
            padding: "0 10px",
            borderRadius: 11,
            background: meta.tagBg,
            color: meta.tagColor,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", opacity: 0.85 }} />
          {r(meta.tag)}
        </span>
      </div>
      <p style={{ margin: "6px 0 14px", maxWidth: 680, fontSize: 12, lineHeight: "16px", color: "#616161", ...pretty }}>
        {r(meta.helper)}
      </p>
      {g.rows.map((row, i) => (
        <div
          key={row.field}
          style={{
            display: "grid",
            gridTemplateColumns: "22px minmax(0, 1fr)",
            gap: 14,
            alignItems: "start",
            padding: i === 0 ? "6px 0 12px" : "12px 0",
            borderTop: i === 0 ? 0 : "1px dashed #E1E3E5",
          }}
        >
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: meta.accent,
              color: "#FFFFFF",
              marginTop: 1,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {meta.glyph}
          </span>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "#202223", lineHeight: "18px" }}>{row.title}</div>
            {row.desc ? (
              <div style={{ fontSize: 12.5, color: "#4A4A4A", lineHeight: "18px", marginTop: 3, ...pretty }}>
                {r(row.desc)}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/** "Complete Defence Package" (pack line) + "Inclusion review". */
export function AccountReviewBody({ page }: { page: AccountPage }): ReactNode {
  const t = useTranslations();
  const r = useR();
  const groups = page.review.groups;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        style={{
          background: "#F6F6F7",
          border: "1px solid #E1E3E5",
          borderRadius: 12,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: "#202223", margin: "0 0 6px", lineHeight: 1.3 }}>
            {t("disputes.completeDefencePackage.headingMain")}
          </h2>
          <p style={{ fontSize: 13, color: "#6D7175", margin: 0, lineHeight: 1.55, ...pretty }}>
            {t.rich("disputes.reviewTab.package.cardHelp", { b: (chunks) => <strong>{chunks}</strong> })}
          </p>
        </div>
        {page.review.packLine ? (
          <div
            style={{
              background: "#FFFFFF",
              border: "1px solid #E1E3E5",
              borderRadius: 8,
              padding: "14px 16px",
              fontSize: 13,
              lineHeight: 1.55,
              color: "#303030",
              ...pretty,
            }}
          >
            {r(page.review.packLine)}
          </div>
        ) : null}
      </div>
      {groups.length > 0 ? (
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: 12,
            boxShadow: "0 0 0 1px rgba(0,0,0,0.08), 0 1px 0 rgba(26,26,26,0.07)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <h2 style={{ margin: 0, fontSize: 20, lineHeight: "24px", fontWeight: 650, color: "#303030" }}>
              {t("disputes.reviewTab.inclusion.title")}
            </h2>
            <p style={{ margin: 0, fontSize: 12, lineHeight: "16px", color: "#616161", ...pretty }}>
              {t("disputes.reviewTab.inclusion.subtitle")}
            </p>
          </div>
          {groups.map((g) => (
            <IncGroup key={g.kind} g={g} r={r} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
