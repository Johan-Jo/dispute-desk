"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { Info, GripVertical, Sparkles, AlertTriangle, HelpCircle, Loader2 } from "lucide-react";
import { ADMIN_LOCALES } from "@/lib/resources/workflow";
import {
  DEFAULT_CONTENT_TYPE_INSTRUCTIONS,
  DEFAULT_LOCALE_INSTRUCTIONS,
  DEFAULT_SYSTEM_PROMPT,
} from "@/lib/resources/generation/prompts";

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
  /** Empty string = server uses built-in default system prompt */
  generationSystemPrompt: string;
  /** Appended to every generation user message (stringent / policy directions) */
  generationUserPromptSuffix: string;
  generationLocaleInstructions: Record<string, string>;
  generationContentTypeInstructions: Record<string, string>;
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
  autopilotNotifyEmail: "",
  autopilotStartedAt: null,
  generationSystemPrompt: "",
  generationUserPromptSuffix: "",
  generationLocaleInstructions: { ...DEFAULT_LOCALE_INSTRUCTIONS },
  generationContentTypeInstructions: { ...DEFAULT_CONTENT_TYPE_INSTRUCTIONS },
};

const CONTENT_TYPE_PROMPT_KEYS = [
  { key: "cluster_article", label: "Cluster article" },
  { key: "pillar_page", label: "Pillar page" },
  { key: "template", label: "Template" },
  { key: "legal_update", label: "Legal update" },
  { key: "glossary_entry", label: "Glossary entry" },
  { key: "faq_entry", label: "FAQ entry" },
] as const;

function mergeSettings(raw: Record<string, unknown>): Settings {
  const genLoc = {
    ...DEFAULT_LOCALE_INSTRUCTIONS,
    ...(typeof raw.generationLocaleInstructions === "object" && raw.generationLocaleInstructions !== null
      ? (raw.generationLocaleInstructions as Record<string, string>)
      : {}),
  };
  const genCt = {
    ...DEFAULT_CONTENT_TYPE_INSTRUCTIONS,
    ...(typeof raw.generationContentTypeInstructions === "object" && raw.generationContentTypeInstructions !== null
      ? (raw.generationContentTypeInstructions as Record<string, string>)
      : {}),
  };
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    generationLocaleInstructions: genLoc,
    generationContentTypeInstructions: genCt,
    generationSystemPrompt:
      typeof raw.generationSystemPrompt === "string" ? raw.generationSystemPrompt : DEFAULT_SETTINGS.generationSystemPrompt,
    generationUserPromptSuffix:
      typeof raw.generationUserPromptSuffix === "string"
        ? raw.generationUserPromptSuffix
        : DEFAULT_SETTINGS.generationUserPromptSuffix,
  } as Settings;
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
  const [cronLoading, setCronLoading] = useState<null | "autopilot" | "publish" | "repair" | "readingTimeBackfill" | "regenerateInlineLinks" | "archiveAllAi">(null);
  const [cronFeedback, setCronFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [testEmailLoading, setTestEmailLoading] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState<{ ok: boolean; message: string } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const autoSave = useCallback((next: Settings) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const payload: Record<string, unknown> = { ...next };
        if (
          typeof next.generationUserPromptSuffix === "string" &&
          !next.generationUserPromptSuffix.trim()
        ) {
          delete payload.generationUserPromptSuffix;
        }
        const res = await fetch("/api/admin/resources/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
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

  function updateLocaleInstr(locale: string, value: string) {
    setSettings((prev) => {
      const next: Settings = {
        ...prev,
        generationLocaleInstructions: { ...prev.generationLocaleInstructions, [locale]: value },
      };
      autoSave(next);
      return next;
    });
  }

  function updateContentTypeInstr(key: string, value: string) {
    setSettings((prev) => {
      const next: Settings = {
        ...prev,
        generationContentTypeInstructions: { ...prev.generationContentTypeInstructions, [key]: value },
      };
      autoSave(next);
      return next;
    });
  }

  function resetGenerationPrompts() {
    setSettings((prev) => {
      const next: Settings = {
        ...prev,
        generationSystemPrompt: "",
        generationUserPromptSuffix: "",
        generationLocaleInstructions: { ...DEFAULT_LOCALE_INSTRUCTIONS },
        generationContentTypeInstructions: { ...DEFAULT_CONTENT_TYPE_INSTRUCTIONS },
      };
      autoSave(next);
      return next;
    });
  }

  function insertBuiltinSystemPrompt() {
    setSettings((prev) => {
      const next = { ...prev, generationSystemPrompt: DEFAULT_SYSTEM_PROMPT };
      autoSave(next);
      return next;
    });
  }

  const usesBuiltinSystemPrompt = settings.generationSystemPrompt.trim() === "";

  function setUseBuiltinSystemPrompt(useBuiltin: boolean) {
    if (useBuiltin) {
      update("generationSystemPrompt", "");
      return;
    }
    setSettings((prev) => {
      const next: Settings = {
        ...prev,
        generationSystemPrompt:
          prev.generationSystemPrompt.trim() === "" ? DEFAULT_SYSTEM_PROMPT : prev.generationSystemPrompt,
      };
      autoSave(next);
      return next;
    });
  }

  async function runCron(kind: "autopilot" | "publish") {
    setCronLoading(kind);
    setCronFeedback(null);
    try {
      const path =
        kind === "autopilot"
          ? "/api/admin/resources/cron/autopilot"
          : "/api/admin/resources/cron/publish";
      const res = await fetch(path, { method: "POST" });
      const data: unknown = await res.json().catch(() => ({}));
      const text =
        typeof data === "object" && data !== null
          ? JSON.stringify(data, null, 2)
          : String(data);
      if (!res.ok) {
        setCronFeedback({ ok: false, text: text || res.statusText });
      } else {
        setCronFeedback({ ok: true, text });
      }
    } catch (e) {
      setCronFeedback({
        ok: false,
        text: e instanceof Error ? e.message : "Request failed",
      });
    } finally {
      setCronLoading(null);
    }
  }

  async function runPublishRepair() {
    setCronLoading("repair");
    setCronFeedback(null);
    try {
      const res = await fetch("/api/admin/resources/publish-repair", { method: "POST" });
      const data: unknown = await res.json().catch(() => ({}));
      const text =
        typeof data === "object" && data !== null
          ? JSON.stringify(data, null, 2)
          : String(data);
      if (!res.ok) {
        setCronFeedback({ ok: false, text: text || res.statusText });
      } else {
        setCronFeedback({ ok: true, text });
      }
    } catch (e) {
      setCronFeedback({
        ok: false,
        text: e instanceof Error ? e.message : "Request failed",
      });
    } finally {
      setCronLoading(null);
    }
  }

  async function runReadingTimeBackfill() {
    setCronLoading("readingTimeBackfill");
    setCronFeedback(null);
    try {
      const res = await fetch("/api/admin/resources/reading-time-backfill", { method: "POST" });
      const data: unknown = await res.json().catch(() => ({}));
      const text =
        typeof data === "object" && data !== null
          ? JSON.stringify(data, null, 2)
          : String(data);
      if (!res.ok) {
        setCronFeedback({ ok: false, text: text || res.statusText });
      } else {
        setCronFeedback({ ok: true, text });
      }
    } catch (e) {
      setCronFeedback({
        ok: false,
        text: e instanceof Error ? e.message : "Request failed",
      });
    } finally {
      setCronLoading(null);
    }
  }

  async function runArchiveAllAi(dryRun = false) {
    if (!dryRun && !confirm(
      "This will archive ALL AI-generated articles so autopilot can regenerate them.\n\nRun a dry-run first to see what would be affected. Proceed?"
    )) return;
    setCronLoading("archiveAllAi");
    setCronFeedback(null);
    try {
      const res = await fetch("/api/admin/resources/archive-ai-articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const data: unknown = await res.json().catch(() => ({}));
      const text =
        typeof data === "object" && data !== null
          ? JSON.stringify(data, null, 2)
          : String(data);
      setCronFeedback({ ok: res.ok, text: res.ok ? text : text || res.statusText });
    } catch (e) {
      setCronFeedback({ ok: false, text: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setCronLoading(null);
    }
  }

  async function runRegenerateInlineLinks() {
    setCronLoading("regenerateInlineLinks");
    setCronFeedback(null);
    try {
      const res = await fetch("/api/admin/resources/regenerate-with-inline-links", { method: "POST" });
      const data: unknown = await res.json().catch(() => ({}));
      const text =
        typeof data === "object" && data !== null
          ? JSON.stringify(data, null, 2)
          : String(data);
      setCronFeedback({ ok: res.ok, text: res.ok ? text : text || res.statusText });
    } catch (e) {
      setCronFeedback({ ok: false, text: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setCronLoading(null);
    }
  }

  async function sendTestEmail() {
    if (!settings.autopilotNotifyEmail.trim()) return;
    setTestEmailLoading(true);
    setTestEmailResult(null);
    try {
      const res = await fetch("/api/admin/resources/send-test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: settings.autopilotNotifyEmail.trim() }),
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (res.ok) {
        setTestEmailResult({ ok: true, message: "Test email sent — check your inbox (and spam folder)." });
      } else {
        const err = typeof data.error === "string" ? data.error : res.statusText;
        setTestEmailResult({ ok: false, message: `Failed: ${err}` });
      }
    } catch (e) {
      setTestEmailResult({ ok: false, message: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setTestEmailLoading(false);
    }
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
                if (v && !settings.autopilotStartedAt) {
                  setSettings((prev) => {
                    const next = { ...prev, autopilotEnabled: true, autopilotStartedAt: new Date().toISOString() };
                    autoSave(next);
                    return next;
                  });
                } else {
                  update("autopilotEnabled", v);
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
              </>
            )}
            <div>
              <label className="block text-sm font-medium text-[#0B1220] mb-1">
                Publish notification email
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="email"
                  value={settings.autopilotNotifyEmail}
                  onChange={(e) => update("autopilotNotifyEmail", e.target.value)}
                  placeholder="you@example.com"
                  className="w-full max-w-sm px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8B5CF6]/20 focus:border-[#8B5CF6]"
                />
                <button
                  type="button"
                  disabled={!settings.autopilotNotifyEmail.trim() || testEmailLoading}
                  onClick={sendTestEmail}
                  className="shrink-0 px-3 py-2 text-sm font-medium rounded-lg border border-[#E5E7EB] bg-white text-[#0B1220] hover:bg-[#F8FAFC] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {testEmailLoading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : "Send test"}
                </button>
              </div>
              <p className="text-xs text-[#64748B] mt-1">
                Receive an email each time an article is published via the queue. Use &ldquo;Send test&rdquo; to verify delivery.
              </p>
              {testEmailResult && (
                <p className={`text-xs mt-1 font-medium ${testEmailResult.ok ? "text-green-700" : "text-red-700"}`}>
                  {testEmailResult.message}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* AI generation prompts (OpenAI) */}
        <section className="bg-white border border-[#E5E7EB] rounded-xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#0EA5E9]" />
              <h2 className="text-lg font-semibold text-[#0B1220]">AI generation prompts</h2>
            </div>
            <button
              type="button"
              onClick={resetGenerationPrompts}
              className="text-sm font-medium text-[#64748B] hover:text-[#0B1220] underline"
            >
              Reset prompts to defaults
            </button>
          </div>
          <p className="text-sm text-[#64748B] mb-5">
            Overrides are stored with other CMS settings. Use the toggle to preview the built-in system prompt
            or switch to a custom one. Use “Additional instructions” for strict editorial rules (e.g. avoid
            duplicate openings across articles).
          </p>
          <div className="space-y-6">
            <div>
              <Toggle
                label="Use built-in system prompt"
                description="On: same text the app ships with (read-only below). Off: edit and save your own system message."
                checked={usesBuiltinSystemPrompt}
                onChange={setUseBuiltinSystemPrompt}
              />
              <div className="mt-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <label className="block text-sm font-medium text-[#0B1220]">
                    {usesBuiltinSystemPrompt ? "Built-in system prompt (what the model receives)" : "Custom system prompt"}
                  </label>
                  {!usesBuiltinSystemPrompt ? (
                    <button
                      type="button"
                      onClick={insertBuiltinSystemPrompt}
                      className="text-xs font-medium text-[#1D4ED8] hover:underline"
                    >
                      Replace with built-in default
                    </button>
                  ) : null}
                </div>
                {usesBuiltinSystemPrompt ? (
                  <pre
                    className="w-full max-h-[min(28rem,55vh)] overflow-auto px-3 py-2 text-xs font-mono whitespace-pre-wrap break-words border border-[#E5E7EB] rounded-lg bg-[#F8FAFC] text-[#334155]"
                    tabIndex={0}
                  >
                    {DEFAULT_SYSTEM_PROMPT}
                  </pre>
                ) : (
                  <textarea
                    value={settings.generationSystemPrompt}
                    onChange={(e) => update("generationSystemPrompt", e.target.value)}
                    placeholder="System prompt sent as the model’s system role…"
                    rows={10}
                    className="w-full px-3 py-2 text-xs font-mono border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/20 focus:border-[#0EA5E9] resize-y"
                  />
                )}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0B1220] mb-1">
                Additional instructions (every generation)
              </label>
              <textarea
                value={settings.generationUserPromptSuffix}
                onChange={(e) => update("generationUserPromptSuffix", e.target.value)}
                placeholder="e.g. Vary titles and excerpts so two articles on a similar topic do not read like duplicates…"
                rows={4}
                className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/20 focus:border-[#0EA5E9] resize-y"
              />
              <p className="text-xs text-[#64748B] mt-1">
                Appended to the user message before the model is asked to return JSON.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#0B1220] mb-3">Locale style lines</h3>
              <p className="text-xs text-[#64748B] mb-3">
                Shown for every locale in the backlog generator. If you clear a locale to an empty string and
                save, the server falls back to the built-in line for that locale.
              </p>
              <div className="space-y-3">
                {ADMIN_LOCALES.map((loc) => (
                  <div key={loc.dbLocale}>
                    <label className="block text-xs font-medium text-[#64748B] mb-1">
                      {loc.flag} {loc.nativeName}{" "}
                      <span className="text-[#94A3B8]">({loc.dbLocale})</span>
                    </label>
                    <textarea
                      value={settings.generationLocaleInstructions[loc.dbLocale] ?? ""}
                      onChange={(e) => updateLocaleInstr(loc.dbLocale, e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 text-xs border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/20 focus:border-[#0EA5E9] resize-y"
                    />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#0B1220] mb-3">Content-type instructions</h3>
              <div className="space-y-3">
                {CONTENT_TYPE_PROMPT_KEYS.map(({ key, label }) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-[#64748B] mb-1">{label}</label>
                    <textarea
                      value={settings.generationContentTypeInstructions[key] ?? ""}
                      onChange={(e) => updateContentTypeInstr(key, e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 text-xs border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/20 focus:border-[#0EA5E9] resize-y"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Manual cron triggers */}
        <section className="bg-white border border-[#E5E7EB] rounded-xl p-6">
          <h2 className="text-lg font-semibold text-[#0B1220] mb-1">Run scheduled tasks now</h2>
          <p className="text-sm text-[#64748B] mb-4">
            Same logic as Vercel Cron (autopilot generate, then publish queue with email and SEO
            pings). Autopilot respects the toggle above and server{" "}
            <code className="text-xs bg-[#F1F5F9] px-1 rounded">GENERATION_ENABLED</code> / OpenAI
            settings.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={cronLoading !== null}
              onClick={() => runCron("autopilot")}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-[#0B1220] text-white hover:bg-[#1E293B] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cronLoading === "autopilot" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                  Running…
                </>
              ) : (
                "Run autopilot now"
              )}
            </button>
            <button
              type="button"
              disabled={cronLoading !== null}
              onClick={() => runCron("publish")}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-[#E5E7EB] bg-white text-[#0B1220] hover:bg-[#F8FAFC] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cronLoading === "publish" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                  Running…
                </>
              ) : (
                "Process publish queue now"
              )}
            </button>
            <button
              type="button"
              disabled={cronLoading !== null}
              onClick={() => runPublishRepair()}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-amber-200 bg-amber-50 text-amber-950 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cronLoading === "repair" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                  Running…
                </>
              ) : (
                "Repair stuck publishes"
              )}
            </button>
            <button
              type="button"
              disabled={cronLoading !== null}
              onClick={() => runReadingTimeBackfill()}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-[#E5E7EB] bg-white text-[#0B1220] hover:bg-[#F8FAFC] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cronLoading === "readingTimeBackfill" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                  Running…
                </>
              ) : (
                "Backfill read time"
              )}
            </button>
            <button
              type="button"
              disabled={cronLoading !== null}
              onClick={() => runRegenerateInlineLinks()}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-red-200 bg-red-50 text-red-900 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cronLoading === "regenerateInlineLinks" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                  Scanning…
                </>
              ) : (
                "Archive articles with inline links"
              )}
            </button>
            <button
              type="button"
              disabled={cronLoading !== null}
              onClick={() => runArchiveAllAi(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-[#E5E7EB] bg-white text-[#0B1220] hover:bg-[#F8FAFC] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cronLoading === "archiveAllAi" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                  Checking…
                </>
              ) : (
                "Dry-run: archive all AI articles"
              )}
            </button>
            <button
              type="button"
              disabled={cronLoading !== null}
              onClick={() => runArchiveAllAi(false)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-red-300 bg-red-100 text-red-900 hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cronLoading === "archiveAllAi" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                  Archiving…
                </>
              ) : (
                "Archive ALL AI articles"
              )}
            </button>
          </div>
          <p className="text-xs text-[#64748B] mt-3">
            If the content list shows <strong>Published</strong> but no date and articles are missing on the hub, click{" "}
            <strong>Repair stuck publishes</strong>. If new cards are missing read time, run{" "}
            <strong>Backfill read time</strong>. To regenerate all AI articles (e.g. after a prompt or token limit fix),
            dry-run first to see counts, then click <strong>Archive ALL AI articles</strong> — autopilot will regenerate them.
          </p>
          {cronFeedback && (
            <pre
              className={`mt-4 text-xs p-3 rounded-lg overflow-x-auto max-h-64 overflow-y-auto font-mono border ${
                cronFeedback.ok
                  ? "bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]"
                  : "bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]"
              }`}
            >
              {cronFeedback.text}
            </pre>
          )}
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
