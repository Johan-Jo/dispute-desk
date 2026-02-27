"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useHelpGuideSafe } from "@/components/help/help-guide-provider";
import { HelpCircle, Book, PlayCircle, MessageCircle, X } from "lucide-react";

export function FloatingHelpButton() {
  const [isOpen, setIsOpen] = useState(false);
  const t = useTranslations("help");
  const router = useRouter();
  const helpGuide = useHelpGuideSafe();

  const actions = [
    {
      id: "help-center",
      label: t("fab.helpCenter"),
      icon: Book,
      color: "#1D4ED8",
      onClick: () => {
        router.push("/portal/help");
        setIsOpen(false);
      },
    },
    {
      id: "quick-tour",
      label: t("fab.quickTour"),
      icon: PlayCircle,
      color: "#22C55E",
      onClick: () => {
        if (helpGuide) helpGuide.startGuide("review-dispute");
        setIsOpen(false);
      },
    },
    {
      id: "contact-support",
      label: t("fab.contactSupport"),
      icon: MessageCircle,
      color: "#F59E0B",
      onClick: () => {
        window.location.href = "mailto:support@disputedesk.com";
        setIsOpen(false);
      },
    },
  ];

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        />
      )}

      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 bg-white rounded-lg shadow-2xl border border-[#E5E7EB] p-2 w-64 animate-in slide-in-from-bottom-2 fade-in duration-200">
          <div className="p-3 border-b border-[#E5E7EB] flex items-center justify-between">
            <h3 className="font-semibold text-[#0B1220] text-sm">{t("fab.title")}</h3>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-[#F6F8FB] rounded transition-colors"
            >
              <X className="w-4 h-4 text-[#667085]" />
            </button>
          </div>
          <div className="py-1">
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={action.onClick}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#F6F8FB] rounded transition-colors text-left"
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${action.color}15` }}
                >
                  <action.icon className="w-4 h-4" style={{ color: action.color }} />
                </div>
                <span className="text-sm font-medium text-[#0B1220]">{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-gradient-to-br from-[#1D4ED8] to-[#1e40af] text-white rounded-full shadow-2xl hover:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] hover:scale-110 transition-all flex items-center justify-center group"
        aria-label={t("fab.title")}
      >
        {isOpen ? (
          <X className="w-6 h-6" />
        ) : (
          <HelpCircle className="w-6 h-6 group-hover:rotate-12 transition-transform" />
        )}
      </button>
    </>
  );
}
