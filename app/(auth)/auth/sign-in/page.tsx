"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { AuthCard } from "@/components/ui/auth-card";
import { TextField } from "@/components/ui/text-field";
import { PasswordField } from "@/components/ui/password-field";
import { Button } from "@/components/ui/button";
import { OAuthButton } from "@/components/ui/oauth-button";
import { Divider } from "@/components/ui/divider";

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = getSupabase();
    const { error: err } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (err) {
      setError(err.message);
      setLoading(false);
    } else {
      window.location.href = "/portal/dashboard";
    }
  };

  const handleMagicLink = async () => {
    if (!email) return;
    setError(null);
    setLoading(true);

    const supabase = getSupabase();
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/portal/dashboard`,
      },
    });

    if (err) {
      setError(err.message);
      setLoading(false);
    } else {
      window.location.href = "/auth/magic-link-sent";
    }
  };

  return (
    <AuthCard
      title="Sign in"
      subtitle="Enter your credentials to access your account"
      footer={
        <p>
          Don&apos;t have an account?{" "}
          <a href="/auth/sign-up" className="text-[#4F46E5] font-medium hover:underline">
            Create one
          </a>
        </p>
      }
    >
      <OAuthButton provider="shopify" onClick={() => {
        window.location.href = "/api/auth/shopify?source=portal&return_to=/portal/select-store";
      }}>
        Continue with Shopify
      </OAuthButton>

      <Divider label="or" />

      <form onSubmit={handleSignIn} className="space-y-4">
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
          placeholder="Enter your password"
          required
          onChange={(e) => setPassword(e.target.value)}
        />

        <div className="text-right">
          <a href="/auth/forgot-password" className="text-sm text-[#4F46E5] hover:underline">
            Forgot password?
          </a>
        </div>

        {error && <p className="text-sm text-[#EF4444]" data-testid="sign-in-error">{error}</p>}

        <Button type="submit" variant="primary" className="w-full" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </Button>
      </form>

      <div className="text-center">
        <button
          onClick={handleMagicLink}
          disabled={!email || loading}
          className="text-sm text-[#4F46E5] hover:underline disabled:opacity-50"
        >
          Send magic link instead
        </button>
      </div>
    </AuthCard>
  );
}
