"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { withShopParams } from "@/lib/withShopParams";

/* ── Inline SVG icons matching the screenshot ── */

function ShieldIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

function TrendUpIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export default function SetupWelcomePage() {
  const t = useTranslations("setup");
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleGetStarted = () => {
    router.push(withShopParams("/app/setup/connection", searchParams));
  };

  const handleSkip = () => {
    router.push(withShopParams("/app", searchParams));
  };

  const steps = [
    { num: 1, title: t("welcome.step1Title"), desc: t("welcome.step1Desc") },
    { num: 2, title: t("welcome.step2Title"), desc: t("welcome.step2Desc") },
    { num: 3, title: t("welcome.step3Title"), desc: t("welcome.step3Desc") },
    { num: 4, title: t("welcome.step4Title"), desc: t("welcome.step4Desc") },
    { num: 5, title: t("welcome.step5Title"), desc: t("welcome.step5Desc") },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#F6F6F7" }}>
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 24px",
          background: "#fff",
          borderBottom: "1px solid #E1E3E5",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "linear-gradient(135deg, #1D4ED8, #3B82F6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#202223" }}>DisputeDesk</div>
            <div style={{ fontSize: 12, color: "#8C9196" }}>{t("wizardTitle")}</div>
          </div>
        </div>
        <button
          onClick={handleSkip}
          style={{
            background: "none",
            border: "none",
            fontSize: 14,
            color: "#6D7175",
            cursor: "pointer",
            padding: "8px 12px",
          }}
        >
          {t("welcome.skipSetup")}
        </button>
      </div>

      {/* Blue accent line */}
      <div style={{ height: 3, background: "linear-gradient(90deg, #1D4ED8, #3B82F6)" }} />

      {/* Main content */}
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "48px 24px 40px" }}>
        {/* Hero */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: "linear-gradient(135deg, #1D4ED8, #3B82F6)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              marginBottom: 24,
            }}
          >
            <ShieldIcon />
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "#202223", margin: "0 0 12px" }}>
            {t("welcome.title")}
          </h1>
          <p style={{ fontSize: 15, color: "#6D7175", lineHeight: 1.6, maxWidth: 480, margin: "0 auto" }}>
            {t("welcome.subtitle")}
          </p>
        </div>

        {/* 3 benefit cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 36 }}>
          {[
            { icon: <BoltIcon />, color: "#1D4ED8", title: t("welcome.benefitAutoTitle"), desc: t("welcome.benefitAutoDesc") },
            { icon: <TrendUpIcon />, color: "#059669", title: t("welcome.benefitWinTitle"), desc: t("welcome.benefitWinDesc") },
            { icon: <ClockIcon />, color: "#D97706", title: t("welcome.benefitTimeTitle"), desc: t("welcome.benefitTimeDesc") },
          ].map((b) => (
            <div
              key={b.title}
              style={{
                background: "#fff",
                border: "1px solid #E1E3E5",
                borderRadius: 12,
                padding: "24px 16px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: `${b.color}14`,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: b.color,
                  marginBottom: 12,
                }}
              >
                {b.icon}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#202223", marginBottom: 6 }}>
                {b.title}
              </div>
              <div style={{ fontSize: 13, color: "#6D7175", lineHeight: 1.5 }}>
                {b.desc}
              </div>
            </div>
          ))}
        </div>

        {/* What to expect */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #E1E3E5",
            borderRadius: 12,
            padding: "28px 28px 24px",
            marginBottom: 40,
          }}
        >
          <h2 style={{ fontSize: 17, fontWeight: 600, color: "#202223", margin: "0 0 20px" }}>
            {t("welcome.expectTitle")}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {steps.map((s) => (
              <div key={s.num} style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "#1D4ED8",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {s.num}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#202223" }}>{s.title}</div>
                  <div style={{ fontSize: 13, color: "#6D7175", marginTop: 2 }}>{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div style={{ textAlign: "center" }}>
          <button
            onClick={handleGetStarted}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "14px 36px",
              fontSize: 15,
              fontWeight: 600,
              color: "#fff",
              background: "linear-gradient(135deg, #1D4ED8, #1e40af)",
              border: "none",
              borderRadius: 12,
              cursor: "pointer",
              boxShadow: "0 2px 8px rgba(29, 78, 216, 0.3)",
            }}
          >
            <SparkleIcon />
            {t("welcome.getStarted")}
            <ChevronRightIcon />
          </button>
          <p style={{ fontSize: 13, color: "#8C9196", marginTop: 16 }}>
            {t("welcome.timeEstimate")} &bull; {t("welcome.adjustLater")}
          </p>
        </div>
      </div>
    </div>
  );
}
