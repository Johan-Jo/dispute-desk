/**
 * Styles for the Defence Package PDF — bank-facing representment.
 *
 * Visual language: navy primary, slate text, formal serif-ish sans (Helvetica),
 * generous vertical rhythm, dark-header tables with striped rows, italic
 * section-thesis blockquotes with a navy left border.
 */

import { StyleSheet } from "@react-pdf/renderer";

// Neutral palette with a single burgundy accent. Iteration history:
//   v1 (1b631ef) — navy + bright-blue (#1F2D3D / #0F1B2D / #1D4ED8).
//   v2 (this file, earlier) — pure greys + black; rejected as too dull.
//   v3 (now) — same neutral base, but one warm accent (burgundy #7A1F2B)
//   used sparingly on the thesis left border, bullet dots, and the cover
//   dispute ID. Burgundy reads as "classic legal document" rather than
//   "SaaS dashboard"; it does not return us to the rejected blue family.
//   Variable names kept for minimal blast radius; values are greys + one
//   accent.
const NAVY = "#1F1F1F";        // near-black — table header bg, h1 color
const NAVY_DEEP = "#0F0F0F";   // pure ink — thesisText body, bulletTimestamp
const NAVY_ACCENT = "#7A1F2B"; // burgundy accent — thesis left border, bullet dot, dispute id
const SLATE_TEXT = "#0F0F0F";  // body text — pure ink
const MUTED_TEXT = "#6B7280";  // captions, labels, footer
const HAIRLINE = "#E5E5E5";    // borders, dividers
const STRIPE_BG = "#F5F5F5";   // zebra row bg

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
    backgroundColor: "#F2F2F2",
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
    color: "#9CA3AF",
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
  /**
   * The clickable tracking link inside an Evidence Basis value cell.
   * Underlined and coloured so a reviewer can SEE it is clickable — an
   * un-styled link in a PDF is indistinguishable from the text around it,
   * and a control nobody notices is a control nobody uses.
   */
  tableCellLink: {
    fontSize: 9.5,
    color: NAVY_ACCENT,
    textDecoration: "underline",
  },

  // ─── Footer (fixed) ──────────────────────────────────────────────────
  footer: {
    position: "absolute",
    bottom: 28,
    left: 56,
    right: 56,
    fontSize: 8,
    color: "#9CA3AF",
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: HAIRLINE,
    paddingTop: 8,
  },
  footerLeft: { fontSize: 8, color: "#9CA3AF" },
  footerRight: { fontSize: 8, color: "#9CA3AF" },

  // ─── Conclusion call-out ─────────────────────────────────────────────
  conclusionBox: {
    backgroundColor: "#F5F5F5",
    borderWidth: 0.5,
    borderColor: HAIRLINE,
    padding: 12,
    marginTop: 4,
    marginBottom: 8,
  },
});
