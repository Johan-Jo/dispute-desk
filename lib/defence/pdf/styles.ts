/**
 * Styles for the Defence Package PDF.
 *
 * Distinct from the existing pack PDF (`lib/packs/pdf/styles.ts`) — the
 * defence document is bank-facing (not internal diagnostic), so styling
 * targets a formal-representment look. Helvetica throughout, single-blue
 * accent, conservative spacing.
 */

import { StyleSheet } from "@react-pdf/renderer";

export const styles = StyleSheet.create({
  page: {
    padding: 48,
    paddingTop: 56,
    paddingBottom: 56,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#0F172A",
    lineHeight: 1.55,
  },

  // Cover
  coverPage: {
    padding: 60,
    fontFamily: "Helvetica",
    color: "#0F172A",
    display: "flex",
    flexDirection: "column",
  },
  coverEyebrow: {
    fontSize: 9,
    color: "#64748B",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  coverTitle: {
    fontSize: 26,
    fontFamily: "Helvetica-Bold",
    color: "#1D4ED8",
    marginBottom: 6,
  },
  coverSubtitle: {
    fontSize: 12,
    color: "#475569",
    marginBottom: 32,
  },
  coverGrid: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  coverGridRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#E5E7EB",
    paddingVertical: 6,
  },
  coverGridLabel: {
    width: 140,
    fontSize: 9,
    color: "#64748B",
  },
  coverGridValue: {
    flex: 1,
    fontSize: 10,
    color: "#0F172A",
  },

  // Sections
  h1: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: "#1D4ED8",
    marginTop: 18,
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  h2: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginTop: 10,
    marginBottom: 4,
    color: "#0F172A",
  },
  paragraph: {
    fontSize: 10,
    color: "#0F172A",
    marginBottom: 6,
  },
  mutedNote: {
    fontSize: 8,
    color: "#94A3B8",
    fontStyle: "italic",
    marginTop: 4,
  },

  // Tables
  table: {
    width: "100%",
    marginBottom: 10,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#F1F5F9",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#E5E7EB",
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  tableCellLeft: {
    flex: 2,
    fontSize: 9,
  },
  tableCellRight: {
    flex: 3,
    fontSize: 9,
  },
  tableCellBold: {
    flex: 2,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },

  // Footer / page number
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    fontSize: 8,
    color: "#94A3B8",
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: "#E5E7EB",
    paddingTop: 6,
  },
  footerLeft: { fontSize: 8, color: "#94A3B8" },
  footerRight: { fontSize: 8, color: "#94A3B8" },

  // Banner
  noticeBox: {
    backgroundColor: "#F8FAFC",
    borderLeftWidth: 3,
    borderLeftColor: "#1D4ED8",
    padding: 8,
    marginBottom: 10,
  },
  noticeText: {
    fontSize: 9,
    color: "#334155",
  },
});
