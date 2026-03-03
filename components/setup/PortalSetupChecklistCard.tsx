"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressRing } from "./ProgressRing";
import { SETUP_STEPS } from "@/lib/setup/constants";
import type { StepId, StepState, SetupStateResponse } from "@/lib/setup/types";
import { CheckCircle2, XCircle, Circle, Store, Lock } from "lucide-react";
import { useDemoMode } from "@/lib/demo-mode";
import { useTranslations } from "next-intl";

function ConnectStoreChecklist() {
  const t = useTranslations("setup");
  const totalWithConnect = SETUP_STEPS.length + 1;

  return (
    <div
      className="bg-white rounded-lg border border-[#E5E7EB] p-6 mb-8"
      data-testid="setup-checklist-card"
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-4">
          <ProgressRing completed={0} total={totalWithConnect} />
          <div>
            <h2 className="text-lg font-semibold text-[#0B1220]">
              {t("checklistTitle")}
            </h2>
            <p className="text-sm text-[#667085]">
              {t("stepsRemainingPlural", { count: totalWithConnect })}
            </p>
          </div>
        </div>
        <a
          href="/portal/help"
          className="text-sm text-[#1D4ED8] hover:underline"
        >
          {t("needHelp")}
        </a>
      </div>

      <div className="space-y-2 mb-6">
        {/* Step 0: Connect Store */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-[#EFF6FF] border border-[#C7D2FE]">
          <div className="flex items-center gap-3">
            <Store className="w-5 h-5 text-[#4F46E5]" />
            <span className="text-sm font-medium text-[#0B1220]">
              {t("connectStoreTitle")}
            </span>
          </div>
          <a href="/portal/connect-shopify">
            <Button variant="primary" size="sm">
              {t("connectCTA")}
            </Button>
          </a>
        </div>

        {/* Steps 1-7: locked */}
        {SETUP_STEPS.map((stepDef) => (
          <div
            key={stepDef.id}
            className="flex items-center justify-between p-3 rounded-lg opacity-50"
          >
            <div className="flex items-center gap-3">
              <Lock className="w-5 h-5 text-[#CBD5E1]" />
              <span className="text-sm font-medium text-[#94A3B8]">
                {stepDef.dashboardLabel}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <a href="/portal/connect-shopify" className="block">
          <Button variant="primary" className="w-full">
            {t("connectCTA")}
          </Button>
        </a>
        <p className="text-xs text-center text-[#94A3B8]">
          {t("stepsLocked")}
        </p>
      </div>
    </div>
  );
}

const STEP_ROUTES: Record<StepId, string> = {
  welcome_goals: "/portal/settings",
  permissions: "/portal/connect-shopify",
  sync_disputes: "/portal/disputes",
  business_policies: "/portal/policies",
  evidence_sources: "/portal/packs",
  automation_rules: "/portal/rules",
  team_notifications: "/portal/team",
};

function ActiveShopChecklist() {
  const t = useTranslations("setup");
  const router = useRouter();
  const [state, setState] = useState<SetupStateResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/setup/state", { credentials: "same-origin" });
      if (res.ok) {
        const data: SetupStateResponse = await res.json();
        setState(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  const navigateToStep = useCallback(
    (stepId: StepId) => {
      router.push(STEP_ROUTES[stepId] ?? "/portal/dashboard");
    },
    [router]
  );

  const handleContinueSetup = useCallback(() => {
    if (!state?.nextStepId) return;
    // Right after connecting, next step from API is "welcome_goals" (Settings). Send users to
    // Sync disputes instead so they see their data, not the generic Settings page.
    const onlyPermissionsDone =
      state.steps?.permissions?.status === "done" &&
      state.steps?.sync_disputes?.status !== "done" &&
      state.steps?.welcome_goals?.status !== "done";
    const targetStep =
      onlyPermissionsDone && state.nextStepId === "welcome_goals"
        ? "sync_disputes"
        : state.nextStepId;
    navigateToStep(targetStep);
  }, [state, navigateToStep]);

  const handleUndoSkip = useCallback(
    async (stepId: StepId) => {
      await fetch("/api/setup/undo-skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId }),
      });
      await fetchState();
      navigateToStep(stepId);
    },
    [fetchState, navigateToStep]
  );

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 animate-pulse">
        <div className="h-8 bg-[#F1F5F9] rounded w-1/3 mb-4" />
        <div className="h-4 bg-[#F1F5F9] rounded w-1/2" />
      </div>
    );
  }

  if (!state || state.allDone) {
    return null;
  }

  const { steps, progress } = state;
  // Count "Connect your Shopify store" as step 1 of 8 (this view only shows when connected)
  const totalWithConnect = progress.total + 1;
  const doneWithConnect = 1 + progress.doneCount;
  const remaining = totalWithConnect - doneWithConnect;

  return (
    <div
      className="bg-white rounded-lg border border-[#E5E7EB] p-6 mb-8"
      data-testid="setup-checklist-card"
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-4">
          <ProgressRing completed={doneWithConnect} total={totalWithConnect} />
          <div>
            <h2 className="text-lg font-semibold text-[#0B1220]">
              {t("checklistTitle")}
            </h2>
            <p className="text-sm text-[#667085]">
              {remaining === 1
                ? t("stepsRemaining", { count: remaining })
                : t("stepsRemainingPlural", { count: remaining })}
            </p>
          </div>
        </div>
        <a
          href="/portal/help"
          className="text-sm text-[#1D4ED8] hover:underline"
        >
          {t("needHelp")}
        </a>
      </div>

      <div className="space-y-2 mb-6">
        {/* Store connected — show as done */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-[#ECFDF5]">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-[#10B981]" />
            <span className="text-sm font-medium text-[#0B1220]">
              {t("connectStoreTitle")}
            </span>
          </div>
          <Badge variant="success">{t("done")}</Badge>
        </div>

        {SETUP_STEPS.map((stepDef) => {
          const stepState: StepState = steps[stepDef.id] ?? { status: "todo" };
          const isDone = stepState.status === "done";
          const isSkipped = stepState.status === "skipped";

          return (
            <div
              key={stepDef.id}
              className={`flex items-center justify-between p-3 rounded-lg ${
                isDone ? "bg-[#ECFDF5]" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                {isDone ? (
                  <CheckCircle2 className="w-5 h-5 text-[#10B981]" />
                ) : isSkipped ? (
                  <XCircle className="w-5 h-5 text-[#94A3B8]" />
                ) : (
                  <Circle className="w-5 h-5 text-[#94A3B8]" />
                )}
                <span
                  className={`text-sm font-medium ${
                    isSkipped ? "text-[#94A3B8]" : "text-[#0B1220]"
                  }`}
                >
                  {stepDef.dashboardLabel}
                </span>
              </div>

              {isDone && (
                <div className="flex items-center gap-2">
                  <Badge variant="success">{t("done")}</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigateToStep(stepDef.id)}
                    className="text-[#64748B] hover:text-[#0B1220]"
                  >
                    {t("edit")}
                  </Button>
                </div>
              )}
              {isSkipped && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleUndoSkip(stepDef.id)}
                >
                  {t("undoSkip")}
                </Button>
              )}
              {!isDone && !isSkipped && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigateToStep(stepDef.id)}
                >
                  {t("complete")}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <Button variant="primary" onClick={handleContinueSetup}>
          {t("continueSetup")}
        </Button>
        <div>
          <a
            href="mailto:support@disputedesk.com?subject=Setup%20call%20request"
            className="text-sm text-[#64748B] hover:text-[#1D4ED8] hover:underline"
          >
            {t("bookSetupCall")}
          </a>
        </div>
      </div>
    </div>
  );
}

export function PortalSetupChecklistCard() {
  const isDemo = useDemoMode();
  const hasShop = !isDemo;

  if (!hasShop) {
    return <ConnectStoreChecklist />;
  }

  return <ActiveShopChecklist />;
}
