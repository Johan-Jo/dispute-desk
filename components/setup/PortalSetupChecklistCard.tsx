"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ProgressRing } from "./ProgressRing";
import { SETUP_STEPS } from "@/lib/setup/constants";
import type { StepId, StepState, SetupStateResponse } from "@/lib/setup/types";
import { CheckCircle2, XCircle, Circle, Store, Lock } from "lucide-react";
import { useDemoMode, useShopCount } from "@/lib/demo-mode";
import { useTranslations } from "next-intl";

function ConnectStoreChecklist() {
  const t = useTranslations("setup");
  const stepsToShow = SETUP_STEPS.filter((s) => s.id !== "permissions");
  const totalWithConnect = 1 + stepsToShow.length;

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

      <div className="flex flex-wrap gap-2 mb-6">
        <a
          href="/portal/connect-shopify"
          className="flex flex-col items-center text-center py-3 px-3 rounded-lg flex-1 min-w-[100px] max-w-[140px] bg-[#EFF6FF] border-2 border-[#1D4ED8] hover:bg-[#DBEAFE] cursor-pointer"
        >
          <Store className="w-9 h-9 text-[#4F46E5] mb-2" />
          <span className="text-sm font-medium text-[#0B1220]">
            {t("connectStoreTitle")}
          </span>
          <span className="text-xs text-[#1D4ED8] mt-1">{t("connectCTA")}</span>
        </a>
        {SETUP_STEPS.filter((s) => s.id !== "permissions").map((stepDef) => (
          <div
            key={stepDef.id}
            className="flex flex-col items-center text-center py-3 px-3 rounded-lg flex-1 min-w-[100px] max-w-[140px] opacity-50 bg-[#F8FAFC] border-2 border-[#E2E8F0]"
          >
            <Lock className="w-9 h-9 text-[#CBD5E1] mb-2" />
            <span className="text-sm font-medium text-[#94A3B8]">
              {stepDef.dashboardLabel}
            </span>
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
  permissions: "/portal/setup/permissions",
  overview: "/portal/setup/overview",
  disputes: "/portal/setup/disputes",
  packs: "/portal/setup/packs",
  rules: "/portal/setup/rules",
  policies: "/portal/setup/policies",
  billing: "/portal/setup/billing",
  team: "/portal/setup/team",
  settings: "/portal/setup/settings",
  help: "/portal/setup/help",
};

function ActiveShopChecklist({ isDemo }: { isDemo: boolean }) {
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
    navigateToStep(state.nextStepId);
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
  // Permissions are granted when connecting — don't show as separate step
  const stepsToShow = SETUP_STEPS.filter((s) => s.id !== "permissions");
  const permissionsDone = steps.permissions?.status === "done";
  const totalWithConnect = 1 + stepsToShow.length;
  const doneWithConnect = 1 + progress.doneCount - (permissionsDone ? 1 : 0);
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

      <div className="flex flex-wrap gap-2 mb-6">
        {/* Connect store (always done when this checklist is shown) */}
        <div className="flex flex-col items-center text-center py-3 px-3 rounded-lg flex-1 min-w-[100px] max-w-[140px] bg-[#ECFDF5] border-2 border-[#10B981]">
          <CheckCircle2 className="w-9 h-9 text-[#10B981] mb-2" />
          <span className="text-sm font-medium text-[#0B1220]">
            {isDemo ? t("demoStoreConnected") : t("connectStoreTitle")}
          </span>
          <span className="text-xs text-[#64748B] mt-1">{t("done")}</span>
        </div>

        {stepsToShow.map((stepDef) => {
          const stepState: StepState = steps[stepDef.id] ?? { status: "todo" };
          const isDone = stepState.status === "done";
          const isSkipped = stepState.status === "skipped";

          return (
            <div
              key={stepDef.id}
              role="button"
              tabIndex={0}
              onClick={() => navigateToStep(stepDef.id)}
              onKeyDown={(e) =>
                (e.key === "Enter" || e.key === " ") && navigateToStep(stepDef.id)
              }
              className={`flex flex-col items-center text-center py-3 px-3 rounded-lg flex-1 min-w-[100px] max-w-[140px] cursor-pointer border-2 transition-colors ${
                isDone
                  ? "bg-[#ECFDF5] border-[#10B981] hover:bg-[#D1FAE5]"
                  : isSkipped
                    ? "bg-[#F8FAFC] border-[#E2E8F0] hover:bg-[#F1F5F9]"
                    : "bg-[#F6F6F7] border-[#E5E7EB] hover:bg-[#EFF6FF] hover:border-[#1D4ED8]"
              }`}
            >
              {isDone ? (
                <CheckCircle2 className="w-9 h-9 text-[#10B981] mb-2" />
              ) : isSkipped ? (
                <XCircle className="w-9 h-9 text-[#94A3B8] mb-2" />
              ) : (
                <Circle className="w-9 h-9 text-[#94A3B8] mb-2" />
              )}
              <span
                className={`text-sm font-medium ${
                  isSkipped ? "text-[#94A3B8]" : "text-[#0B1220]"
                }`}
              >
                {stepDef.dashboardLabel}
              </span>
              {isDone && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigateToStep(stepDef.id);
                  }}
                  className="mt-2 text-xs text-[#64748B] hover:text-[#0B1220] h-auto py-0"
                >
                  {t("edit")}
                </Button>
              )}
              {isSkipped && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUndoSkip(stepDef.id);
                  }}
                  className="mt-2 text-xs h-auto py-0"
                >
                  {t("undoSkip")}
                </Button>
              )}
              {!isDone && !isSkipped && (
                <span className="text-xs text-[#64748B] mt-1">{t("complete")}</span>
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
  const shopCount = useShopCount();
  // Show full wizard when: real shop selected, or demo (test shop) mode with at least one linked shop
  const showWizard = !isDemo || shopCount > 0;

  if (!showWizard) {
    return <ConnectStoreChecklist />;
  }

  return <ActiveShopChecklist isDemo={isDemo} />;
}
