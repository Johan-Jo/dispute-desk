"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createBrowserClient } from "@supabase/ssr";
import { AuthCard } from "@/components/ui/auth-card";
import { TextField } from "@/components/ui/text-field";
import { PasswordField } from "@/components/ui/password-field";
import { Button } from "@/components/ui/button";
import { OAuthButton } from "@/components/ui/oauth-button";
import { Divider } from "@/components/ui/divider";

function normalizeShopDomain(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const domain = trimmed.endsWith(".myshopify.com")
    ? trimmed
    : `${trimmed}.myshopify.com`;
  const [subdomain] = domain.split(".");
  if (!/^[a-z0-9-]+$/.test(subdomain)) return null;
  return domain;
}

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function SignUpPage() {
  const t = useTranslations("auth.signUp");
  const invitedShop =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("invited_shop") ?? ""
      : "";
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [shopStep, setShopStep] = useState(false);
  const [shopInput, setShopInput] = useState("");
  const [shopError, setShopError] = useState<string | null>(null);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setError(t("errFullName"));
      return;
    }
    if (!isValidEmail(email)) {
      setError(t("errValidEmail"));
      return;
    }
    if (password.length < 8) {
      setError(t("errPasswordLen"));
      return;
    }
    setError(null);
    setLoading(true);

    const confirmUrl = new URL("/api/auth/confirm", window.location.origin);
    const redirectAfter = invitedShop
      ? `/auth/open-in-shopify?shop=${encodeURIComponent(invitedShop)}`
      : "/portal/dashboard";
    confirmUrl.searchParams.set("redirect", redirectAfter);
    confirmUrl.searchParams.set("type", "signup");

    const supabase = getSupabase();
    const { error: err } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: confirmUrl.toString(),
      },
    });

    if (err) {
      setError(err.message);
    } else {
      setSuccess(true);
    }
    setLoading(false);
  };

  if (success) {
    return (
      <AuthCard
        title={t("successTitle")}
        subtitle={t("successSubtitle", { email })}
      >
        <div className="text-center py-4">
          <p className="text-sm text-[#667085]">{t("successBody")}</p>
        </div>
        <a href="/auth/sign-in" className="block text-center text-sm text-[#4F46E5] hover:underline">
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
          {t("footerHasAccount")}{" "}
          <a href="/auth/sign-in" className="text-[#4F46E5] font-medium hover:underline">
            {t("signInLink")}
          </a>
        </p>
      }
    >
      {shopStep ? (
        <div className="space-y-2">
          <TextField
            type="text"
            label={t("shopLabel")}
            placeholder={t("shopPlaceholder")}
            value={shopInput}
            onChange={(e) => {
              setShopInput(e.target.value);
              setShopError(null);
            }}
            autoFocus
          />
          <p className="text-xs text-[#667085]">{t("shopHint")}</p>
          {shopError && <p className="text-sm text-[#EF4444]">{shopError}</p>}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="primary"
              className="flex-1"
              onClick={() => {
                const domain = normalizeShopDomain(shopInput);
                if (!domain) {
                  setShopError(t("shopErrorInvalid"));
                  return;
                }
                window.location.href =
                  `/api/auth/shopify?shop=${encodeURIComponent(domain)}&source=portal&return_to=${encodeURIComponent("/auth/open-in-shopify")}`;
              }}
            >
              {t("continue")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShopStep(false);
                setShopInput("");
                setShopError(null);
              }}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <OAuthButton provider="shopify" onClick={() => setShopStep(true)}>
          {t("continueWithShopify")}
        </OAuthButton>
      )}

      <Divider label={t("or")} />

      <form onSubmit={handleSignUp} className="space-y-4">
        <TextField
          type="text"
          label={t("fullName")}
          placeholder={t("fullNamePlaceholder")}
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <TextField
          type="email"
          label={t("email")}
          placeholder={t("emailPlaceholder")}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField
          label={t("password")}
          placeholder={t("passwordPlaceholder")}
          showStrength
          required
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <p className="text-sm text-[#EF4444]">{error}</p>}

        <Button type="submit" variant="primary" className="w-full" disabled={loading}>
          {loading ? t("creating") : t("createAccount")}
        </Button>
      </form>
    </AuthCard>
  );
}
