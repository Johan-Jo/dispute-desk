"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import type { StepId } from "@/lib/setup/types";

interface Template {
  id: string;
  name: string;
  short_description: string;
  dispute_type: string | null;
  is_recommended: boolean;
}

interface PacksStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

export function PacksStep({ stepId, onSaveRef }: PacksStepProps) {
  const t = useTranslations("setup.packs");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedPackMode, setSelectedPackMode] = useState<"fraud_auto" | "pnr_review" | "all_auto">("fraud_auto");

  useEffect(() => {
    fetch("/api/templates?locale=en-US")
      .then((r) => r.json())
      .then((data: { templates: Template[] }) => {
        const list = data.templates ?? [];
        setSelected(new Set(list.filter((t) => t.is_recommended).map((t) => t.id)));
      })
      .catch(() => {})
      .finally(() => {});
  }, []);

  useEffect(() => {
    onSaveRef.current = async () => {
      const selectedIds = Array.from(selected);

      for (const id of selectedIds) {
        const res = await fetch(`/api/templates/${id}/install`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!res.ok) return false;
      }

      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId,
          payload: {
            installedTemplates: Array.from(selected),
            selectedPackMode,
          },
        }),
      });
      return res.ok;
    };
  }, [stepId, onSaveRef, selected, selectedPackMode]);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex flex-col items-center text-center mb-10">
        <div className="w-16 h-16 rounded-[14px] bg-[#D89A2B] flex items-center justify-center mb-5">
          <FileText className="w-7 h-7 text-white" />
        </div>
        <h2 className="leading-[34px] text-[#202223] mb-2" style={{ fontWeight: 700, fontSize: 26 }}>
          {t("figmaTitle")}
        </h2>
        <p className="leading-[24px] text-[#6D7175] max-w-[720px]" style={{ fontSize: 15 }}>
          {t("figmaSubtitle")}
        </p>
      </div>

      <div className="space-y-4">
        {([
          { id: "fraud_auto", title: t("optionFraudTitle"), desc: t("optionFraudDesc") },
          { id: "pnr_review", title: t("optionPnrTitle"), desc: t("optionPnrDesc") },
          { id: "all_auto", title: t("optionAllAutoTitle"), desc: t("optionAllAutoDesc") },
        ] as const).map((option) => {
          const active = selectedPackMode === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setSelectedPackMode(option.id)}
              className="w-full text-left border rounded-[14px] px-6 py-6 transition-colors bg-white"
              style={{ borderColor: active ? "#1D4ED8" : "#E1E3E5" }}
            >
              <div className="flex items-start gap-4">
                <div className="mt-0.5">
                  <span
                    className="inline-flex items-center justify-center rounded-full border"
                    style={{
                      width: 22,
                      height: 22,
                      borderColor: active ? "#1D4ED8" : "#C9CCCF",
                      background: active ? "#EFF6FF" : "#FFFFFF",
                    }}
                  >
                    {active && <span className="w-2.5 h-2.5 rounded-full bg-[#1D4ED8]" />}
                  </span>
                </div>
                <div>
                  <p className="text-[#202223] mb-2 leading-[28px]" style={{ fontWeight: 700, fontSize: 31 }}>
                    {option.title}
                  </p>
                  <p className="text-[#6D7175] leading-[22px]" style={{ fontSize: 14 }}>
                    {option.desc}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 bg-[#FFF7ED] border border-[#FCD9A4] rounded-[14px] p-5">
        <p className="text-[#7C2D12] mb-1" style={{ fontWeight: 700, fontSize: 16 }}>
          {t("changeLaterTitle")}
        </p>
        <p className="text-[#9A3412]" style={{ fontSize: 14 }}>
          {t("changeLaterDesc")}
        </p>
      </div>
    </div>
  );
}
