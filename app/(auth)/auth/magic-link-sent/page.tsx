"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { AuthCard } from "@/components/ui/auth-card";
import { Button } from "@/components/ui/button";

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default function MagicLinkSentPage() {
  const [email, setEmail] = useState("");
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResend = async () => {
    if (!email) return;
    setError(null);
    const supabase = getSupabase();
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/portal/dashboard` },
    });
    if (err) setError(err.message);
    else setResent(true);
  };

  return (
    <AuthCard title="Check your inbox" subtitle="We've sent a magic link to your email">
      <div className="text-center py-6">
        <div className="w-16 h-16 bg-[#EFF6FF] rounded-full flex items-center justify-center mx-auto mb-4">
          <Mail className="w-8 h-8 text-[#4F46E5]" />
        </div>
        <p className="text-[#667085] mb-6">
          Click the link in your email to sign in to your account. The link will expire in 15 minutes.
        </p>
      </div>

      <div className="space-y-3">
        <input
          type="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full h-10 px-3 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
        />
        <Button variant="secondary" className="w-full" onClick={handleResend} disabled={!email}>
          {resent ? "Sent again!" : "Resend email"}
        </Button>
        {error && <p className="text-sm text-[#EF4444] text-center">{error}</p>}
        <a href="/auth/sign-in">
          <Button variant="ghost" className="w-full">Back to sign in</Button>
        </a>
      </div>
    </AuthCard>
  );
}
