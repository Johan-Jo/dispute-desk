import type { CSSProperties } from "react";

/** Shared with dashboard `RecentDisputesTable` and full disputes list — same visual shell. */
export const recentDisputesThStyle: CSSProperties = {
  padding: "10px 16px",
  fontWeight: 600,
  fontSize: "12px",
  color: "var(--p-color-text-secondary)",
  textAlign: "left",
  whiteSpace: "nowrap",
};

export const recentDisputesTdStyle: CSSProperties = {
  padding: "14px 16px",
  verticalAlign: "middle",
};

export const recentDisputesOrderLinkStyle: CSSProperties = {
  fontWeight: 600,
  color: "#4F46E5",
  textDecoration: "none",
};

export const recentDisputesViewDetailsLinkStyle: CSSProperties = {
  color: "#4F46E5",
  fontSize: "13px",
  textDecoration: "none",
  whiteSpace: "nowrap",
};
