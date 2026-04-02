"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AuthCard } from "@/components/ui/auth-card";
import { TextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth.forgotPassword");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    if (!res.ok) setError(t("errGeneric"));
    else setSent(true);
    setLoading(false);
  };

  if (sent) {
    return (
      <AuthCard title={t("titleCheck")} subtitle={t("subtitleSent", { email })}>
        <a href="/auth/sign-in" className="block text-center text-sm text-[#4F46E5] hover:underline mt-4">
          {t("backToSignIn")}
        </a>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t("title")}
      subtitle={t("subtitle")}
      footer={
        <p>
          {t("footerRemember")}{" "}
          <a href="/auth/sign-in" className="text-[#4F46E5] font-medium hover:underline">
            {t("signIn")}
          </a>
        </p>
      }
    >
      <form onSubmit={handleReset} className="space-y-4">
        <TextField
          type="email"
          label={t("email")}
          placeholder={t("emailPlaceholder")}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {error && <p className="text-sm text-[#EF4444]">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" disabled={loading}>
          {loading ? t("sending") : t("sendLink")}
        </Button>
      </form>
    </AuthCard>
  );
}
