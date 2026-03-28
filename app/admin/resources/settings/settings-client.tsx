"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { Info, GripVertical, Sparkles, AlertTriangle, HelpCircle } from "lucide-react";
import { ADMIN_LOCALES } from "@/lib/resources/workflow";

interface SettingsClientProps {
  initial: Record<string, unknown>;
}

interface Settings {
  defaultPublishTimeUtc: string;
  weekendsEnabled: boolean;
  autoSaveDrafts: boolean;
  skipIfTranslationIncomplete: boolean;
  localePriority: string[];
  requireReviewer: boolean;
  archiveHealthThreshold: number;
  defaultCta: string;
  defaultDisclaimer: string;
  legalReviewEmail: string;
  autopilotEnabled: boolean;
  autopilotArticlesPerDay: number;
  autopilotNotifyEmail: string;
  autopilotStartedAt: string | null;
}

const DEFAULT_SETTINGS: Settings = {
  defaultPublishTimeUtc: "09:00",
  weekendsEnabled: false,
  autoSaveDrafts: true,
  skipIfTranslationIncomplete: true,
  localePriority: ADMIN_LOCALES.map((l) => l.dbLocale),
  requireReviewer: false,
  archiveHealthThreshold: 50,
  defaultCta: "none",
  defaultDisclaimer: "",
  legalReviewEmail: "",
  autopilotEnabled: false,
  autopilotArticlesPerDay: 1,
  autopilotNotifyEmail: "oi@johan.com.br",
  autopilotStartedAt: null,
};

function mergeSettings(raw: Record<string, unknown>): Settings {
  return { ...DEFAULT_SETTINGS, ...raw } as Settings;
}

const CTA_OPTIONS = [
  { value: "none", label: "None" },
  { value: "free_trial", label: "Free Trial" },
  { value: "demo_request", label: "Demo Request" },
  { value: "newsletter", label: "Newsletter Signup" },
  { value: "download", label: "Resource Download" },
];

export function SettingsClient({ initial }: SettingsClientProps) {
  const [settings, setSettings] = useState<Settings>(() => mergeSettings(initial));
  const [saved, setSaved] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const autoSave = useCallback((next: Settings) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/admin/resources/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        if (res.ok) {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        }
      } catch {
        // silent
      }
    }, 800);
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      autoSave(next);
      return next;
    });
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function moveLocale(index: number, direction: -1 | 1) {
    const to = index + direction;
    if (to < 0 || to >= settings.localePriority.length) return;
    const next = [...settings.localePriority];
    [next[index], next[to]] = [next[to], next[index]];
    update("localePriority", next);
  }

  return (
    <div className="p-6 lg:p-8 max-w-[900px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#0B1220]">Settings</h1>
        <p className="text-sm text-[#64748B] mt-1">
          Configure publishing, translation, and workflow preferences
        </p>
      </div>

      {/* Auto-save notice */}
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl mb-6 transition-colors ${saved ? "bg-[#EFF6FF] border border-[#BFDBFE]" : "bg-[#F8FAFC] border border-[#E5E7EB]"}`}>
        <Info className={`w-4 h-4 shrink-0 ${saved ? "text-[#1D4ED8]" : "text-[#64748B]"}`} />
        <p className={`text-sm ${saved ? "text-[#1D4ED8] font-medium" : "text-[#64748B]"}`}>
          {saved ? "Settings Auto-saved — Your changes are automatically saved." : "Changes are automatically saved as you edit."}
        </p>
      </div>

      <div className="space-y-8">
        {/* Publishing Settings */}
        <section className="bg-white border border-[#E5E7EB] rounded-xl p-6">
          <h2 className="text-lg font-semibold text-[#0B1220] mb-4">Publishing Settings</h2>
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-[#0B1220] mb-1">
                Default publish time
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={settings.defaultPublishTimeUtc}
                  onChange={(e) => update("defaultPublishTimeUtc", e.target.value)}
                  className="px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]"
                />
                <span className="text-xs text-[#64748B] bg-[#F1F5F9] px-2 py-1 rounded">UTC</span>
              </div>
            </div>
            <Toggle
              label="Weekend publishing"
              description="Allow publishing on Saturdays and Sundays"
              checked={settings.weekendsEnabled}
              onChange={(v) => update("weekendsEnabled", v)}
            />
            <Toggle
              label="Auto-save drafts"
              description="Automatically save editor changes every 30 seconds"
              checked={settings.autoSaveDrafts}
              onChange={(v) => update("autoSaveDrafts", v)}
            />
          </div>
        </section>

        {/* Translation Settings */}
        <section className="bg-white border border-[#E5E7EB] rounded-xl p-6">
          <h2 className="text-lg font-semibold text-[#0B1220] mb-4">Translation Settings</h2>
          <div className="space-y-5">
            <Toggle
              label="Skip incomplete translations"
              description="Do not publish localizations that haven't been fully translated"
              checked={settings.skipIfTranslationIncomplete}
              onChange={(v) => update("skipIfTranslationIncomplete", v)}
            />
            <div>
              <label className="block text-sm font-medium text-[#0B1220] mb-2">
                Locale priority
              </label>
              <p className="text-xs text-[#64748B] mb-3">
                Drag to reorder. English is always required.
              </p>
              <div className="space-y-1">
                {settings.localePriority.map((locale, idx) => {
                  const info = ADMIN_LOCALES.find((l) => l.dbLocale === locale);
                  const isEnglish = locale === "en-US";
                  return (
                    <div
                      key={locale}
                      className="flex items-center gap-3 px-3 py-2 bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg"
                    >
                      <button
                        onClick={() => moveLocale(idx, -1)}
                        disabled={idx === 0}
                        className="p-0.5 disabled:opacity-30"
                      >
                        <GripVertical className="w-4 h-4 text-[#C4C8CD]" />
                      </button>
                      <span className="text-lg">{info?.flag ?? "🌐"}</span>
                      <span className="text-sm text-[#0B1220] font-medium">{info?.nativeName ?? locale}</span>
                      <span className="text-xs text-[#64748B]">{locale}</span>
                      {isEnglish && (
                        <span className="ml-auto text-xs font-medium text-[#1D4ED8] bg-[#EFF6FF] px-2 py-0.5 rounded">
                          Required
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Workflow Settings */}
        <section className="bg-white border border-[#E5E7EB] rounded-xl p-6">
          <h2 className="text-lg font-semibold text-[#0B1220] mb-4">Workflow Settings</h2>
          <div className="space-y-5">
            <Toggle
              label="Require reviewer before publishing"
              description="Content must have an assigned reviewer and be approved before publishing"
              checked={settings.requireReviewer}
              onChange={(v) => update("requireReviewer", v)}
            />
            <div>
              <label className="block text-sm font-medium text-[#0B1220] mb-1">
                Archive health threshold
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={settings.archiveHealthThreshold}
                  onChange={(e) => update("archiveHealthThreshold", parseInt(e.target.value) || 50)}
                  className="w-24 px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]"
                />
                <span className="text-sm text-[#64748B]">items</span>
              </div>
              <p className="text-xs text-[#64748B] mt-1">
                Minimum number of archive items before queue health warnings appear
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0B1220] mb-1">
                Default CTA
              </label>
              <select
                value={settings.defaultCta}
                onChange={(e) => update("defaultCta", e.target.value)}
                className="w-full max-w-xs px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]"
              >
                {CTA_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* AI Autopilot */}
        <section className="bg-white border border-[#E5E7EB] rounded-xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#8B5CF6]" />
              <h2 className="text-lg font-semibold text-[#0B1220]">AI Autopilot</h2>
            </div>
            <Link
              href="/admin/help#help-autopilot"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1D4ED8] hover:underline"
            >
              <HelpCircle className="w-4 h-4 shrink-0" aria-hidden />
              Learn how autopilot works
            </Link>
          </div>
          <div className="space-y-5">
            <Toggle
              label="Enable autopilot mode"
              description="Automatically generate and publish articles from the backlog without manual approval"
              checked={settings.autopilotEnabled}
              onChange={(v) => {
                update("autopilotEnabled", v);
                if (v && !settings.autopilotStartedAt) {
                  update("autopilotStartedAt", new Date().toISOString());
                }
              }}
            />
            {settings.autopilotEnabled && (
              <>
                <div className="flex items-start gap-3 px-4 py-3 bg-[#FEF3C7] border border-[#FDE68A] rounded-xl">
                  <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0 mt-0.5" />
                  <p className="text-sm text-[#92400E]">
                    Autopilot bypasses editorial and legal review. Generated articles are published directly. The first 5 articles are published one per day as an initial burst.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0B1220] mb-1">
                    Articles per day (after initial 5-day burst)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={settings.autopilotArticlesPerDay}
                      onChange={(e) => update("autopilotArticlesPerDay", Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                      className="w-24 px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8B5CF6]/20 focus:border-[#8B5CF6]"
                    />
                    <span className="text-sm text-[#64748B]">articles / day</span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0B1220] mb-1">
                    Notification email
                  </label>
                  <input
                    type="email"
                    value={settings.autopilotNotifyEmail}
                    onChange={(e) => update("autopilotNotifyEmail", e.target.value)}
                    placeholder="oi@johan.com.br"
                    className="w-full max-w-sm px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8B5CF6]/20 focus:border-[#8B5CF6]"
                  />
                  <p className="text-xs text-[#64748B] mt-1">
                    Receive an email with the article link each time autopilot publishes
                  </p>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Legal & Disclaimer */}
        <section className="bg-white border border-[#E5E7EB] rounded-xl p-6">
          <h2 className="text-lg font-semibold text-[#0B1220] mb-4">Legal & Disclaimer</h2>
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-[#0B1220] mb-1">
                Default legal disclaimer
              </label>
              <textarea
                value={settings.defaultDisclaimer}
                onChange={(e) => update("defaultDisclaimer", e.target.value)}
                placeholder="This content is for informational purposes only..."
                rows={4}
                className="w-full px-4 py-3 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8] resize-y"
              />
              <p className="text-xs text-[#64748B] mt-1">
                Applied automatically to new articles unless overridden
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0B1220] mb-1">
                Legal review team email
              </label>
              <input
                type="email"
                value={settings.legalReviewEmail}
                onChange={(e) => update("legalReviewEmail", e.target.value)}
                placeholder="legal@example.com"
                className="w-full max-w-sm px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]"
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ── Toggle component ──────────────────────────────────────────────── */

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-[#0B1220]">{label}</p>
        <p className="text-xs text-[#64748B] mt-0.5">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${
          checked ? "bg-[#1D4ED8]" : "bg-[#D1D5DB]"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : ""
          }`}
        />
      </button>
    </div>
  );
}
