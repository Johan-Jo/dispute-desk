/**
 * Styles for the Defence Package PDF — bank-facing representment.
 *
 * Visual language: navy primary, slate text, formal serif-ish sans (Helvetica),
 * generous vertical rhythm, dark-header tables with striped rows, italic
 * section-thesis blockquotes with a navy left border.
 */

import { StyleSheet } from "@react-pdf/renderer";

const NAVY = "#1F2D3D";
const NAVY_DEEP = "#0F1B2D";
const NAVY_ACCENT = "#1D4ED8";
const SLATE_TEXT = "#0F172A";
const MUTED_TEXT = "#475569";
const HAIRLINE = "#E2E8F0";
const STRIPE_BG = "#F8FAFC";

export const styles = StyleSheet.create({
  page: {
    padding: 56,
    paddingTop: 64,
    paddingBottom: 64,
    fontFamily: "Helvetica",
    fontSize: 10.5,
    color: SLATE_TEXT,
    lineHeight: 1.55,
  },

  // ─── Cover ───────────────────────────────────────────────────────────
  coverPage: {
    padding: 64,
    paddingTop: 96,
    fontFamily: "Helvetica",
    color: SLATE_TEXT,
  },
  coverEyebrow: {
    fontSize: 9,
    color: MUTED_TEXT,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 10,
    textAlign: "center",
  },
  coverTitle: {
    fontSize: 28,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
    marginBottom: 8,
    textAlign: "center",
  },
  coverDisputeId: {
    fontSize: 14,
    color: NAVY_ACCENT,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
    textAlign: "center",
  },
  coverSubtitle: {
    fontSize: 11,
    color: MUTED_TEXT,
    marginBottom: 36,
    textAlign: "center",
  },
  coverDivider: {
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
    marginBottom: 24,
  },
  coverFieldList: {
    paddingHorizontal: 16,
  },
  coverFieldRow: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: HAIRLINE,
  },
  coverFieldLabel: {
    width: 150,
    fontSize: 10,
    color: MUTED_TEXT,
    fontFamily: "Helvetica-Bold",
  },
  coverFieldValue: {
    flex: 1,
    fontSize: 10.5,
    color: SLATE_TEXT,
  },

  // ─── Section headings ────────────────────────────────────────────────
  h1: {
    fontSize: 15,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
    marginTop: 22,
    marginBottom: 10,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  h2: {
    fontSize: 11.5,
    fontFamily: "Helvetica-Bold",
    color: SLATE_TEXT,
    marginTop: 12,
    marginBottom: 6,
  },

  // ─── Section thesis (deterministic blockquote at the top of each
  //     section). Italic, navy left border, neutral background, no
  //     LLM-authored content — drawn from a fixed per-section template
  //     keyed by reasonCodeModule + packageMode. ─────────────────────
  thesisBox: {
    backgroundColor: "#F1F5F9",
    borderLeftWidth: 3,
    borderLeftColor: NAVY_ACCENT,
    padding: 12,
    paddingLeft: 14,
    marginBottom: 12,
  },
  thesisText: {
    fontSize: 10,
    color: NAVY_DEEP,
    fontStyle: "italic",
    lineHeight: 1.55,
  },

  // ─── Body prose ──────────────────────────────────────────────────────
  paragraph: {
    fontSize: 10.5,
    color: SLATE_TEXT,
    marginBottom: 8,
    textAlign: "justify",
  },
  paragraphLast: {
    fontSize: 10.5,
    color: SLATE_TEXT,
    marginBottom: 4,
    textAlign: "justify",
  },
  mutedNote: {
    fontSize: 8.5,
    color: "#94A3B8",
    fontStyle: "italic",
    marginTop: 6,
    marginBottom: 4,
  },

  // ─── Bullet list ─────────────────────────────────────────────────────
  bulletRow: {
    flexDirection: "row",
    marginBottom: 4,
    paddingLeft: 8,
  },
  bulletDot: {
    width: 10,
    fontSize: 10,
    color: NAVY_ACCENT,
  },
  bulletText: {
    flex: 1,
    fontSize: 10,
    color: SLATE_TEXT,
    lineHeight: 1.5,
  },
  bulletTimestamp: {
    fontFamily: "Helvetica-Bold",
    color: NAVY_DEEP,
  },

  // ─── Tables ──────────────────────────────────────────────────────────
  table: {
    width: "100%",
    marginBottom: 12,
    borderWidth: 0.5,
    borderColor: HAIRLINE,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: NAVY,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  tableHeaderCell: {
    flex: 1,
    fontSize: 9.5,
    color: "#FFFFFF",
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.3,
  },
  tableHeaderCellRight: {
    flex: 1,
    fontSize: 9.5,
    color: "#FFFFFF",
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.3,
    textAlign: "right",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: HAIRLINE,
  },
  tableRowStripe: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: HAIRLINE,
    backgroundColor: STRIPE_BG,
  },
  tableCell: {
    flex: 1,
    fontSize: 9.5,
    color: SLATE_TEXT,
    lineHeight: 1.45,
  },
  tableCellRight: {
    flex: 1,
    fontSize: 9.5,
    color: SLATE_TEXT,
    textAlign: "right",
  },
  tableCellLabel: {
    flex: 1,
    fontSize: 9.5,
    color: MUTED_TEXT,
    fontFamily: "Helvetica-Bold",
  },
  tableCellValue: {
    flex: 1.6,
    fontSize: 9.5,
    color: SLATE_TEXT,
  },

  // ─── Footer (fixed) ──────────────────────────────────────────────────
  footer: {
    position: "absolute",
    bottom: 28,
    left: 56,
    right: 56,
    fontSize: 8,
    color: "#94A3B8",
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: HAIRLINE,
    paddingTop: 8,
  },
  footerLeft: { fontSize: 8, color: "#94A3B8" },
  footerRight: { fontSize: 8, color: "#94A3B8" },

  // ─── Conclusion call-out ─────────────────────────────────────────────
  conclusionBox: {
    backgroundColor: "#F8FAFC",
    borderWidth: 0.5,
    borderColor: HAIRLINE,
    padding: 12,
    marginTop: 4,
    marginBottom: 8,
  },
});
