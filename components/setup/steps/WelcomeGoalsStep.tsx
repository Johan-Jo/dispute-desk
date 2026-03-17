"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import type { StepId } from "@/lib/setup/types";

interface WelcomeGoalsStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

export function WelcomeGoalsStep({ stepId, onSaveRef }: WelcomeGoalsStepProps) {
  const t = useTranslations("setup.welcome");

  useEffect(() => {
    onSaveRef.current = async () => {
      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId, payload: {} }),
      });
      return res.ok;
    };
  }, [stepId, onSaveRef]);

  const steps = [
    { title: t("step1Title"), desc: t("step1Desc") },
    { title: t("step2Title"), desc: t("step2Desc") },
    { title: t("step3Title"), desc: t("step3Desc") },
    { title: t("step4Title"), desc: t("step4Desc") },
    { title: t("step5Title"), desc: t("step5Desc") },
  ];

  return (
    <div style={{ maxWidth: 672, margin: "0 auto" }}>
      {/* Icon + heading */}
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div
          style={{
            width: 80,
            height: 80,
            background: "linear-gradient(135deg, #1D4ED8 0%, #1e40af 100%)",
            borderRadius: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 24px",
          }}
        >
          <svg width="40" height="40" viewBox="0 0 24 24" fill="white">
            <path d="M12 2L4 5v6c0 5.25 3.4 10.15 8 11.35C17.6 21.15 21 16.25 21 11V5l-9-3zm0 2.18l7 2.33V11c0 4.13-2.72 7.98-7 9.17-4.28-1.19-7-5.04-7-9.17V6.51l7-2.33zM10.59 14l-2.83-2.83 1.41-1.41L10.59 11.17l4.24-4.24 1.41 1.41L10.59 14z" />
          </svg>
        </div>
        <h1 style={{ margin: "0 0 12px", fontSize: 30, fontWeight: 600, color: "#202223", lineHeight: 1.2 }}>
          {t("title")}
        </h1>
        <p style={{ margin: 0, fontSize: 17, color: "#6D7175" }}>
          {t("subtitle")}
        </p>
      </div>

      {/* What you'll accomplish */}
      <div
        style={{
          background: "#F7F8FA",
          border: "1px solid #E1E3E5",
          borderRadius: 10,
          padding: 24,
          marginBottom: 32,
        }}
      >
        <p style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, color: "#202223" }}>
          {t("accomplishHeading")}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {steps.map((step, i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: "#1D4ED8",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: 2,
                }}
              >
                {i + 1}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: "#202223" }}>{step.title}</div>
                <div style={{ fontSize: 12, color: "#6D7175", marginTop: 2 }}>{step.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 32 }}>
        {[
          { value: t("statTimeValue"), label: t("statTimeLabel") },
          { value: t("statStepsValue"), label: t("statStepsLabel") },
          { value: t("statAutoValue"), label: t("statAutoLabel") },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              border: "1px solid #E1E3E5",
              borderRadius: 8,
              padding: "16px 12px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 700, color: "#1D4ED8", marginBottom: 4 }}>{stat.value}</div>
            <div style={{ fontSize: 12, color: "#6D7175" }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Skip info banner */}
      <div
        style={{
          background: "#EFF6FF",
          border: "1px solid #BFDBFE",
          borderRadius: 8,
          padding: "20px",
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1D4ED8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1E40AF", marginBottom: 4 }}>{t("skipInfoTitle")}</div>
          <div style={{ fontSize: 14, color: "#1E40AF" }}>{t("skipInfoDesc")}</div>
        </div>
      </div>
    </div>
  );
}
