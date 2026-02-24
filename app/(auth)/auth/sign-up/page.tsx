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

export default function SignUpPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = getSupabase();
    const { error: err } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/portal/dashboard`,
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
      subtitle="Start managing disputes more effectively"
      footer={
        <p>
          Already have an account?{" "}
          <a href="/auth/sign-in" className="text-[#4F46E5] font-medium hover:underline">
            Sign in
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
          placeholder="Create a strong password"
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
