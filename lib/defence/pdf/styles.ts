/**
 * Styles for the Defence Package PDF — bank-facing representment.
 *
 * Transcribed from the Claude Design file "Chargeback Response v2"
 * (2026-09-24, supplied by the maintainer as a rendered PDF). US Letter,
 * Inter, one burgundy accent:
 *
 *   - page 1: burgundy top bar, eyebrow + generated timestamp, dispute title,
 *     subtitle, "Submitted on behalf of", three pink fact cards, Case Details
 *     (burgundy heading + rule, zebra rows, status pills);
 *   - pages 2+: running header, numbered sections (burgundy badge + title +
 *     rule), shipment cards, line items with a total row, a vertical
 *     chronology, a pink conclusion panel;
 *   - footer on every page: case reference left, "n / N" right.
 *
 * Measurements are the design's pixels scaled to points (page width 950px →
 * 612pt, ×0.644).
 */

import { StyleSheet } from "@react-pdf/renderer";
import { DOCUMENT_COLORS } from "../render/documentTheme";

export const COLORS = DOCUMENT_COLORS;

const C = COLORS;
const MX = 45;

export const styles = StyleSheet.create({
  page: {
    paddingHorizontal: MX,
    paddingTop: 72,
    paddingBottom: 64,
    fontFamily: "Inter",
    fontSize: 10,
    color: C.body,
    lineHeight: 1.45,
  },
  firstPage: {
    paddingHorizontal: MX,
    paddingTop: 72,
    paddingBottom: 64,
    fontFamily: "Inter",
    fontSize: 10,
    color: C.body,
    lineHeight: 1.45,
  },

  // ─── Page 1 ──────────────────────────────────────────────────────────
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 5,
    backgroundColor: C.accent,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  eyebrow: {
    fontSize: 8,
    fontWeight: 700,
    color: C.accent,
    letterSpacing: 1.3,
    textTransform: "uppercase",
  },
  metaRight: {
    fontSize: 8.5,
    color: C.muted,
  },
  title: {
    fontSize: 30,
    fontWeight: 700,
    color: C.ink,
    lineHeight: 1.1,
    letterSpacing: -0.6,
  },
  subtitle: {
    fontSize: 12,
    color: C.muted,
    marginTop: 8,
  },
  onBehalf: {
    fontSize: 10,
    color: C.muted,
    marginTop: 14,
  },
  onBehalfName: {
    fontWeight: 600,
    color: C.accent,
  },
  cards: {
    flexDirection: "row",
    marginTop: 22,
    marginBottom: 26,
  },
  card: {
    flex: 1,
    backgroundColor: C.accentSoft,
    borderRadius: 6,
    paddingVertical: 12,
    paddingHorizontal: 13,
  },
  cardGap: {
    width: 9,
  },
  cardLabel: {
    fontSize: 7.5,
    fontWeight: 600,
    color: C.accent,
    letterSpacing: 0.9,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  cardValue: {
    fontSize: 15.5,
    fontWeight: 700,
    color: C.ink,
    lineHeight: 1.2,
  },

  // ─── Headings ────────────────────────────────────────────────────────
  plainHeading: {
    fontSize: 14,
    fontWeight: 700,
    color: C.accent,
    paddingBottom: 8,
    borderBottomWidth: 1.5,
    borderBottomColor: C.accent,
    marginBottom: 10,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 8,
    borderBottomWidth: 1.5,
    borderBottomColor: C.accent,
    marginBottom: 12,
  },
  badge: {
    backgroundColor: C.accent,
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginRight: 8,
  },
  badgeText: {
    fontSize: 8,
    fontWeight: 700,
    color: "#FFFFFF",
    lineHeight: 1.2,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: C.accent,
    lineHeight: 1.2,
  },
  section: {
    marginBottom: 24,
  },

  // ─── Running header / footer ─────────────────────────────────────────
  runningHeaderSlot: {
    position: "absolute",
    top: 28,
    left: MX,
    right: MX,
  },
  runningHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 8,
    borderBottomWidth: 0.75,
    borderBottomColor: C.hairline,
  },
  runningLeft: {
    fontSize: 7.5,
    fontWeight: 700,
    color: C.accent,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  runningRight: {
    fontSize: 8,
    color: C.muted,
  },
  // Positioned from the TOP (Letter = 792pt). A render-prop element anchored
  // with `bottom` did not draw in this document; the running header, anchored
  // with `top`, did (local harness, 2026-09-24).
  footerSlot: {
    position: "absolute",
    top: 744,
    left: MX,
    right: MX,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 8,
    borderTopWidth: 0.75,
    borderTopColor: C.hairline,
  },
  footerLeft: {
    fontSize: 8,
    color: C.muted,
  },
  footerRight: {
    fontSize: 8,
    fontWeight: 700,
    color: C.accent,
  },

  // ─── Prose ───────────────────────────────────────────────────────────
  paragraph: {
    fontSize: 11,
    color: C.body,
    lineHeight: 1.55,
    marginBottom: 7,
  },
  strong: {
    fontWeight: 700,
    color: C.ink,
  },
  thesis: {
    borderLeftWidth: 2,
    borderLeftColor: C.accent,
    paddingLeft: 10,
    marginBottom: 10,
  },
  thesisText: {
    fontSize: 10.5,
    color: C.ink,
    fontWeight: 500,
    lineHeight: 1.5,
  },

  // ─── Tables (Case Details, line items, evidence basis) ───────────────
  thRow: {
    flexDirection: "row",
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  th: {
    fontSize: 7.5,
    fontWeight: 600,
    color: C.muted,
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  tr: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    paddingVertical: 6.5,
    borderRadius: 4,
  },
  trZebra: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    paddingVertical: 6.5,
    borderRadius: 4,
    backgroundColor: C.zebra,
  },
  tdLabel: {
    fontSize: 9.5,
    color: C.muted,
    lineHeight: 1.35,
  },
  td: {
    fontSize: 9.5,
    color: C.ink,
    lineHeight: 1.35,
  },
  totalRow: {
    flexDirection: "row",
    paddingHorizontal: 9,
    paddingTop: 9,
    marginTop: 4,
    borderTopWidth: 1.2,
    borderTopColor: C.ink,
  },
  totalText: {
    fontSize: 10,
    fontWeight: 700,
    color: C.accent,
  },
  link: {
    color: C.accent,
    textDecoration: "none",
  },

  // ─── Pills ───────────────────────────────────────────────────────────
  pill: {
    borderRadius: 4,
    borderWidth: 0.75,
    paddingHorizontal: 5,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  pillText: {
    fontSize: 8.5,
    fontWeight: 500,
    lineHeight: 1.2,
  },

  // ─── Shipment cards ──────────────────────────────────────────────────
  shipRow: {
    flexDirection: "row",
    marginBottom: 9,
  },
  shipGap: {
    width: 11,
  },
  shipCard: {
    flex: 1,
    borderWidth: 0.75,
    borderColor: C.hairline,
    borderRadius: 7,
  },
  shipHead: {
    backgroundColor: C.accentSoft,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  shipHeadRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  shipLabel: {
    fontSize: 7.5,
    fontWeight: 700,
    color: C.accent,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  shipProduct: {
    fontSize: 11,
    fontWeight: 600,
    color: C.ink,
    lineHeight: 1.3,
  },
  shipBody: {
    paddingHorizontal: 13,
    paddingTop: 4,
    paddingBottom: 8,
  },
  shipField: {
    paddingVertical: 6,
    borderBottomWidth: 0.75,
    borderBottomColor: C.hairline,
  },
  shipFieldLast: {
    paddingVertical: 6,
  },
  shipFieldLabel: {
    fontSize: 8.5,
    color: C.muted,
    marginBottom: 2,
  },
  shipFieldValue: {
    fontSize: 9.5,
    color: C.ink,
    fontWeight: 500,
  },

  // ─── Chronology ──────────────────────────────────────────────────────
  chronoRow: {
    flexDirection: "row",
  },
  chronoDateCol: {
    width: 116,
    paddingBottom: 14,
  },
  chronoDate: {
    fontSize: 9.5,
    fontWeight: 600,
    color: C.ink,
    lineHeight: 1.3,
  },
  chronoTime: {
    fontSize: 8.5,
    color: C.muted,
    lineHeight: 1.3,
  },
  chronoRail: {
    width: 26,
    alignItems: "center",
  },
  chronoLine: {
    position: "absolute",
    top: 8,
    bottom: 0,
    left: 12.25,
    width: 1.5,
    backgroundColor: C.accentLine,
  },
  dotFilled: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: C.accent,
    marginTop: 3,
  },
  dotHollow: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    borderWidth: 1.5,
    borderColor: C.accent,
    backgroundColor: "#FFFFFF",
    marginTop: 3,
  },
  dotGreen: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: C.greenDot,
    marginTop: 3,
  },
  chronoBody: {
    flex: 1,
    paddingBottom: 14,
  },
  chronoTitle: {
    fontSize: 10,
    fontWeight: 600,
    color: C.ink,
    lineHeight: 1.3,
    marginBottom: 1,
  },
  chronoText: {
    fontSize: 9.5,
    color: C.muted,
    lineHeight: 1.4,
  },

  // ─── Conclusion ──────────────────────────────────────────────────────
  conclusion: {
    backgroundColor: C.accentSoft,
    borderRadius: 7,
    paddingVertical: 18,
    paddingHorizontal: 20,
  },
  conclusionRequest: {
    fontSize: 12.5,
    fontWeight: 600,
    color: C.accent,
    lineHeight: 1.4,
    marginBottom: 8,
  },
  conclusionBody: {
    fontSize: 10,
    color: C.ink,
    lineHeight: 1.5,
  },
});
