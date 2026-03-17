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
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 0 8px", gap: 32 }}>
      {/* Logo + heading */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
        <div
          style={{
            width: 72,
            height: 72,
            background: "linear-gradient(135deg, #1D4ED8 0%, #1e40af 100%)",
            borderRadius: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="40" height="40" viewBox="0 0 24 24" fill="white">
            <path d="M12 2L4 5v6c0 5.25 3.4 10.15 8 11.35C17.6 21.15 21 16.25 21 11V5l-9-3zm0 2.18l7 2.33V11c0 4.13-2.72 7.98-7 9.17-4.28-1.19-7-5.04-7-9.17V6.51l7-2.33zM10.59 14l-2.83-2.83 1.41-1.41L10.59 11.17l4.24-4.24 1.41 1.41L10.59 14z" />
          </svg>
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#202223", lineHeight: 1.2 }}>
            {t("title")}
          </h1>
          <p style={{ margin: "8px 0 0", fontSize: 15, color: "#6D7175" }}>
            {t("subtitle")}
          </p>
        </div>
      </div>

      {/* What you'll accomplish */}
      <div
        style={{
          width: "100%",
          border: "1px solid #E1E3E5",
          borderRadius: 12,
          padding: 20,
          background: "#F7F8FA",
        }}
      >
        <p style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 600, color: "#202223" }}>
          {t("accomplishHeading")}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {steps.map((step, i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: "#1D4ED8",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#202223" }}>{step.title}</div>
                <div style={{ fontSize: 13, color: "#6D7175", marginTop: 2 }}>{step.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", width: "100%", gap: 12 }}>
        {[
          { value: t("statTimeValue"), label: t("statTimeLabel") },
          { value: t("statStepsValue"), label: t("statStepsLabel") },
          { value: t("statAutoValue"), label: t("statAutoLabel") },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              flex: 1,
              border: "1px solid #E1E3E5",
              borderRadius: 8,
              padding: "14px 12px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 700, color: "#1D4ED8" }}>{stat.value}</div>
            <div style={{ fontSize: 12, color: "#6D7175", marginTop: 4 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Skip info banner */}
      <div
        style={{
          width: "100%",
          background: "#EFF6FF",
          border: "1px solid #BFDBFE",
          borderRadius: 8,
          padding: "12px 16px",
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="#1D4ED8" style={{ flexShrink: 0, marginTop: 1 }}>
          <path d="M10 2a8 8 0 1 0 0 16A8 8 0 0 0 10 2zm0 2a6 6 0 1 1 0 12A6 6 0 0 1 10 4zm-.5 4h1v5h-1V8zm0-2.5h1v1h-1v-1z" />
        </svg>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1E40AF" }}>{t("skipInfoTitle")}</div>
          <div style={{ fontSize: 13, color: "#1E40AF", marginTop: 2 }}>{t("skipInfoDesc")}</div>
        </div>
      </div>
    </div>
  );
}
