"use client";

import { useState } from "react";
import { AuthCard } from "@/components/ui/auth-card";
import { TextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";

export default function ForgotPasswordPage() {
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

    if (!res.ok) setError("Something went wrong. Please try again.");
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
