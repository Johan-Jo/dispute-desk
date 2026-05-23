"use client";

/**
 * Demo-mode runtime wrapper.
 *
 * - Installs `lib/demo/demoFetch` on mount when demo mode is active.
 * - Listens for `dd:demo-mutation` events and shows a non-blocking toast
 *   ("Demo mode: no changes were sent to Shopify").
 * - Renders a small dismissible corner indicator so the dev/QA team can
 *   tell at a glance they're in demo mode. The indicator is opt-out
 *   (`?demo=true&demoBadge=off`) so App Store screenshots stay clean.
 */

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { isDemoMode } from "@/lib/demo/isDemoMode";
import { DEMO_MUTATION_EVENT, installDemoFetchInterceptor } from "@/lib/demo/demoFetch";

interface ToastState {
  id: number;
  label: string;
}

export function DemoModeProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const active = isDemoMode(searchParams ?? undefined);
  const showBadge = active && searchParams?.get("demoBadge") !== "off";

  const [toast, setToast] = useState<ToastState | null>(null);
  const installedRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    if (installedRef.current) return;
    installedRef.current = true;

    const uninstall = installDemoFetchInterceptor();

    const onMutation = (e: Event) => {
      const detail = (e as CustomEvent<{ label?: string }>).detail ?? {};
      setToast({ id: Date.now(), label: detail.label ?? "Action" });
    };
    window.addEventListener(DEMO_MUTATION_EVENT, onMutation);

    return () => {
      window.removeEventListener(DEMO_MUTATION_EVENT, onMutation);
      uninstall();
      installedRef.current = false;
    };
  }, [active]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <>
      {children}
      {showBadge ? <DemoBadge /> : null}
      {toast ? <DemoToast label={toast.label} /> : null}
    </>
  );
}

function DemoBadge() {
  return (
    <div
      data-dd-demo-badge
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        zIndex: 9999,
        padding: "4px 10px",
        borderRadius: 999,
        background: "rgba(17, 24, 39, 0.78)",
        color: "#ffffff",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        pointerEvents: "none",
        boxShadow: "0 2px 6px rgba(0,0,0,0.18)",
      }}
    >
      Demo
    </div>
  );
}

function DemoToast({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 48,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        padding: "10px 16px",
        borderRadius: 8,
        background: "#111827",
        color: "#ffffff",
        fontSize: 13,
        fontWeight: 500,
        boxShadow: "0 8px 24px rgba(0,0,0,0.24)",
      }}
    >
      Demo mode — {label} not sent to Shopify
    </div>
  );
}
