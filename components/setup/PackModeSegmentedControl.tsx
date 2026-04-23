"use client";

import type { PackHandlingUiMode } from "@/lib/rules/packHandlingAutomation";

export interface PackModeSegmentedControlProps {
  value: PackHandlingUiMode;
  onChange: (next: PackHandlingUiMode) => void;
  disabled?: boolean;
  disabledAuto?: boolean;
  reviewLabel: string;
  autoLabel: string;
  reviewHint: string;
  autoHint: string;
  autoDisabledReason?: string;
}

/**
 * Pill segmented control for the two-mode automation model: "Review before
 * submit" vs "Automatic". Both modes always build the evidence pack — the
 * only question the merchant answers here is whether DisputeDesk submits
 * automatically or hands the pack back for review.
 */
export function PackModeSegmentedControl({
  value,
  onChange,
  disabled,
  disabledAuto,
  reviewLabel,
  autoLabel,
  reviewHint,
  autoHint,
  autoDisabledReason,
}: PackModeSegmentedControlProps) {
  const autoOff = Boolean(disabledAuto);
  const baseBtn: React.CSSProperties = {
    flex: 1,
    minWidth: 120,
    padding: "10px 14px",
    border: "none",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease",
  };

  const track: React.CSSProperties = {
    display: "inline-flex",
    width: "100%",
    maxWidth: 340,
    padding: 4,
    borderRadius: 999,
    background: "#F1F5F9",
    border: "1px solid #E2E8F0",
    boxShadow: "inset 0 1px 2px rgba(15, 23, 42, 0.06)",
    opacity: disabled ? 0.65 : 1,
  };

  const selReview = value === "review";
  const selAuto = value === "auto";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
      <div style={track} role="group" aria-label={reviewLabel + " / " + autoLabel}>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={selReview}
          onClick={() => onChange("review")}
          style={{
            ...baseBtn,
            background: selReview ? "#FFFFFF" : "transparent",
            color: selReview ? "#0F172A" : "#64748B",
            boxShadow: selReview ? "0 1px 3px rgba(15, 23, 42, 0.12)" : "none",
          }}
        >
          {reviewLabel}
        </button>
        <button
          type="button"
          disabled={disabled || autoOff}
          aria-pressed={selAuto}
          title={autoOff ? autoDisabledReason : undefined}
          onClick={() => {
            if (!autoOff) onChange("auto");
          }}
          style={{
            ...baseBtn,
            background: selAuto ? "linear-gradient(180deg, #DCFCE7 0%, #BBF7D0 100%)" : "transparent",
            color: selAuto ? "#14532D" : autoOff ? "#94A3B8" : "#64748B",
            boxShadow: selAuto ? "0 1px 3px rgba(22, 101, 52, 0.15)" : "none",
          }}
        >
          {autoLabel}
        </button>
      </div>
      <p
        style={{
          margin: 0,
          maxWidth: 340,
          fontSize: 11,
          lineHeight: 1.45,
          color: "#64748B",
          textAlign: "right",
        }}
      >
        {selReview ? reviewHint : autoHint}
      </p>
    </div>
  );
}
