"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import { ShieldCheck } from "lucide-react";

/**
 * Admin passkey enrollment. Reached when a grant-holding admin has no passkey
 * yet (middleware routes them here). Registers Face ID / Windows Hello, then
 * chains straight into an authentication ceremony so the session becomes
 * passkey-verified and lands on /admin.
 */
function EnrollPasskey() {
  const router = useRouter();
  const params = useSearchParams();
  const continueUrl = params.get("continue") || "/admin";

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enroll = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // 1. Registration ceremony.
      const optRes = await fetch("/api/admin/passkeys/register", { method: "POST" });
      if (!optRes.ok) throw new Error("Could not start enrollment.");
      const options = await optRes.json();

      const regResponse = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch("/api/admin/passkeys/register", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response: regResponse,
          friendlyName:
            typeof navigator !== "undefined" ? navigator.platform : null,
        }),
      });
      if (!verifyRes.ok) {
        const j = await verifyRes.json().catch(() => null);
        throw new Error(j?.error ?? "Enrollment failed.");
      }

      // 2. Immediately authenticate so this session is passkey-verified.
      const authOptRes = await fetch("/api/admin/passkeys/authenticate", { method: "POST" });
      if (!authOptRes.ok) throw new Error("Enrolled, but verification failed. Reload and try again.");
      const authOptions = await authOptRes.json();
      const authResponse = await startAuthentication({ optionsJSON: authOptions });
      const authVerify = await fetch("/api/admin/passkeys/authenticate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: authResponse }),
      });
      if (!authVerify.ok) throw new Error("Verification failed after enrollment.");

      router.push(continueUrl);
    } catch (err) {
      // WebAuthn user-cancellation throws NotAllowedError — show a friendly note.
      const msg =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Biometric prompt was dismissed. Try again."
          : err instanceof Error
            ? err.message
            : "Enrollment failed.";
      setError(msg);
      setBusy(false);
    }
  }, [router, continueUrl]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] p-6">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-lg p-8 text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[#EFF6FF] flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-[#1D4ED8]" />
          </div>
          <h1 className="text-2xl font-bold text-[#0F172A] mb-2">Secure your admin access</h1>
          <p className="text-sm text-[#64748B] mb-6">
            Add this device&rsquo;s built-in unlock &mdash; Windows Hello, Touch ID or
            Face ID &mdash; to your admin account. You&rsquo;ll use it every time you
            open the admin panel.
          </p>

          {error && <p className="text-sm text-[#B91C1C] mb-4">{error}</p>}

          <button
            type="button"
            onClick={enroll}
            disabled={busy}
            className="w-full px-5 py-2.5 bg-[#1D4ED8] text-white text-sm font-semibold rounded-lg hover:bg-[#1E40AF] transition-colors disabled:opacity-50"
          >
            {busy ? "Setting up…" : "Set up passkey"}
          </button>

          <p className="mt-4 text-xs text-[#94A3B8]">
            The biometric check stays on your device — DisputeDesk never sees it.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function EnrollPasskeyPage() {
  return (
    <Suspense>
      <EnrollPasskey />
    </Suspense>
  );
}
