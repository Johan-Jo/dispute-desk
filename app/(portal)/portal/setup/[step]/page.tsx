"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { STEP_IDS } from "@/lib/setup/constants";
import type { StepId } from "@/lib/setup/types";
import { PortalSetupWizardShell } from "@/components/setup/PortalSetupWizardShell";
import { PortalWelcomeGoalsStep } from "@/components/setup/PortalWelcomeGoalsStep";

const STEP_CTA: Record<
  StepId,
  { href: string; label: string; ask: string }
> = {
  welcome_goals: { href: "/portal/setup/welcome_goals", label: "Set your goals", ask: "" },
  permissions: {
    href: "/portal/connect-shopify",
    label: "Connect your Shopify store",
    ask: "Connect your Shopify store—you'll sign in with Shopify and grant the access we need to read disputes, orders, and upload evidence. When you're done, come back here and click Save & Continue.",
  },
  sync_disputes: {
    href: "/portal/disputes",
    label: "Open Disputes",
    ask: "Import your disputes from Shopify so you can see and manage them in one place. After you've synced, come back and click Save & Continue.",
  },
  business_policies: {
    href: "/portal/policies",
    label: "Open Policies",
    ask: "Define your store policies using our suggested templates or by uploading your own documents. Policies strengthen your dispute evidence. When you're done, come back and click Save & Continue.",
  },
  evidence_sources: {
    href: "/portal/packs",
    label: "Open Packs & Evidence",
    ask: "Set up your evidence packs using our recommended templates. Each pack is tailored to a dispute type and collects the right documents automatically. When you've installed what you need, come back and click Save & Continue.",
  },
  automation_rules: {
    href: "/portal/rules",
    label: "Open Automation Rules",
    ask: "Configure rules to automate your dispute workflow. Install our suggested starter rules or create custom ones. When you're done, come back and click Save & Continue.",
  },
  team_notifications: {
    href: "/portal/team",
    label: "Open Team",
    ask: "Invite teammates and choose how you get notified about disputes. When you're done, come back and click Save & Continue.",
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
    stepId === "welcome_goals" ? (
      <PortalWelcomeGoalsStep onSaveRef={saveRef} />
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
