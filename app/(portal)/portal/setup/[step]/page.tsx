"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { STEP_IDS } from "@/lib/setup/constants";
import type { StepId } from "@/lib/setup/types";
import { PortalSetupWizardShell } from "@/components/setup/PortalSetupWizardShell";
import { PortalWelcomeGoalsStep } from "@/components/setup/PortalWelcomeGoalsStep";

const STEP_CTA: Record<StepId, { href: string; label: string }> = {
  welcome_goals: { href: "/portal/setup/welcome_goals", label: "Set your goals" },
  permissions: { href: "/portal/connect-shopify", label: "Verify permissions" },
  sync_disputes: { href: "/portal/disputes", label: "Sync disputes" },
  business_policies: { href: "/portal/policies", label: "Add business policies" },
  evidence_sources: { href: "/portal/packs", label: "Connect evidence sources" },
  automation_rules: { href: "/portal/rules", label: "Configure automation" },
  team_notifications: { href: "/portal/team", label: "Invite team members" },
};

function PortalStepStub({ stepId }: { stepId: StepId }) {
  const cta = STEP_CTA[stepId];
  return (
    <div>
      <p className="text-sm text-[#667085] mb-4">
        Complete this step to continue your setup.
      </p>
      {cta && (
        <Link
          href={cta.href}
          className="inline-flex items-center text-sm font-medium text-[#1D4ED8] hover:underline"
        >
          {cta.label} →
        </Link>
      )}
      <p className="text-xs text-[#94A3B8] mt-4">
        Click &quot;Save &amp; Continue&quot; below when done to mark this step complete.
      </p>
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
