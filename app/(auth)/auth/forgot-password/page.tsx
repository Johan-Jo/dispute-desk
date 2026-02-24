"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { AuthCard } from "@/components/ui/auth-card";
import { TextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = getSupabase();
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });

    if (err) setError(err.message);
    else setSent(true);
    setLoading(false);
  };

  if (sent) {
    return (
      <AuthCard title="Check your email" subtitle={`If an account exists for ${email}, we sent a reset link.`}>
        <a href="/auth/sign-in" className="block text-center text-sm text-[#4F46E5] hover:underline mt-4">
          Back to sign in
        </a>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter your email to receive a password reset link"
      footer={
        <p>
          Remember your password?{" "}
          <a href="/auth/sign-in" className="text-[#4F46E5] font-medium hover:underline">Sign in</a>
        </p>
      }
    >
      <form onSubmit={handleReset} className="space-y-4">
        <TextField
          type="email"
          label="Email"
          placeholder="you@company.com"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {error && <p className="text-sm text-[#EF4444]">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" disabled={loading}>
          {loading ? "Sending..." : "Send reset link"}
        </Button>
      </form>
    </AuthCard>
  );
}
