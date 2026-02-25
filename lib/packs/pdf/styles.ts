import { StyleSheet } from "@react-pdf/renderer";

export const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#0B1220",
    lineHeight: 1.5,
  },

  // Cover
  coverPage: {
    padding: 60,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
  },
  coverTitle: {
    fontSize: 28,
    fontFamily: "Helvetica-Bold",
    color: "#1D4ED8",
    marginBottom: 8,
  },
  coverSubtitle: {
    fontSize: 14,
    color: "#64748B",
    marginBottom: 40,
  },
  coverMeta: {
    fontSize: 11,
    color: "#0B1220",
    marginBottom: 6,
    textAlign: "center",
  },
  coverScore: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    marginTop: 20,
  },

  // Section
  sectionTitle: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: "#1D4ED8",
    marginTop: 20,
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  sectionSubtitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginTop: 10,
    marginBottom: 4,
  },

  // Table
  table: {
    width: "100%",
    marginBottom: 10,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#F6F8FB",
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
  tableCell: {
    flex: 1,
    fontSize: 9,
  },
  tableCellRight: {
    flex: 1,
    fontSize: 9,
    textAlign: "right",
  },
  tableCellBold: {
    flex: 1,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },

  // Key-value row
  kvRow: {
    flexDirection: "row",
    marginBottom: 3,
  },
  kvLabel: {
    width: 140,
    fontSize: 9,
    color: "#64748B",
  },
  kvValue: {
    flex: 1,
    fontSize: 9,
  },

  // Checklist
  checkItem: {
    flexDirection: "row",
    marginBottom: 3,
    alignItems: "center",
  },
  checkIcon: {
    width: 12,
    fontSize: 10,
    marginRight: 6,
  },
  checkLabel: {
    fontSize: 9,
    flex: 1,
  },
  checkRequired: {
    fontSize: 8,
    color: "#EF4444",
    marginLeft: 4,
  },

  // Policy
  policyText: {
    fontSize: 8,
    color: "#374151",
    marginBottom: 8,
    padding: 8,
    backgroundColor: "#F9FAFB",
    borderRadius: 2,
  },

  // Audit
  auditRow: {
    flexDirection: "row",
    marginBottom: 3,
  },
  auditTime: {
    width: 130,
    fontSize: 8,
    color: "#64748B",
  },
  auditEvent: {
    flex: 1,
    fontSize: 8,
  },

  // Footer
  footer: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
    fontSize: 7,
    color: "#94A3B8",
    textAlign: "center",
    borderTopWidth: 0.5,
    borderTopColor: "#E5E7EB",
    paddingTop: 6,
  },

  // Blocker / warning
  blockerBox: {
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: 3,
    padding: 8,
    marginBottom: 8,
  },
  blockerText: {
    fontSize: 9,
    color: "#DC2626",
  },
  warningBox: {
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#FDE68A",
    borderRadius: 3,
    padding: 8,
    marginBottom: 8,
  },
  warningText: {
    fontSize: 9,
    color: "#92400E",
  },

  text: {
    fontSize: 9,
    marginBottom: 3,
  },
});
