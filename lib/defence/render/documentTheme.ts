/**
 * Colours of the "Chargeback Response v2" design, shared by the PDF
 * (`lib/defence/pdf/styles.ts`) and the in-app preview so both draw the same
 * palette. Plain data: safe to import in client components.
 */

export const DOCUMENT_COLORS = {
  accent: "#8B1D41",
  accentSoft: "#F9EEF2",
  accentLine: "#F0D3DD",
  ink: "#111827",
  body: "#1F2937",
  muted: "#6B7280",
  hairline: "#E5E7EB",
  zebra: "#F5F7FA",
  greenBg: "#DCFCE7",
  greenBorder: "#BBF7D0",
  greenText: "#166534",
  greenDot: "#22C55E",
  blueBg: "#E0F2FE",
  blueBorder: "#BAE6FD",
  blueText: "#075985",
  greyBg: "#F3F4F6",
  greyBorder: "#E5E7EB",
  greyText: "#374151",
} as const;
