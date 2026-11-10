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
  "--dd-text-muted": "#64748B",
  "--dd-bg": "#F6F8FB",
  "--dd-warning": "#F59E0B",
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

/**
 * The hero panel's three tones, transcribed from the design (`Dispute Detail.dc.html`, `TONES`):
 * blue while open, green when won, gray when lost or closed. `chipBg/chipFg/chipBorder` are the design
 * system Badge variants: primary (open), success (won), danger (lost), default (closed).
 */
export const THEME: Record<
  RecordStatus,
  { bg: string; border: string; icon: string; amount: string; chipBg: string; chipFg: string; chipBorder: string }
> = {
  open: { bg: "#EEF3FF", border: "#D6E0FB", icon: "var(--dd-primary)", amount: "var(--dd-text)", chipBg: "#DBEAFE", chipFg: "#1E3A8A", chipBorder: "#BFDBFE" },
  lost: { bg: "#F8FAFC", border: "var(--dd-border)", icon: "#475467", amount: "var(--dd-text)", chipBg: "#FEE2E2", chipFg: "#991B1B", chipBorder: "#FECACA" },
  closed: { bg: "#F8FAFC", border: "var(--dd-border)", icon: "#475467", amount: "var(--dd-text)", chipBg: "#F1F5F9", chipFg: "#64748B", chipBorder: "#E5E7EB" },
  won: { bg: "#ECFDF3", border: "#B7EBCB", icon: "#15803D", amount: "#15803D", chipBg: "#DCFCE7", chipFg: "#166534", chipBorder: "#BBF7D0" },
};

/** Design system Badge variants (`DisputeDeskUI.Badge`): every badge has a 1px border, 4px 8px padding, 12px/500, radius 6. */
export const BADGE: Record<"warning" | "primary" | "default" | "success" | "danger", { bg: string; fg: string; border: string }> = {
  warning: { bg: "#FEF3C7", fg: "#92400E", border: "#FDE68A" },
  primary: { bg: "#DBEAFE", fg: "#1E3A8A", border: "#BFDBFE" },
  default: { bg: "#F1F5F9", fg: "#64748B", border: "#E5E7EB" },
  success: { bg: "#DCFCE7", fg: "#166534", border: "#BBF7D0" },
  danger: { bg: "#FEE2E2", fg: "#991B1B", border: "#FECACA" },
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

/* No negative margin: it made the tab bar scroll vertically (a scrollbar on Windows). The bar draws its 1px line as a background at the bottom of the padding box instead; the active tab's 2px border covers it, so the look is unchanged. */
const TAB: CSSProperties = { padding: "16px 12px 14px", marginBottom: 0, fontSize: 14 };
export const TAB_ON: CSSProperties = { ...TAB, borderBottom: "2px solid var(--dd-primary)", color: "var(--dd-primary)", fontWeight: 600 };
export const TAB_OFF: CSSProperties = { ...TAB, borderBottom: "2px solid transparent", color: "var(--dd-text-subtle)", fontWeight: 500 };
