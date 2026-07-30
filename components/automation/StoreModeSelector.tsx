"use client";

/**
 * The store-wide handling switch: Auto-pilot vs Review everything.
 *
 * Two selectable cards with radio semantics, rendered ONLY by the setup
 * wizard's handling step. (The docstring used to say "shared by /app/rules and
 * the setup wizard" — that stopped being true when the Automation page was
 * rewritten as its own transcription of `Automation Rules Page.dc.html`, which
 * carries its own inline mode cards. Corrected 2026-07-30.)
 *
 * LAYOUT IS A TRANSCRIPTION of `Onboarding Handling Step.dc.html` (Claude
 * Design project "Dispute Desk Design Restoration"). Every colour, radius,
 * spacing value, icon and border treatment below is read off that file — the
 * selected-state ring (`0 0 0 3px <accent>1f`), the 28px icon chip that fills
 * with the accent when chosen, the 18px tick that sits hard right via
 * `margin-left: auto`, and the footnote separated by a 1px dashed #DDE3EA rule.
 *
 * Polaris is not used here. The design specifies exact type sizes (14.5px
 * titles, 13px body, 12.5px footnotes) that Polaris' scale does not offer, and
 * approximating them is how a transcription stops being one.
 *
 * COPY: the design splits each card into a lead and a footnote. The catalog
 * had one blob per mode, so `modeAutoLead` / `modeAutoNote` were added and
 * `modeAutoDesc` kept intact for /app/rules. `deadlineSubmitCopyTruth` asserts
 * the lead is a prefix of the full description so the two cannot drift.
 */

import type { StoreAutomationMode } from "@/lib/rules/storeAutomation";

interface StoreModeSelectorProps {
  value: StoreAutomationMode;
  onChange: (mode: StoreAutomationMode) => void;
  /** Translator bound to the `rules` namespace. */
  t: (key: string) => string;
  /** Plan-gated or saving — renders non-interactive but still readable. */
  disabled?: boolean;
}

/** Auto-pilot: the lightning bolt, matching the step's own header icon. */
const BOLT_PATH = "M11 1L5 11h4v8l6-10h-4V1z";

function TickIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

interface ModeCardProps {
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  /** Accent drives border, ring, icon chip fill and tick fill. */
  accent: string;
  /** Card background when selected. */
  tint: string;
  icon: React.ReactNode;
  /** Small glyph on the footnote line. */
  noteIcon: React.ReactNode;
  title: string;
  badge?: string;
  lead: string;
  note: string;
}

function ModeCard({
  selected,
  disabled,
  onSelect,
  accent,
  tint,
  icon,
  noteIcon,
  title,
  badge,
  lead,
  note,
}: ModeCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      style={{
        textAlign: "left",
        font: "inherit",
        cursor: disabled ? "not-allowed" : "pointer",
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 9,
        opacity: disabled ? 0.6 : 1,
        border: selected ? `1.5px solid ${accent}` : "1px solid #E1E3E5",
        background: selected ? tint : "#FFFFFF",
        boxShadow: selected ? `0 0 0 3px ${accent}1f` : "none",
        transition:
          "box-shadow 150ms ease, border-color 150ms ease, background 150ms ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transition: "all 150ms ease",
            background: selected ? accent : "#F1F2F3",
            color: selected ? "#FFFFFF" : "#6D7175",
          }}
        >
          {icon}
        </span>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</span>
        {badge ? (
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
            {badge}
          </span>
        ) : null}
        <span
          style={{
            marginLeft: "auto",
            width: 18,
            height: 18,
            borderRadius: 999,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            color: "#FFFFFF",
            transition: "all 150ms ease",
            background: selected ? accent : "transparent",
            border: `1.5px solid ${selected ? accent : "#D1D3D5"}`,
            opacity: selected ? 1 : 0.35,
          }}
        >
          <TickIcon />
        </span>
      </div>

      <span
        style={{
          fontSize: 13,
          lineHeight: 1.5,
          color: "#5C6570",
          textWrap: "pretty",
        }}
      >
        {lead}
      </span>

      <span
        style={{
          fontSize: 12.5,
          lineHeight: 1.45,
          color: "#6D7175",
          display: "flex",
          gap: 7,
          alignItems: "flex-start",
          borderTop: "1px dashed #DDE3EA",
          paddingTop: 9,
          textWrap: "pretty",
        }}
      >
        {noteIcon}
        {note}
      </span>
    </button>
  );
}

export function StoreModeSelector({
  value,
  onChange,
  t,
  disabled = false,
}: StoreModeSelectorProps) {
  return (
    <div
      role="radiogroup"
      aria-label={t("modeSectionTitle")}
      data-r="modes"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 12,
      }}
    >
      <ModeCard
        selected={value === "auto"}
        disabled={disabled}
        onSelect={() => onChange("auto")}
        accent="#22C55E"
        tint="#F6FDF9"
        icon={
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d={BOLT_PATH} />
          </svg>
        }
        noteIcon={
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#94A3B8"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0, marginTop: 1 }}
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4l2.5 2" />
          </svg>
        }
        title={t("modeAutoTitle")}
        badge={t("modeAutoBadge")}
        lead={t("modeAutoLead")}
        note={t("modeAutoNote")}
      />
      <ModeCard
        selected={value === "review"}
        disabled={disabled}
        onSelect={() => onChange("review")}
        accent="#0EA5E9"
        tint="#F4FBFE"
        icon={
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" />
            <circle cx="12" cy="12" r="2.5" />
          </svg>
        }
        noteIcon={
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#94A3B8"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0, marginTop: 1 }}
            aria-hidden="true"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        }
        title={t("modeReviewTitle")}
        lead={t("modeReviewLead")}
        note={t("modeReviewNote")}
      />
    </div>
  );
}
