"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { withShopParams } from "@/lib/withShopParams";
import type { StepId } from "@/lib/setup/types";

const DATE_RANGES = [
  { value: "30", titleKey: "days30Title", descKey: "days30Desc", recommended: false },
  { value: "90", titleKey: "days90Title", descKey: "days90Desc", recommended: true },
  { value: "180", titleKey: "days180Title", descKey: "days180Desc", recommended: false },
] as const;

type TitleKey = "days30Title" | "days90Title" | "days180Title";
type DescKey = "days30Desc" | "days90Desc" | "days180Desc";

interface Dispute {
  id: string;
  dispute_gid: string;
  order_gid: string | null;
  status: string | null;
  reason: string | null;
  amount: number | null;
  currency_code: string | null;
  due_at: string | null;
}

interface SyncDisputesStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

function statusColor(status: string | null): { bg: string; color: string } {
  switch (status) {
    case "won": return { bg: "#D1FAE5", color: "#065F46" };
    case "needs_response": return { bg: "#FEF3C7", color: "#92400E" };
    case "under_review": return { bg: "#DBEAFE", color: "#1E40AF" };
    case "lost": return { bg: "#FEE2E2", color: "#991B1B" };
    default: return { bg: "#F3F4F6", color: "#374151" };
  }
}

function formatCurrency(amount: number | null, code: string | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: code ?? "USD" }).format(amount);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function daysUntil(iso: string | null): { text: string; urgent: boolean } {
  if (!iso) return { text: "—", urgent: false };
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { text: "Overdue", urgent: true };
  if (diff === 0) return { text: "Today", urgent: true };
  if (diff <= 3) return { text: `${diff}d left`, urgent: true };
  return { text: `${diff}d left`, urgent: false };
}

export function SyncDisputesStep({ stepId, onSaveRef }: SyncDisputesStepProps) {
  const t = useTranslations("setup.syncDisputes");
  const searchParams = useSearchParams();
  const [dateRange, setDateRange] = useState("90");
  const [autoSync, setAutoSync] = useState(true);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingDisputes, setLoadingDisputes] = useState(true);

  const fetchDisputes = useCallback(async () => {
    setLoadingDisputes(true);
    try {
      const res = await fetch(`/api/disputes?page=1&per_page=5`);
      if (res.ok) {
        const json = await res.json();
        setDisputes(json.disputes ?? []);
        setTotal(json.pagination?.total ?? 0);
      }
    } finally {
      setLoadingDisputes(false);
    }
  }, []);

  useEffect(() => { fetchDisputes(); }, [fetchDisputes]);

  useEffect(() => {
    onSaveRef.current = async () => {
      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId, payload: { dateRange, autoSync } }),
      });
      return res.ok;
    };
  }, [stepId, onSaveRef, dateRange, autoSync]);

  return (
    <div style={{ maxWidth: 672, margin: "0 auto" }}>
      {/* Icon + heading */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div
          style={{
            width: 64,
            height: 64,
            background: "linear-gradient(135deg, #059669 0%, #10B981 100%)",
            borderRadius: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 20px",
          }}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
            <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
          </svg>
        </div>
        <h2 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 600, color: "#202223", lineHeight: 1.3 }}>
          {t("title")}
        </h2>
        <p style={{ margin: 0, fontSize: 15, color: "#6D7175" }}>
          {t("subtitle")}
        </p>
      </div>

      {/* Date range */}
      <div style={{ marginBottom: 16 }}>
        <p style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 600, color: "#202223" }}>
          {t("dateRangeHeading")}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {DATE_RANGES.map(({ value, titleKey, descKey, recommended }) => {
            const isSelected = dateRange === value;
            return (
              <div
                key={value}
                role="radio"
                aria-checked={isSelected}
                tabIndex={0}
                onClick={() => setDateRange(value)}
                onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") setDateRange(value); }}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "14px 16px",
                  borderRadius: 8,
                  border: isSelected ? "2px solid #1D4ED8" : "1px solid #E1E3E5",
                  background: isSelected ? "#EFF6FF" : "#FFFFFF",
                  cursor: "pointer",
                  transition: "border-color 0.15s, background 0.15s",
                  userSelect: "none",
                }}
              >
                <div style={{ marginTop: 2, flexShrink: 0 }}>
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      border: isSelected ? "5px solid #1D4ED8" : "2px solid #8C9196",
                      background: "transparent",
                    }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#202223", lineHeight: "20px" }}>
                      {t(titleKey as TitleKey)}
                    </span>
                    {recommended && (
                      <span style={{
                        flexShrink: 0,
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: "#D1FAE5",
                        color: "#065F46",
                      }}>
                        {t("days90Recommended")}
                      </span>
                    )}
                  </div>
                  <p style={{ margin: "3px 0 0", fontSize: 13, color: "#6D7175", lineHeight: "18px" }}>
                    {t(descKey as DescKey)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Auto-sync toggle */}
      <div
        role="checkbox"
        aria-checked={autoSync}
        tabIndex={0}
        onClick={() => setAutoSync((v) => !v)}
        onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") setAutoSync((v) => !v); }}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          padding: "14px 16px",
          borderRadius: 8,
          border: autoSync ? "2px solid #1D4ED8" : "1px solid #E1E3E5",
          background: autoSync ? "#EFF6FF" : "#FFFFFF",
          cursor: "pointer",
          transition: "border-color 0.15s, background 0.15s",
          userSelect: "none",
          marginBottom: 28,
        }}
      >
        <div style={{ marginTop: 2, flexShrink: 0 }}>
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              border: autoSync ? "none" : "2px solid #8C9196",
              background: autoSync ? "#1D4ED8" : "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {autoSync && (
              <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                <path d="M1 4.5L4 7.5L10 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#202223", lineHeight: "20px" }}>
            {t("autoSyncTitle")}
          </span>
          <p style={{ margin: "3px 0 0", fontSize: 13, color: "#6D7175", lineHeight: "18px" }}>
            {t("autoSyncDesc")}
          </p>
        </div>
      </div>

      {/* Active disputes preview */}
      <div style={{ borderTop: "1px solid #E1E3E5", paddingTop: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#202223" }}>
            {t("previewHeading")}{total > 0 && <span style={{ marginLeft: 6, fontSize: 13, fontWeight: 500, color: "#6D7175" }}>({total})</span>}
          </p>
          {total > 5 && (
            <a
              href={withShopParams("/app/disputes", searchParams)}
              style={{ fontSize: 13, color: "#1D4ED8", textDecoration: "none", fontWeight: 500 }}
            >
              {t("viewAll", { count: total })} →
            </a>
          )}
        </div>

        {loadingDisputes ? (
          <div style={{ padding: "24px 0", textAlign: "center" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6D7175" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
          </div>
        ) : disputes.length === 0 ? (
          <div style={{
            padding: "20px 16px",
            background: "#F7F8FA",
            border: "1px solid #E1E3E5",
            borderRadius: 8,
            textAlign: "center",
          }}>
            <p style={{ margin: 0, fontSize: 13, color: "#6D7175" }}>{t("noDisputesYet")}</p>
          </div>
        ) : (
          <div style={{ border: "1px solid #E1E3E5", borderRadius: 8, overflow: "hidden" }}>
            {/* Table header */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1.5fr 100px 100px 90px",
              padding: "8px 16px",
              background: "#F7F8FA",
              borderBottom: "1px solid #E1E3E5",
              fontSize: 11,
              fontWeight: 600,
              color: "#6D7175",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}>
              <div>ID</div>
              <div>Reason</div>
              <div>Amount</div>
              <div>Status</div>
              <div>Due</div>
            </div>

            {/* Dispute rows */}
            {disputes.map((d, i) => {
              const sc = statusColor(d.status);
              const due = daysUntil(d.due_at);
              const isLast = i === disputes.length - 1;
              return (
                <div
                  key={d.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1.5fr 100px 100px 90px",
                    padding: "10px 16px",
                    borderBottom: isLast ? "none" : "1px solid #F1F1F1",
                    alignItems: "center",
                    background: "#FFFFFF",
                    fontSize: 13,
                  }}
                >
                  <div style={{ fontWeight: 500, color: "#202223", fontFamily: "monospace", fontSize: 12 }}>
                    #{d.dispute_gid.split("/").pop()?.slice(-8) ?? d.id.slice(0, 8)}
                  </div>
                  <div style={{ color: "#202223", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d.reason ? d.reason.replace(/_/g, " ") : "—"}
                  </div>
                  <div style={{ color: "#202223", fontWeight: 500 }}>
                    {formatCurrency(d.amount, d.currency_code)}
                  </div>
                  <div>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "2px 7px",
                      borderRadius: 4,
                      background: sc.bg,
                      color: sc.color,
                      whiteSpace: "nowrap",
                    }}>
                      {(d.status ?? "unknown").replace(/_/g, " ")}
                    </span>
                  </div>
                  <div style={{
                    fontSize: 12,
                    color: due.urgent ? "#B91C1C" : "#6D7175",
                    fontWeight: due.urgent ? 600 : 400,
                  }}>
                    {due.text !== "—" ? due.text : formatDate(d.due_at)}
                  </div>
                </div>
              );
            })}

            {total > 5 && (
              <div style={{
                padding: "10px 16px",
                background: "#F7F8FA",
                borderTop: "1px solid #E1E3E5",
                fontSize: 13,
                color: "#6D7175",
                textAlign: "center",
              }}>
                + {total - 5} more disputes
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
