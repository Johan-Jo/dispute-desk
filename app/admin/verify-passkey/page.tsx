"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { startAuthentication, WebAuthnAbortService } from "@simplewebauthn/browser";
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
  const activeAttempt = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    const attempt = activeAttempt.current;
    if (!attempt) return;
    activeAttempt.current = null;
    attempt.abort();
    WebAuthnAbortService.cancelCeremony();
    setBusy(false);
    setError("Verification cancelled. You can try again when you’re ready.");
  }, []);

  // Leaving this page must close its ceremony, not leave a native dialog alive.
  useEffect(() => () => {
    if (activeAttempt.current) {
      activeAttempt.current.abort();
      activeAttempt.current = null;
      WebAuthnAbortService.cancelCeremony();
    }
  }, []);

  const verify = useCallback(async () => {
    // A ref closes the gap before React commits the disabled button state.
    if (activeAttempt.current) return;
    const attempt = new AbortController();
    activeAttempt.current = attempt;
    const { signal } = attempt;
    setBusy(true);
    setError(null);
    // Browser timeouts are advisory. Bound the entire round trip ourselves,
    // including a stalled options request or verification response.
    const timeout = window.setTimeout(() => {
      if (activeAttempt.current !== attempt) return;
      cancel();
      setError("Verification timed out. Close any remaining passkey window, then try again.");
    }, 60_000);
    try {
      const optRes = await fetch("/api/admin/passkeys/authenticate", { method: "POST", signal });
      signal.throwIfAborted();
      if (!optRes.ok) {
        const j = await optRes.json().catch(() => null);
        signal.throwIfAborted();
        if (j?.code === "NO_PASSKEY") {
          router.push(`/admin/enroll-passkey?continue=${encodeURIComponent(continueUrl)}`);
          return;
        }
        throw new Error("Could not start verification.");
      }
      const options = await optRes.json();
      signal.throwIfAborted();
      const authResponse = await startAuthentication({ optionsJSON: options });
      signal.throwIfAborted();

      const verifyRes = await fetch("/api/admin/passkeys/authenticate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: authResponse }),
        signal,
      });
      signal.throwIfAborted();
      if (!verifyRes.ok) {
        const j = await verifyRes.json().catch(() => null);
        signal.throwIfAborted();
        throw new Error(j?.error ?? "Verification failed.");
      }

      router.push(continueUrl);
    } catch (err) {
      // A cancelled attempt may settle after a retry has already started.
      if (signal.aborted) return;
      const msg =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Biometric prompt was dismissed. Try again."
          : err instanceof Error
            ? err.message
            : "Verification failed.";
      setError(msg);
    } finally {
      window.clearTimeout(timeout);
      if (activeAttempt.current === attempt) {
        // Release the adapter's controller on success/error too, rather than
        // retaining it until the next ceremony starts.
        WebAuthnAbortService.cancelCeremony();
        activeAttempt.current = null;
        setBusy(false);
      }
    }
  }, [router, continueUrl, cancel]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] p-6">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-lg p-8 text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[#EFF6FF] flex items-center justify-center">
            <Fingerprint className="w-6 h-6 text-[#1D4ED8]" />
          </div>
          <h1 className="text-2xl font-bold text-[#0F172A] mb-2">Confirm it&rsquo;s you</h1>
          <p className="text-sm text-[#64748B] mb-6">
            Select Verify with passkey, then complete your device’s unlock prompt.
          </p>

          {error && <p role="alert" className="text-sm text-[#B91C1C] mb-4">{error}</p>}

          <button
            type="button"
            onClick={verify}
            disabled={busy}
            className="w-full px-5 py-2.5 bg-[#1D4ED8] text-white text-sm font-semibold rounded-lg hover:bg-[#1E40AF] transition-colors disabled:opacity-50"
          >
            {busy ? "Verifying…" : "Verify with passkey"}
          </button>
          {busy && (
            <button
              type="button"
              onClick={cancel}
              className="mt-3 text-sm text-[#64748B] underline"
            >
              Cancel verification
            </button>
          )}
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
