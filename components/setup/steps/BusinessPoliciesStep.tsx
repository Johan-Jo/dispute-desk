"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import type { PolicyTemplateType } from "@/lib/policy-templates/library";
import type { StepId } from "@/lib/setup/types";

const POLICY_ROWS = [
  { key: "shipping", libraryType: "shipping" as PolicyTemplateType, defaultPath: "/policies/shipping-policy", required: true },
  { key: "returns", libraryType: "refunds" as PolicyTemplateType, defaultPath: "/policies/refund-policy", required: true },
  { key: "terms", libraryType: "terms" as PolicyTemplateType, defaultPath: "/policies/terms-of-service", required: false },
  { key: "privacy", libraryType: "privacy" as PolicyTemplateType, defaultPath: "/policies/privacy-policy", required: false },
] as const;

// Templates available in the Policy Templates section (no privacy template)
const TEMPLATE_ROWS = [
  { key: "shipping" as const, libraryType: "shipping" as PolicyTemplateType, nameKey: "shippingTemplateName" as const, descKey: "shippingTemplateDesc" as const },
  { key: "returns" as const, libraryType: "refunds" as PolicyTemplateType, nameKey: "returnsTemplateName" as const, descKey: "returnsTemplateDesc" as const },
  { key: "terms" as const, libraryType: "terms" as PolicyTemplateType, nameKey: "termsTemplateName" as const, descKey: "termsTemplateDesc" as const },
];

type PolicyKey = (typeof POLICY_ROWS)[number]["key"];

type PolicyState =
  | { source: "url"; url: string }
  | { source: "template"; content: string; loading?: boolean };

interface BusinessPoliciesStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

function getShopOriginFallback(): string | null {
  const domain = document.cookie.match(/shopify_shop=([^;]+)/)?.[1];
  if (domain) return `https://${domain}`;
  const shopParam = new URLSearchParams(window.location.search).get("shop");
  if (shopParam) return `https://${shopParam}`;
  return null;
}

function prefillUrls(origin: string): Record<PolicyKey, PolicyState> {
  const base = origin.replace(/\/$/, "");
  return {
    shipping: { source: "url", url: `${base}/policies/shipping-policy` },
    returns: { source: "url", url: `${base}/policies/refund-policy` },
    terms: { source: "url", url: `${base}/policies/terms-of-service` },
    privacy: { source: "url", url: `${base}/policies/privacy-policy` },
  };
}

export function BusinessPoliciesStep({ stepId, onSaveRef }: BusinessPoliciesStepProps) {
  const t = useTranslations("setup.policies");

  const [policies, setPolicies] = useState<Record<PolicyKey, PolicyState>>({
    shipping: { source: "url", url: "" },
    returns: { source: "url", url: "" },
    terms: { source: "url", url: "" },
    privacy: { source: "url", url: "" },
  });

  const [resolvedShopId, setResolvedShopId] = useState<string | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);

  useEffect(() => {
    const fallbackOrigin = getShopOriginFallback();
    if (fallbackOrigin) {
      setPolicies((prev) => ({ ...prev, ...prefillUrls(fallbackOrigin) }));
    }

    fetch("/api/setup/state")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.shopId) return;
        setResolvedShopId(data.shopId);
        return fetch(`/api/shop/details?shop_id=${data.shopId}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((details) => {
            if (!details?.primaryDomain) return;
            const origin = details.primaryDomain.replace(/\/$/, "");
            if (fallbackOrigin && origin === fallbackOrigin.replace(/\/$/, "")) return;
            setPolicies((prev) => {
              const next = { ...prev };
              for (const row of POLICY_ROWS) {
                if (prev[row.key].source === "url") {
                  next[row.key] = { source: "url", url: `${origin}${row.defaultPath}` };
                }
              }
              return next;
            });
          });
      })
      .catch(() => {});
  }, []);

  const loadTemplate = useCallback(
    async (key: PolicyKey, libraryType: PolicyTemplateType) => {
      setPolicies((prev) => ({ ...prev, [key]: { source: "template", content: "", loading: true } }));
      try {
        const qs = resolvedShopId ? `?shop_id=${resolvedShopId}` : "";
        const res = await fetch(`/api/policy-templates/${libraryType}/content${qs}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { body } = await res.json();
        setPolicies((prev) => ({ ...prev, [key]: { source: "template", content: body ?? "" } }));
      } catch {
        setPolicies((prev) => ({ ...prev, [key]: { source: "url", url: (prev[key] as { url?: string }).url ?? "" } }));
      }
    },
    [resolvedShopId]
  );

  const loadAllTemplates = useCallback(async () => {
    setLoadingAll(true);
    await Promise.all(TEMPLATE_ROWS.map((row) => loadTemplate(row.key, row.libraryType)));
    setLoadingAll(false);
  }, [loadTemplate]);

  function setUrl(key: PolicyKey, url: string) {
    setPolicies((prev) => ({ ...prev, [key]: { source: "url", url } }));
  }

  function setContent(key: PolicyKey, content: string) {
    setPolicies((prev) => ({ ...prev, [key]: { source: "template", content } }));
  }

  function removeTemplate(key: PolicyKey) {
    setPolicies((prev) => ({ ...prev, [key]: { source: "url", url: "" } }));
  }

  useEffect(() => {
    onSaveRef.current = async () => {
      for (const row of POLICY_ROWS) {
        const p = policies[row.key];
        if (p.source !== "template") continue;
        const applyRes = await fetch("/api/policies/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shop_id: resolvedShopId, policy_type: row.libraryType, content: p.content }),
        });
        if (!applyRes.ok) return false;
      }
      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId, payload: { policies } }),
      });
      return res.ok;
    };
  }, [stepId, onSaveRef, policies, resolvedShopId]);

  const helperKey: Record<PolicyKey, Parameters<typeof t>[0]> = {
    shipping: "shippingHelper",
    returns: "returnsHelper",
    terms: "termsHelper",
    privacy: "privacyHelper",
  };

  return (
    <div style={{ maxWidth: 672, margin: "0 auto" }}>
      {/* Icon + heading */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div
          style={{
            width: 64,
            height: 64,
            background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
            borderRadius: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 16px",
          }}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <polyline points="9 15 11 17 15 13" />
          </svg>
        </div>
        <h2 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 600, color: "#202223", lineHeight: 1.3 }}>
          {t("title")}
        </h2>
        <p style={{ margin: 0, fontSize: 15, color: "#6D7175" }}>
          {t("subtitle")}
        </p>
      </div>

      {/* Policy Wizard Banner */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          padding: "20px",
          background: "#EFF6FF",
          border: "1px solid #BFDBFE",
          borderRadius: 8,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            flexShrink: 0,
            background: "#1D4ED8",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1E40AF", marginBottom: 4 }}>
            {t("wizardTitle")}
          </div>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "#1E40AF", lineHeight: "18px" }}>
            {t("wizardDesc")}
          </p>
          <button
            onClick={loadAllTemplates}
            disabled={loadingAll}
            style={{
              padding: "8px 16px",
              background: "#1D4ED8",
              color: "white",
              border: "none",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              cursor: loadingAll ? "not-allowed" : "pointer",
              opacity: loadingAll ? 0.7 : 1,
            }}
          >
            {loadingAll ? "…" : t("wizardCta")}
          </button>
        </div>
      </div>

      {/* Policy URL / template inputs */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 24 }}>
        {POLICY_ROWS.map((row) => {
          const policy = policies[row.key];
          const isTemplate = policy.source === "template";
          const isLoading = isTemplate && (policy as { loading?: boolean }).loading;

          return (
            <div key={row.key}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <label style={{ fontSize: 14, fontWeight: 600, color: "#202223" }}>
                  {t(`${row.key}Label` as Parameters<typeof t>[0])}
                  {row.required && <span style={{ color: "#DC2626", marginLeft: 4 }}>*</span>}
                </label>
                {isTemplate && (
                  <button
                    onClick={() => removeTemplate(row.key)}
                    style={{ fontSize: 12, color: "#6D7175", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    ← {t("removeTemplate")}
                  </button>
                )}
              </div>

              {isTemplate ? (
                isLoading ? (
                  <div style={{ padding: "20px", textAlign: "center", border: "1px solid #C9CCCF", borderRadius: 8 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6D7175" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                    </svg>
                  </div>
                ) : (
                  <textarea
                    value={(policy as { content: string }).content}
                    onChange={(e) => setContent(row.key, e.target.value)}
                    rows={6}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "10px 12px",
                      border: "1px solid #C9CCCF",
                      borderRadius: 8,
                      fontSize: 13,
                      fontFamily: "monospace",
                      color: "#202223",
                      resize: "vertical",
                      outline: "none",
                    }}
                  />
                )
              ) : (
                <input
                  type="url"
                  value={(policy as { url: string }).url}
                  onChange={(e) => setUrl(row.key, e.target.value)}
                  placeholder={t(`${row.key}Placeholder` as Parameters<typeof t>[0])}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "10px 16px",
                    border: "1px solid #C9CCCF",
                    borderRadius: 8,
                    fontSize: 14,
                    color: "#202223",
                    outline: "none",
                  }}
                />
              )}

              <p style={{ margin: "6px 0 0", fontSize: 12, color: "#6D7175" }}>
                {t(helperKey[row.key])}
              </p>
            </div>
          );
        })}
      </div>

      {/* Policy Templates Section */}
      <div
        style={{
          border: "1px solid #E1E3E5",
          borderRadius: 8,
          padding: 20,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#202223" }}>{t("templatesTitle")}</span>
          <span style={{ fontSize: 12, fontWeight: 500, padding: "2px 8px", background: "#DCFCE7", color: "#059669", borderRadius: 4 }}>
            {t("templatesAvailable")}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {TEMPLATE_ROWS.map((row) => {
            const isApplied = policies[row.key].source === "template";
            const isLoading = isApplied && (policies[row.key] as { loading?: boolean }).loading;
            return (
              <div
                key={row.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px",
                  background: "#F7F8FA",
                  borderRadius: 8,
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6D7175" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "#202223" }}>
                    {t(row.nameKey)}
                  </p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6D7175" }}>
                    {t(row.descKey)}
                  </p>
                </div>
                {isApplied ? (
                  <span style={{ fontSize: 12, fontWeight: 500, color: "#059669", whiteSpace: "nowrap" }}>
                    ✓ {t("applied")}
                  </span>
                ) : (
                  <button
                    onClick={() => loadTemplate(row.key, row.libraryType)}
                    disabled={isLoading}
                    style={{
                      padding: "6px 12px",
                      fontSize: 12,
                      fontWeight: 500,
                      color: "#1D4ED8",
                      background: "none",
                      border: "none",
                      cursor: isLoading ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isLoading ? "…" : t("preview")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Info banner */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          padding: 16,
          background: "#F7F8FA",
          border: "1px solid #E1E3E5",
          borderRadius: 8,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6D7175" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <div>
          <p style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600, color: "#202223" }}>
            {t("autoIncludeTitle")}
          </p>
          <p style={{ margin: 0, fontSize: 13, color: "#6D7175", lineHeight: "18px" }}>
            {t("autoIncludeDesc")}
          </p>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
