"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { AuthCard } from "@/components/ui/auth-card";
import { PasswordField } from "@/components/ui/password-field";
import { Button } from "@/components/ui/button";

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default function ResetPasswordPage() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = getSupabase();
    const { error: err } = await supabase.auth.updateUser({ password });

    if (err) setError(err.message);
    else setDone(true);
    setLoading(false);
  };

  if (done) {
    return (
      <AuthCard title="Password updated" subtitle="Your password has been reset. You can now sign in.">
        <a href="/auth/sign-in">
          <Button variant="primary" className="w-full">Sign in</Button>
        </a>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Set new password" subtitle="Choose a strong password for your account">
      <form onSubmit={handleReset} className="space-y-4">
        <PasswordField
          label="New password"
          placeholder="Enter new password"
          showStrength
          required
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-sm text-[#EF4444]">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" disabled={loading}>
          {loading ? "Updating..." : "Update password"}
        </Button>
      </form>
    </AuthCard>
  );
}
