"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createBrowserClient } from "@supabase/ssr";
import { Info } from "lucide-react";
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

function SignInForm() {
  const t = useTranslations("auth.signIn");
  const ta = useTranslations("auth");
  const router = useRouter();
  const searchParams = useSearchParams();
  const continueUrl = searchParams.get("continue") ?? "/portal/dashboard";
  const isDirectVisit = !searchParams.get("continue");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shopStep, setShopStep] = useState(false);
  const [shopInput, setShopInput] = useState("");
  const [shopError, setShopError] = useState<string | null>(null);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(email)) {
      setError(t("errValidEmail"));
      return;
    }
    if (!password) {
      setError(t("errPasswordRequired"));
      return;
    }
    setError(null);
    setLoading(true);

    const supabase = getSupabase();
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });

    if (err) {
      setError(err.message);
      setLoading(false);
    } else {
      router.push(continueUrl);
    }
  };

  const handleMagicLink = async () => {
    if (!isValidEmail(email)) {
      setError(t("errValidEmailFirst"));
      return;
    }
    setError(null);
    setLoading(true);

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

    if (!res.ok) {
      setError(t("errMagicLinkFailed"));
      setLoading(false);
      return;
    }

    const sentUrl = new URL("/auth/magic-link-sent", window.location.origin);
    sentUrl.searchParams.set("email", email);
    if (continueUrl !== "/portal/dashboard") sentUrl.searchParams.set("continue", continueUrl);
    router.push(sentUrl.pathname + sentUrl.search);
  };

  return (
    <AuthCard
      title={t("title")}
      subtitle={t("subtitle")}
      footer={
        <p>
          {t("footerNoAccount")}{" "}
          <a href="/auth/sign-up" className="text-[#4F46E5] font-medium hover:underline">
            {t("createOne")}
          </a>
        </p>
      }
    >
      {isDirectVisit && (
        <div className="flex items-start gap-2.5 bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg px-4 py-3 mb-1">
          <Info className="w-4 h-4 text-[#1D4ED8] flex-shrink-0 mt-0.5" />
          <p className="text-sm text-[#1D4ED8]">
            {ta("shopifyBanner")}{" "}
            <a href="/" className="font-medium underline">{ta("shopifyBannerCta")}</a>
          </p>
        </div>
      )}

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

      <form onSubmit={handleSignIn} className="space-y-4">
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
          required
          onChange={(e) => setPassword(e.target.value)}
        />

        <div className="text-right">
          <a href="/auth/forgot-password" className="text-sm text-[#4F46E5] hover:underline">
            {t("forgotPassword")}
          </a>
        </div>

        {error && <p className="text-sm text-[#EF4444]" data-testid="sign-in-error">{error}</p>}

        <Button type="submit" variant="primary" className="w-full" disabled={loading}>
          {loading ? t("signingIn") : t("submit")}
        </Button>
      </form>

      <div className="text-center">
        <button
          onClick={handleMagicLink}
          disabled={loading}
          className="text-sm text-[#4F46E5] hover:underline disabled:opacity-50"
        >
          {t("sendMagicLink")}
        </button>
      </div>
    </AuthCard>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
