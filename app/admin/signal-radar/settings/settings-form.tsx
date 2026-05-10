"use client";

import { useState } from "react";
import { Save, Check, AlertCircle } from "lucide-react";
import type { SignalRadarSettings } from "@/lib/signal-radar/settings";

const SOURCE_LABELS: Array<{
  key: keyof SignalRadarSettings;
  title: string;
  description: string;
}> = [
  {
    key: "shopify_community_enabled",
    title: "Shopify Community",
    description:
      "community.shopify.com — official Shopify forum (Discourse). Highest-signal native source.",
  },
  {
    key: "app_store_enabled",
    title: "Shopify App Store reviews",
    description:
      "Negative reviews on chargeflow / disputifier / chargepay / signifyd / riskified. Highest density of dispute pain.",
  },
  {
    key: "reddit_enabled",
    title: "Reddit",
    description:
      "r/shopify (full breadth), r/chargebacks, r/Stripe, r/paypal, r/Etsy. Routes through the Cloudflare Worker proxy.",
  },
  {
    key: "hackernews_enabled",
    title: "HackerNews",
    description:
      "Algolia search across HN for chargeback/dispute/reserve queries. Lower volume, high signal density.",
  },
];

const CRON_LABELS: Array<{
  key: keyof SignalRadarSettings;
  title: string;
  description: string;
}> = [
  {
    key: "reddit_cron_enabled",
    title: "Hourly ingest cron",
    description:
      "/api/cron/signal-radar-reddit — runs every hour and pulls all enabled sources. Disable to pause all automated ingest.",
  },
  {
    key: "classify_cron_enabled",
    title: "5-minute classifier cron",
    description:
      "/api/cron/signal-radar-classify — drains the pending-classification queue. Disable to stop OpenAI calls without losing the queue.",
  },
];

export function SettingsForm({ initial }: { initial: SignalRadarSettings }) {
  const [settings, setSettings] = useState<SignalRadarSettings>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(settings) !== JSON.stringify(initial);

  function toggle(key: keyof SignalRadarSettings) {
    setSettings({ ...settings, [key]: !settings[key] });
    setSavedAt(null);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/signal-radar/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(text);
      } catch {
        setError(`Server returned non-JSON: ${text.slice(0, 120)}`);
        return;
      }
      if (!res.ok) {
        setError((json as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Section title="Sources">
        <div className="divide-y divide-[#E2E8F0]">
          {SOURCE_LABELS.map(({ key, title, description }) => (
            <ToggleRow
              key={key}
              title={title}
              description={description}
              enabled={settings[key]}
              onToggle={() => toggle(key)}
            />
          ))}
        </div>
      </Section>

      <Section title="Cron schedules">
        <div className="divide-y divide-[#E2E8F0]">
          {CRON_LABELS.map(({ key, title, description }) => (
            <ToggleRow
              key={key}
              title={title}
              description={description}
              enabled={settings[key]}
              onToggle={() => toggle(key)}
            />
          ))}
        </div>
      </Section>

      <div className="flex items-center justify-end gap-3 pt-2">
        {error && (
          <span className="inline-flex items-center gap-1 text-sm text-[#DC2626]">
            <AlertCircle className="w-4 h-4" />
            {error}
          </span>
        )}
        {savedAt && !error && (
          <span className="inline-flex items-center gap-1 text-sm text-[#065F46]">
            <Check className="w-4 h-4" />
            Saved
          </span>
        )}
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save className="w-4 h-4" />
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-white border border-[#E2E8F0] p-5">
      <h2 className="font-semibold text-[#0F172A] mb-3">{title}</h2>
      {children}
    </div>
  );
}

function ToggleRow({
  title,
  description,
  enabled,
  onToggle,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="flex-1">
        <div className="text-sm font-medium text-[#0F172A]">{title}</div>
        <div className="text-xs text-[#64748B] mt-0.5">{description}</div>
      </div>
      <button
        onClick={onToggle}
        type="button"
        role="switch"
        aria-checked={enabled}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
          enabled ? "bg-[#2563EB]" : "bg-[#CBD5E1]"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
            enabled ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
