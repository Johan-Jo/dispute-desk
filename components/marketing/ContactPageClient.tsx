"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import {
  MessageCircle,
  Calendar,
  Mail,
  Rocket,
  Settings,
  FileText,
  Handshake,
  ChevronDown,
  Check,
  X,
} from "lucide-react";
import { MarketingSiteHeader } from "@/components/marketing/MarketingSiteHeader";
import { MarketingSiteFooter } from "@/components/marketing/MarketingSiteFooter";
import { MARKETING_PAGE_CONTAINER_CLASS } from "@/lib/marketing/pageContainer";

const DEMO_URL = "https://cal.com/disputedesk/demo";
const SUPPORT_EMAIL = "support@disputedesk.com";

/**
 * Attempt to open the global Tawk chat widget.
 * The TawkChatWidget renders a toggle button at bottom-right; we click it
 * programmatically. Falls back to scrolling the page down so the user
 * notices the chat bubble.
 */
function openTawkChat() {
  // The TawkChatWidget renders a <button> with aria-label="Chat"
  const btn = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Chat"]'
  );
  if (btn) {
    btn.click();
    return;
  }
  // Fallback: scroll to bottom so the user sees the chat bubble
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
}

const HELP_CARDS = [
  { key: "GettingStarted", icon: Rocket },
  { key: "Setup", icon: Settings },
  { key: "Workflows", icon: FileText },
  { key: "Other", icon: Handshake },
] as const;

export function ContactPageClient({ base = "" }: { base?: string }) {
  const t = useTranslations("contact");

  const handleOpenChat = useCallback(() => openTawkChat(), []);

  return (
    <div className="min-h-screen bg-white">
      <MarketingSiteHeader />

      {/* ── Hero ── */}
      <section className="relative overflow-hidden py-16 sm:py-24 lg:py-32 bg-gradient-to-br from-[#0B1220] via-[#1A2744] to-[#0B1220]">
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
          <div className="absolute top-16 left-10 w-80 h-80 rounded-full bg-[#1D4ED8] mix-blend-screen filter blur-3xl opacity-[0.12]" />
          <div className="absolute bottom-10 right-10 w-72 h-72 rounded-full bg-[#3B82F6] mix-blend-screen filter blur-3xl opacity-[0.10]" />
        </div>

        <div className={`${MARKETING_PAGE_CONTAINER_CLASS} relative`}>
          <div className="max-w-2xl mx-auto text-center">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white">
              {t("heroTitle")}
            </h1>
            <p className="mt-4 text-base sm:text-lg text-slate-300 leading-relaxed">
              {t("heroSubtitle")}
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={handleOpenChat}
                className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-semibold text-[#0B1220] shadow-lg hover:bg-slate-50 transition-colors focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#0B1220]"
              >
                <MessageCircle className="h-4 w-4" />
                {t("openChat")}
              </button>
              <a
                href={DEMO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-500 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#0B1220]"
              >
                <Calendar className="h-4 w-4" />
                {t("bookDemo")}
              </a>
            </div>

            <p className="mt-4 text-sm text-slate-400">
              {t("aiNote")}
            </p>
          </div>
        </div>
      </section>

      {/* ── What can we help with? ── */}
      <section className="py-14 sm:py-20 bg-white">
        <div className={MARKETING_PAGE_CONTAINER_CLASS}>
          <h2 className="text-center text-2xl sm:text-3xl font-bold text-[#0B1220]">
            {t("helpTitle")}
          </h2>

          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {HELP_CARDS.map(({ key, icon: Icon }) => (
              <button
                key={key}
                onClick={handleOpenChat}
                className="group rounded-xl border border-[#E5E7EB] bg-white p-6 text-left transition-all hover:border-[#1D4ED8] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#EFF6FF] group-hover:bg-[#1D4ED8] transition-colors">
                  <Icon className="h-5 w-5 text-[#1D4ED8] group-hover:text-white transition-colors" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-[#0B1220]">
                  {t(`help${key}Title`)}
                </h3>
                <p className="mt-1 text-sm text-[#6B7280] leading-relaxed">
                  {t(`help${key}Desc`)}
                </p>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── How to reach us ── */}
      <section className="py-14 sm:py-20 bg-[#F6F8FB]">
        <div className={MARKETING_PAGE_CONTAINER_CLASS}>
          <h2 className="text-center text-2xl sm:text-3xl font-bold text-[#0B1220]">
            {t("reachTitle")}
          </h2>

          <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Chat */}
            <div className="rounded-xl border border-[#E5E7EB] bg-white p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#EFF6FF]">
                <MessageCircle className="h-5 w-5 text-[#1D4ED8]" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-[#0B1220]">
                {t("reachChatTitle")}
              </h3>
              <p className="mt-1 text-sm text-[#6B7280] leading-relaxed">
                {t("reachChatDesc")}
              </p>
              <button
                onClick={handleOpenChat}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1D4ED8] hover:text-[#1E40AF] transition-colors focus:outline-none"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                {t("openChat")}
              </button>
            </div>

            {/* Demo */}
            <div className="rounded-xl border border-[#E5E7EB] bg-white p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#EFF6FF]">
                <Calendar className="h-5 w-5 text-[#1D4ED8]" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-[#0B1220]">
                {t("reachDemoTitle")}
              </h3>
              <p className="mt-1 text-sm text-[#6B7280] leading-relaxed">
                {t("reachDemoDesc")}
              </p>
              <a
                href={DEMO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1D4ED8] hover:text-[#1E40AF] transition-colors"
              >
                <Calendar className="h-3.5 w-3.5" />
                {t("bookDemo")}
              </a>
            </div>

            {/* Email */}
            <div className="rounded-xl border border-[#E5E7EB] bg-white p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#EFF6FF]">
                <Mail className="h-5 w-5 text-[#1D4ED8]" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-[#0B1220]">
                {t("reachEmailTitle")}
              </h3>
              <p className="mt-1 text-sm text-[#6B7280] leading-relaxed">
                {t("reachEmailDesc")}
              </p>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1D4ED8] hover:text-[#1E40AF] transition-colors"
              >
                <Mail className="h-3.5 w-3.5" />
                {SUPPORT_EMAIL}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Fit section ── */}
      <section className="py-14 sm:py-20 bg-white">
        <div className={MARKETING_PAGE_CONTAINER_CLASS}>
          <div className="max-w-2xl mx-auto">
            <h2 className="text-center text-2xl sm:text-3xl font-bold text-[#0B1220]">
              {t("fitTitle")}
            </h2>

            <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="rounded-xl border border-[#D1FAE5] bg-[#F0FDF4] p-6">
                <p className="text-sm font-semibold text-[#059669]">{t("fitBestFor")}</p>
                <ul className="mt-3 space-y-2">
                  {(["fitBest1", "fitBest2", "fitBest3", "fitBest4"] as const).map((key) => (
                    <li key={key} className="flex items-start gap-2 text-sm text-[#374151]">
                      <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#059669]" />
                      {t(key)}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-[#FED7AA] bg-[#FFF7ED] p-6">
                <p className="text-sm font-semibold text-[#C2410C]">{t("fitNotFor")}</p>
                <ul className="mt-3 space-y-2">
                  <li className="flex items-start gap-2 text-sm text-[#374151]">
                    <X className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#C2410C]" />
                    {t("fitNot1")}
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="py-14 sm:py-20 bg-[#F6F8FB]">
        <div className={MARKETING_PAGE_CONTAINER_CLASS}>
          <h2 className="text-center text-2xl sm:text-3xl font-bold text-[#0B1220]">
            {t("faqTitle")}
          </h2>

          <div className="mt-10 max-w-2xl mx-auto space-y-3">
            {([1, 2, 3] as const).map((n) => (
              <FaqItem
                key={n}
                question={t(`faq${n}Q`)}
                answer={t(`faq${n}A`)}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── Closing CTA ── */}
      <section className="py-14 sm:py-20 bg-white">
        <div className={MARKETING_PAGE_CONTAINER_CLASS}>
          <div className="max-w-xl mx-auto text-center">
            <h2 className="text-2xl sm:text-3xl font-bold text-[#0B1220]">
              {t("closingTitle")}
            </h2>
            <p className="mt-3 text-base text-[#6B7280] leading-relaxed">
              {t("closingBody")}
            </p>
            <button
              onClick={handleOpenChat}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#1D4ED8] px-6 py-3 text-sm font-semibold text-white shadow-md hover:bg-[#1E40AF] transition-colors focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:ring-offset-2"
            >
              <MessageCircle className="h-4 w-4" />
              {t("openChat")}
            </button>
          </div>
        </div>
      </section>

      <MarketingSiteFooter />
    </div>
  );
}

/* ── FAQ accordion item ── */

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-5 py-4 text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#1D4ED8] rounded-xl"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-[#0B1220]">{question}</span>
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 text-[#6B7280] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-5 pb-4">
          <p className="text-sm text-[#6B7280] leading-relaxed">{answer}</p>
        </div>
      )}
    </div>
  );
}
