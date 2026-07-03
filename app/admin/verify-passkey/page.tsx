"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { Fingerprint } from "lucide-react";

/**
 * Admin passkey verification. Reached when an enrolled admin's session is not
 * yet passkey-verified (fresh password login, or the verified cookie expired).
 * Runs an assertion ceremony; on success the server mints the verified-session
 * cookie and we return to `?continue=`.
 */
function VerifyPasskey() {
  const router = useRouter();
  const params = useSearchParams();
  const continueUrl = params.get("continue") || "/admin";

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const optRes = await fetch("/api/admin/passkeys/authenticate", { method: "POST" });
      if (!optRes.ok) {
        const j = await optRes.json().catch(() => null);
        if (j?.code === "NO_PASSKEY") {
          router.push(`/admin/enroll-passkey?continue=${encodeURIComponent(continueUrl)}`);
          return;
        }
        throw new Error("Could not start verification.");
      }
      const options = await optRes.json();
      const authResponse = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch("/api/admin/passkeys/authenticate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: authResponse }),
      });
      if (!verifyRes.ok) {
        const j = await verifyRes.json().catch(() => null);
        throw new Error(j?.error ?? "Verification failed.");
      }

      router.push(continueUrl);
    } catch (err) {
      const msg =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Biometric prompt was dismissed. Try again."
          : err instanceof Error
            ? err.message
            : "Verification failed.";
      setError(msg);
      setBusy(false);
    }
  }, [router, continueUrl]);

  // Auto-trigger once on load — the biometric prompt is the whole point.
  useEffect(() => {
    verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] p-6">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-lg p-8 text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[#EFF6FF] flex items-center justify-center">
            <Fingerprint className="w-6 h-6 text-[#1D4ED8]" />
          </div>
          <h1 className="text-2xl font-bold text-[#0F172A] mb-2">Confirm it&rsquo;s you</h1>
          <p className="text-sm text-[#64748B] mb-6">
            Use Face ID, Windows Hello, or your security key to open the admin panel.
          </p>

          {error && <p className="text-sm text-[#B91C1C] mb-4">{error}</p>}

          <button
            type="button"
            onClick={verify}
            disabled={busy}
            className="w-full px-5 py-2.5 bg-[#1D4ED8] text-white text-sm font-semibold rounded-lg hover:bg-[#1E40AF] transition-colors disabled:opacity-50"
          >
            {busy ? "Verifying…" : "Verify with passkey"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VerifyPasskeyPage() {
  return (
    <Suspense>
      <VerifyPasskey />
    </Suspense>
  );
}
