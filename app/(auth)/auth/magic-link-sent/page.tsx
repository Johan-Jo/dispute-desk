"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Mail } from "lucide-react";
import { AuthCard } from "@/components/ui/auth-card";
import { TextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";

function MagicLinkSentContent() {
  const t = useTranslations("auth.magicLinkSent");
  const searchParams = useSearchParams();
  const initialEmail = searchParams.get("email") ?? "";
  const continueUrl = searchParams.get("continue") ?? "/portal/dashboard";

  const [email, setEmail] = useState(initialEmail);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResend = async () => {
    if (!email) return;
    setError(null);

    const ddLocale =
      document.cookie.match(/(?:^|;\s*)dd_locale=([^;]+)/)?.[1] ??
      navigator.language;

    const res = await fetch("/api/auth/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        locale: ddLocale,
        redirectTo: continueUrl !== "/portal/dashboard" ? continueUrl : undefined,
      }),
    });

    if (!res.ok) setError(t("errResend"));
    else setResent(true);
  };

  return (
    <AuthCard title={t("title")} subtitle={t("subtitle")}>
      <div className="text-center py-6">
        <div className="w-16 h-16 bg-[#EFF6FF] rounded-full flex items-center justify-center mx-auto mb-4">
          <Mail className="w-8 h-8 text-[#4F46E5]" />
        </div>
        <p className="text-[#667085] mb-6">{t("body")}</p>
      </div>

      <div className="space-y-3">
        <TextField
          type="email"
          label={t("email")}
          placeholder={t("emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button variant="secondary" className="w-full" onClick={handleResend} disabled={!email}>
          {resent ? t("sentAgain") : t("resend")}
        </Button>
        {error && <p className="text-sm text-[#EF4444] text-center">{error}</p>}
        <a href="/auth/sign-in">
          <Button variant="ghost" className="w-full">
            {t("backToSignIn")}
          </Button>
        </a>
      </div>
    </AuthCard>
  );
}

export default function MagicLinkSentPage() {
  return (
    <Suspense>
      <MagicLinkSentContent />
    </Suspense>
  );
}
