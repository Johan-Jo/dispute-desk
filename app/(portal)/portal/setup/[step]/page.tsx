"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { STEP_IDS } from "@/lib/setup/constants";
import type { StepId } from "@/lib/setup/types";
import { PortalSetupWizardShell } from "@/components/setup/PortalSetupWizardShell";
import { PortalWelcomeGoalsStep } from "@/components/setup/PortalWelcomeGoalsStep";

const STEP_CTA: Partial<
  Record<StepId, { href: string; label: string; ask: string }>
> = {
  connection: {
    href: "/portal/connect-shopify",
    label: "Connect your Shopify store",
    ask: "Connect your Shopify store—you’ll sign in with Shopify and grant the access we need to read disputes, orders, and upload evidence. When you’re done, come back here and click Save & Continue.",
  },
  store_profile: {
    href: "/portal/policies",
    label: "Tell us about your store",
    ask: "Fill in your store profile and define your store policies. Policies strengthen your dispute evidence. When you’re done, come back and click Save & Continue.",
  },
  coverage: {
    href: "/portal/disputes",
    label: "Review dispute coverage",
    ask: "Review your dispute coverage settings and evidence packs. Each pack is tailored to a dispute type and collects the right documents automatically. When you’re ready, come back and click Save & Continue.",
  },
  automation: {
    href: "/portal/rules",
    label: "Configure automation",
    ask: "Configure rules to automate your dispute workflow. Install our suggested starter rules or create custom ones. When you’re done, come back and click Save & Continue.",
  },
  activate: {
    href: "/portal/dashboard",
    label: "Activate protection",
    ask: "Review your setup and activate live dispute protection. When you’re ready, click Save & Continue to go live.",
  },
};

function PortalStepStub({ stepId }: { stepId: StepId }) {
  const cta = STEP_CTA[stepId];
  if (!cta) return null;
  return (
    <div>
      <p className="text-sm text-[#667085] mb-4">{cta.ask}</p>
      <Link
        href={cta.href}
        className="inline-flex items-center text-sm font-medium text-[#1D4ED8] hover:underline"
      >
        {cta.label} →
      </Link>
    </div>
  );
}

function StepPageInner() {
  const params = useParams<{ step: string }>();
  const stepId = params.step as StepId;

  if (!STEP_IDS.includes(stepId)) {
    return (
      <div className="max-w-xl mx-auto py-12 text-center">
        <p className="text-[#667085] mb-4">Step not found. Please return to the dashboard.</p>
        <Link href="/portal/dashboard" className="text-[#1D4ED8] hover:underline">
          Dashboard
        </Link>
      </div>
    );
  }

  const saveRef = { current: null as (() => Promise<boolean>) | null };

  const handleSave = async (): Promise<boolean> => {
    if (saveRef.current) {
      return saveRef.current();
    }
    const res = await fetch("/api/setup/step", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ stepId, payload: {} }),
    });
    return res.ok;
  };

  const stepContent =
    stepId === "store_profile" ? (
      <PortalWelcomeGoalsStep stepId={stepId} onSaveRef={saveRef} />
    ) : (
      <PortalStepStub stepId={stepId} />
    );

  return (
    <PortalSetupWizardShell stepId={stepId} onSave={handleSave}>
      {stepContent}
    </PortalSetupWizardShell>
  );
}

export default function PortalSetupStepPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-4xl mx-auto py-8 flex justify-center p-12">
          <div className="h-8 w-8 rounded-full border-2 border-[#1D4ED8] border-t-transparent animate-spin" />
        </div>
      }
    >
      <StepPageInner />
    </Suspense>
  );
}
