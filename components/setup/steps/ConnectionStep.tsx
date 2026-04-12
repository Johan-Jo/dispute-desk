"use client";

import { useCallback, useEffect, useState } from "react";
import { Spinner } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type { StepId } from "@/lib/setup/types";
import type { ReadinessResult, ReadinessRow, ReadinessStatus } from "@/lib/setup/readiness";

interface ConnectionStepProps {
  stepId: StepId;
  onSaveRef: { current: (() => Promise<boolean>) | null };
  /** Callback to inform shell whether Continue should be enabled. */
  onCanContinueChange?: (canContinue: boolean) => void;
}

const STATUS_STYLES: Record<ReadinessStatus, { bg: string; text: string; iconBg: string }> = {
  ready: { bg: "#D1FAE5", text: "#065F46", iconBg: "#D1FAE5" },
  needs_action: { bg: "#FEE2E2", text: "#DC2626", iconBg: "#FEE2E2" },
  syncing: { bg: "#FEF3C7", text: "#92400E", iconBg: "#FEF3C7" },
};

function CheckCircleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm3.7-9.3-4.2 4.2a.75.75 0 0 1-1.06 0L6.8 11.3a.75.75 0 1 1 1.06-1.06l1.1 1.1 3.7-3.7a.75.75 0 0 1 1.06 1.06z" fill="currentColor" />
    </svg>
  );
}
function XCircleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM7.4 7.4a.75.75 0 0 1 1.06 0L10 8.94l1.54-1.54a.75.75 0 1 1 1.06 1.06L11.06 10l1.54 1.54a.75.75 0 0 1-1.06 1.06L10 11.06l-1.54 1.54a.75.75 0 0 1-1.06-1.06L8.94 10 7.4 8.46a.75.75 0 0 1 0-1.06z" fill="currentColor" />
    </svg>
  );
}
function SpinnerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ animation: "spin 1s linear infinite" }}>
      <path d="M10 3a7 7 0 0 1 6.5 4.4l-1.8.7A5 5 0 1 0 15 10h2a7 7 0 1 1-7-7z" fill="currentColor" />
    </svg>
  );
}
function AlertTriangleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 2L1 18h18L10 2zm0 4l6.5 11h-13L10 6zm-.75 3.5v4h1.5v-4h-1.5zm0 5v1.5h1.5v-1.5h-1.5z" fill="currentColor" />
    </svg>
  );
}

const ROW_TITLE_KEYS: Record<string, string> = {
  shopify_connected: "shopifyConnected",
  dispute_access: "disputeAccess",
  evidence_access: "evidenceAccess",
  webhooks_active: "webhooksActive",
  store_data: "storeData",
};
const ROW_DESC_KEYS: Record<string, string> = {
  shopify_connected: "shopifyConnectedDesc",
  dispute_access: "disputeAccessDesc",
  evidence_access: "evidenceAccessDesc",
  webhooks_active: "webhooksActiveDesc",
  store_data: "storeDataDesc",
};
const STATUS_LABEL_KEYS: Record<ReadinessStatus, string> = {
  ready: "statusReady",
  needs_action: "statusNeedsAction",
  syncing: "statusSyncing",
};

function StatusIcon({ status }: { status: ReadinessStatus }) {
  if (status === "ready") return <CheckCircleIcon />;
  if (status === "needs_action") return <XCircleIcon />;
  return <SpinnerIcon />;
}

/** Row IDs that require OAuth re-authentication to fix. */
const OAUTH_ACTION_ROWS: ReadonlySet<string> = new Set([
  "shopify_connected",
  "dispute_access",
  "evidence_access",
]);

export function ConnectionStep({ onSaveRef, onCanContinueChange }: ConnectionStepProps) {
  const t = useTranslations("setup.connection");
  const [readiness, setReadiness] = useState<ReadinessResult | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchReadiness = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/setup/readiness");
      if (res.ok) {
        const data: ReadinessResult = await res.json();
        setReadiness(data);
        onCanContinueChange?.(!data.hasBlockers);
      }
    } finally {
      setLoading(false);
    }
  }, [onCanContinueChange]);

  /** Trigger OAuth re-authentication for connection/scope issues. */
  const handleReconnect = useCallback(() => {
    const domain = readiness?.shopDomain
      ?? new URLSearchParams(window.location.search).get("shop");
    if (domain) {
      window.top!.location.href =
        `/api/auth/shopify?shop=${encodeURIComponent(domain)}`;
    } else {
      window.location.reload();
    }
  }, [readiness?.shopDomain]);

  useEffect(() => {
    fetchReadiness();
  }, [fetchReadiness]);

  // Step 1 does not persist — onSave just advances if no blockers
  useEffect(() => {
    onSaveRef.current = async () => {
      if (readiness?.hasBlockers) return false;
      return true;
    };
  }, [onSaveRef, readiness]);

  if (loading && !readiness) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
        <Spinner size="large" />
      </div>
    );
  }

  const rows = readiness?.rows ?? [];

  return (
    <div>
      {/* Inline keyframes for spinner animation */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: "#202223", marginBottom: 8 }}>
          {t("title")}
        </h2>
        <p style={{ fontSize: 14, color: "#6D7175", margin: 0 }}>
          {t("subtitle")}
        </p>
      </div>

      {/* Readiness Checklist */}
      <div style={{ background: "#fff", border: "1px solid #E1E3E5", borderRadius: 8, boxShadow: "0 1px 2px rgba(0,0,0,0.05)", marginBottom: 16 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #E1E3E5" }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "#202223", margin: 0 }}>
            {t("statusHeading")}
          </h3>
        </div>
        <div>
          {rows.map((row: ReadinessRow, i: number) => {
            const styles = STATUS_STYLES[row.status];
            return (
              <div key={row.id} style={{ padding: "14px 20px", borderBottom: i < rows.length - 1 ? "1px solid #E1E3E5" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, flex: 1 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 8,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: styles.iconBg, color: styles.text,
                    }}>
                      <StatusIcon status={row.status} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "#202223" }}>
                        {t(ROW_TITLE_KEYS[row.id] as Parameters<typeof t>[0])}
                      </div>
                      <div style={{ fontSize: 12, color: "#6D7175", marginTop: 2 }}>
                        {t(ROW_DESC_KEYS[row.id] as Parameters<typeof t>[0])}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{
                      padding: "3px 10px", borderRadius: 999,
                      fontSize: 12, fontWeight: 600,
                      background: styles.bg, color: styles.text,
                    }}>
                      {t(STATUS_LABEL_KEYS[row.status] as Parameters<typeof t>[0])}
                    </span>
                    {row.actionLabel && (
                      <button
                        onClick={OAUTH_ACTION_ROWS.has(row.id) && row.status === "needs_action" ? handleReconnect : fetchReadiness}
                        style={{
                          padding: "5px 14px",
                          background: row.status === "needs_action" ? "#1D4ED8" : "#fff",
                          color: row.status === "needs_action" ? "#fff" : "#202223",
                          border: row.status === "needs_action" ? "none" : "1px solid #E1E3E5",
                          borderRadius: 8, fontSize: 12, fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {t(row.actionLabel as Parameters<typeof t>[0])}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Alert Banner */}
      {readiness?.hasBlockers && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 8, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ color: "#DC2626", flexShrink: 0, marginTop: 1 }}><AlertTriangleIcon /></div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#DC2626", margin: "0 0 4px" }}>
                {t("blockerAlertTitle")}
              </p>
              <p style={{ fontSize: 13, color: "#991B1B", margin: 0 }}>
                {t("blockerAlert")}
              </p>
            </div>
          </div>
        </div>
      )}
      {!readiness?.hasBlockers && readiness?.hasPending && (
        <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ color: "#92400E", flexShrink: 0, marginTop: 1 }}><SpinnerIcon /></div>
            <p style={{ fontSize: 13, color: "#92400E", margin: 0 }}>
              {t("pendingNote")}
            </p>
          </div>
        </div>
      )}
      {readiness?.allReady && (
        <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ color: "#1D4ED8", flexShrink: 0, marginTop: 1 }}><CheckCircleIcon /></div>
            <p style={{ fontSize: 13, color: "#1E40AF", margin: 0 }}>
              {t("allReadyNote")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
