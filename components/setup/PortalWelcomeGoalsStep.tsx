"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import type { StepId } from "@/lib/setup/types";

interface PortalWelcomeGoalsStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

export function PortalWelcomeGoalsStep({ stepId, onSaveRef }: PortalWelcomeGoalsStepProps) {
  const t = useTranslations("setup");
  const [goal, setGoal] = useState<string>("");

  useEffect(() => {
    onSaveRef.current = async () => {
      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          stepId,
          payload: goal ? { primaryGoal: goal } : {},
        }),
      });
      return res.ok;
    };
  }, [stepId, onSaveRef, goal]);

  return (
    <div>
      <h2 className="text-lg font-semibold text-[#0B1220] mb-2">
        {t("welcomeGoals.title")}
      </h2>
      <p className="text-sm text-[#667085] mb-6">
        {t("welcomeGoals.subtitle")}
      </p>

      <div className="space-y-3 mb-6">
        <label className="flex items-start gap-3 p-3 rounded-lg border border-[#E5E7EB] hover:bg-[#F7F8FA] cursor-pointer has-[:checked]:border-[#1D4ED8] has-[:checked]:bg-[#EFF6FF]">
          <input
            type="radio"
            name="goal"
            value="win"
            checked={goal === "win"}
            onChange={() => setGoal("win")}
            className="mt-1 w-4 h-4 text-[#1D4ED8]"
          />
          <div>
            <p className="text-sm font-medium text-[#0B1220]">{t("welcomeGoals.goalWin")}</p>
            <p className="text-xs text-[#667085]">{t("welcomeGoals.goalWinDesc")}</p>
          </div>
        </label>
        <label className="flex items-start gap-3 p-3 rounded-lg border border-[#E5E7EB] hover:bg-[#F7F8FA] cursor-pointer has-[:checked]:border-[#1D4ED8] has-[:checked]:bg-[#EFF6FF]">
          <input
            type="radio"
            name="goal"
            value="automate"
            checked={goal === "automate"}
            onChange={() => setGoal("automate")}
            className="mt-1 w-4 h-4 text-[#1D4ED8]"
          />
          <div>
            <p className="text-sm font-medium text-[#0B1220]">{t("welcomeGoals.goalAutomate")}</p>
            <p className="text-xs text-[#667085]">{t("welcomeGoals.goalAutomateDesc")}</p>
          </div>
        </label>
        <label className="flex items-start gap-3 p-3 rounded-lg border border-[#E5E7EB] hover:bg-[#F7F8FA] cursor-pointer has-[:checked]:border-[#1D4ED8] has-[:checked]:bg-[#EFF6FF]">
          <input
            type="radio"
            name="goal"
            value="prevent"
            checked={goal === "prevent"}
            onChange={() => setGoal("prevent")}
            className="mt-1 w-4 h-4 text-[#1D4ED8]"
          />
          <div>
            <p className="text-sm font-medium text-[#0B1220]">{t("welcomeGoals.goalPrevent")}</p>
            <p className="text-xs text-[#667085]">{t("welcomeGoals.goalPreventDesc")}</p>
          </div>
        </label>
      </div>

      <div className="p-4 bg-[#EFF6FF] rounded-lg border border-[#C7D2FE]">
        <p className="text-sm font-medium text-[#0B1220] mb-2">
          {t("welcomeGoals.achieveTitle")}
        </p>
        <ul className="space-y-1 text-sm text-[#667085]">
          <li className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0" />
            {t("welcomeGoals.achieve1")}
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0" />
            {t("welcomeGoals.achieve2")}
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0" />
            {t("welcomeGoals.achieve3")}
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0" />
            {t("welcomeGoals.achieve4")}
          </li>
        </ul>
      </div>
    </div>
  );
}
