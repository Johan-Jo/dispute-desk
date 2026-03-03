"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SETUP_STEPS, TOTAL_STEPS, STEP_BY_ID } from "@/lib/setup/constants";
import type { StepId, StepsMap, SetupStateResponse } from "@/lib/setup/types";
import { PortalStepCardsRow } from "./PortalStepCardsRow";
import { PortalWhatThisUnlocksCard } from "./PortalWhatThisUnlocksCard";
import { PortalSetupBottomNav } from "./PortalSetupBottomNav";

interface PortalSetupWizardShellProps {
  stepId: StepId;
  children: React.ReactNode;
  onSave: () => Promise<boolean>;
}

export function PortalSetupWizardShell({
  stepId,
  children,
  onSave,
}: PortalSetupWizardShellProps) {
  const router = useRouter();
  const [state, setState] = useState<SetupStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const stepDef = STEP_BY_ID[stepId];
  const stepIndex = stepDef?.index ?? 1;

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/setup/state", { credentials: "same-origin" });
      if (res.ok) {
        setState(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  const navigateToStep = useCallback(
    (target: StepId) => {
      router.push(`/portal/setup/${target}`);
    },
    [router]
  );

  const getAdjacentStep = useCallback(
    (direction: "prev" | "next"): StepId | null => {
      const idx = SETUP_STEPS.findIndex((s) => s.id === stepId);
      if (direction === "prev" && idx > 0) return SETUP_STEPS[idx - 1].id;
      if (direction === "next" && idx < SETUP_STEPS.length - 1)
        return SETUP_STEPS[idx + 1].id;
      return null;
    },
    [stepId]
  );

  const handleBack = useCallback(() => {
    const prev = getAdjacentStep("prev");
    if (prev) navigateToStep(prev);
  }, [getAdjacentStep, navigateToStep]);

  const handleSaveAndContinue = useCallback(async () => {
    setSaving(true);
    try {
      const ok = await onSave();
      if (ok) {
        const next = getAdjacentStep("next");
        if (next) {
          navigateToStep(next);
        } else {
          router.push("/portal/dashboard");
        }
      }
    } finally {
      setSaving(false);
    }
  }, [onSave, getAdjacentStep, navigateToStep, router]);

  const handleSkip = useCallback(async () => {
    await fetch("/api/setup/skip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ stepId, reason: "do_later" }),
    });
    const next = getAdjacentStep("next");
    if (next) {
      navigateToStep(next);
    } else {
      router.push("/portal/dashboard");
    }
  }, [stepId, getAdjacentStep, navigateToStep, router]);

  if (loading) {
    return (
      <div className="w-full max-w-4xl pt-6 pb-8">
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-12 flex justify-center">
          <div className="h-8 w-8 rounded-full border-2 border-[#1D4ED8] border-t-transparent animate-spin" />
        </div>
      </div>
    );
  }

  const stepsMap: StepsMap = state?.steps ?? {};
  const progressPct = TOTAL_STEPS > 0 ? (stepIndex / TOTAL_STEPS) * 100 : 0;

  return (
    <div className="w-full max-w-4xl pt-6 pb-8">
      <div className="mb-2">
        <Link
          href="/portal/dashboard"
          className="text-sm text-[#64748B] hover:text-[#0B1220]"
        >
          ← Dashboard
        </Link>
      </div>
      <h1 className="text-2xl font-bold text-[#0B1220] mb-1">Setup Wizard</h1>
      <p className="text-sm text-[#667085] mb-6">
        Complete these steps to get DisputeDesk ready for your business
      </p>

      <div className="mt-2 bg-white rounded-lg border border-[#E5E7EB] p-6 mb-6">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-semibold text-[#0B1220]">Progress</span>
          <span className="text-sm text-[#64748B]">
            {stepIndex} of {TOTAL_STEPS}
          </span>
        </div>
        <div className="h-1.5 bg-[#E5E7EB] rounded-full overflow-hidden mb-4">
          <div
            className="h-full bg-[#1D4ED8] rounded-full transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <PortalStepCardsRow
          currentStepId={stepId}
          stepsMap={stepsMap}
          onStepClick={navigateToStep}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        <div className="lg:col-span-2 min-w-0">
          <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
            {children}
            <PortalSetupBottomNav
              onBack={stepIndex > 1 ? handleBack : undefined}
              onSaveAndContinue={handleSaveAndContinue}
              onSkip={
                stepIndex < TOTAL_STEPS ? handleSkip : undefined
              }
              isFirst={stepIndex === 1}
              isLast={stepIndex === TOTAL_STEPS}
              saving={saving}
            />
          </div>
        </div>
        <div className="lg:col-span-1">
          <PortalWhatThisUnlocksCard stepId={stepId} />
        </div>
      </div>
    </div>
  );
}
