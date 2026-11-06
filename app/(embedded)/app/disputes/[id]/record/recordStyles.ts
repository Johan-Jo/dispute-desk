/**
 * Visual constants of the dispute page, transcribed from the design
 * (Claude Design project fca59ec9…, `NewDispute.dc.html`, its script block).
 * Colours and the design-system tokens (`--dd-*`) are copied value for value;
 * nothing here is a new visual language.
 */

import type { CSSProperties } from "react";
import type { RecordRole, RecordStatus, StrengthPill, TimelineKind } from "@/lib/disputes/disputeRecord";

/** The design-system tokens the design reads (`_ds_bundle.css` `:root`). */
export const DD_TOKENS = {
  "--dd-surface": "#FFFFFF",
  "--dd-text": "#0B1220",
  "--dd-text-subtle": "#667085",
  "--dd-border": "#E5E7EB",
  "--dd-primary": "#1D4ED8",
  "--dd-success": "#22C55E",
} as CSSProperties;

export const ROLE_STYLE: Record<RecordRole | "record", { bg: string; fg: string; dot: string }> = {
  cited: { bg: "#DCFCE7", fg: "#065F46", dot: "#059669" },
  context: { bg: "#F3F4F6", fg: "#374151", dot: "#9CA3AF" },
  internal: { bg: "#FEF3C7", fg: "#78350F", dot: "#D97706" },
  unavailable: { bg: "#FEE2E2", fg: "#991B1B", dot: "#EF4444" },
  record: { bg: "#EFF4FF", fg: "#1E40AF", dot: "#1D4ED8" },
};

export const PILL_STYLE: Record<StrengthPill, [string, string]> = {
  Strong: ["#D1FAE5", "#065F46"],
  Moderate: ["#FEF3C7", "#92400E"],
  Supporting: ["#E5E7EB", "#374151"],
};

export const THEME: Record<
  RecordStatus,
  { bg: string; border: string; tileBg: string; tileFg: string; amount: string; chipBg: string; chipFg: string; glyph: string }
> = {
  open: { bg: "#F4F7FF", border: "#C9D7F5", tileBg: "#E3EBFD", tileFg: "#1D4ED8", amount: "var(--dd-text)", chipBg: "#DBEAFE", chipFg: "#1E40AF", glyph: "◷" },
  lost: { bg: "#F9FAFB", border: "var(--dd-border)", tileBg: "#E4E7EC", tileFg: "#475467", amount: "var(--dd-text)", chipBg: "#FEE2E2", chipFg: "#991B1B", glyph: "⚑" },
  closed: { bg: "#F9FAFB", border: "var(--dd-border)", tileBg: "#E4E7EC", tileFg: "#475467", amount: "var(--dd-text)", chipBg: "#F1F2F4", chipFg: "#475467", glyph: "⚑" },
  won: { bg: "#F0FDF4", border: "#BBF7D0", tileBg: "#D1FADF", tileFg: "#067647", amount: "#067647", chipBg: "#DCFCE7", chipFg: "#166534", glyph: "✓" },
};

/** [ring, ringBorder, dot, titleColour] */
export const STEP_STYLE: Record<TimelineKind, [string, string, string, string]> = {
  done: ["#F2F4F7", "#F2F4F7", "#98A2B3", "var(--dd-text)"],
  current: ["#EFF4FF", "#EFF4FF", "#1D4ED8", "#1D4ED8"],
  pending: ["#FFFFFF", "#D0D5DD", "#D0D5DD", "var(--dd-text)"],
  filed: ["#EFF4FF", "#EFF4FF", "#1D4ED8", "var(--dd-text)"],
  lost: ["#FEF3F2", "#FEF3F2", "#EF4444", "#B42318"],
  won: ["#ECFDF3", "#ECFDF3", "#22C55E", "#067647"],
};

/** [dot, bar, pillBg, pillFg] */
export const CHECK_STYLE: Record<"had" | "missing" | "none", [string, string, string, string]> = {
  had: ["var(--dd-success)", "var(--dd-success)", "#ECFDF3", "#067647"],
  missing: ["#EF4444", "#F59E9E", "#FEF3F2", "#B42318"],
  none: ["#98A2B3", "#D0D5DD", "#EEF0F3", "#475467"],
};

const TAB: CSSProperties = { padding: "12px 14px 10px", marginBottom: -1 };
export const TAB_ON: CSSProperties = { ...TAB, borderBottom: "2px solid var(--dd-primary)", color: "var(--dd-primary)", fontWeight: 500 };
export const TAB_OFF: CSSProperties = { ...TAB, borderBottom: "2px solid transparent", color: "var(--dd-text-subtle)" };
