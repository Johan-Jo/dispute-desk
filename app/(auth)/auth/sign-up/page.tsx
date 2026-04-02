"use client";

import { useState } from "react";
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
      setError("Full name is required.");
      return;
    }
    if (!isValidEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setError(null);
    setLoading(true);

    // emailRedirectTo is echoed in the Send Email hook; the link uses token_hash → /api/auth/confirm.
    const confirmUrl = new URL("/api/auth/confirm", window.location.origin);
    confirmUrl.searchParams.set("redirect", "/portal/dashboard");
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
      <AuthCard title="Check your email" subtitle={`We sent a confirmation link to ${email}`}>
        <div className="text-center py-4">
          <p className="text-sm text-[#667085]">Click the link in the email to activate your account.</p>
        </div>
        <a href="/auth/sign-in" className="block text-center text-sm text-[#4F46E5] hover:underline">
          Back to sign in
        </a>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Connect your store — we’ll open Shopify Admin so you can finish setup in the embedded app."
      footer={
        <p>
          Already have an account?{" "}
          <a href="/auth/sign-in" className="text-[#4F46E5] font-medium hover:underline">
            Sign in
          </a>
        </p>
      }
    >
      {shopStep ? (
        <div className="space-y-2">
          <TextField
            type="text"
            label="Your Shopify store"
            placeholder="yourstore.myshopify.com"
            value={shopInput}
            onChange={(e) => { setShopInput(e.target.value); setShopError(null); }}
            autoFocus
          />
          <p className="text-xs text-[#667085]">
            After you authorize DisputeDesk, you’ll land in the app inside Shopify Admin. You can always use the web portal later.
          </p>
          {shopError && <p className="text-sm text-[#EF4444]">{shopError}</p>}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="primary"
              className="flex-1"
              onClick={() => {
                const domain = normalizeShopDomain(shopInput);
                if (!domain) {
                  setShopError("Enter a valid store name, e.g. yourstore or yourstore.myshopify.com");
                  return;
                }
                window.location.href =
                  `/api/auth/shopify?shop=${encodeURIComponent(domain)}&source=portal&return_to=${encodeURIComponent("/auth/open-in-shopify")}`;
              }}
            >
              Continue
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => { setShopStep(false); setShopInput(""); setShopError(null); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <OAuthButton provider="shopify" onClick={() => setShopStep(true)}>
          Continue with Shopify
        </OAuthButton>
      )}

      <Divider label="or" />

      <form onSubmit={handleSignUp} className="space-y-4">
        <TextField
          type="text"
          label="Full Name"
          placeholder="John Doe"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <TextField
          type="email"
          label="Email"
          placeholder="you@company.com"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField
          label="Password"
          placeholder="Create a strong password (min. 8 characters)"
          showStrength
          required
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <p className="text-sm text-[#EF4444]">{error}</p>}

        <Button type="submit" variant="primary" className="w-full" disabled={loading}>
          {loading ? "Creating account..." : "Create account"}
        </Button>
      </form>
    </AuthCard>
  );
}
