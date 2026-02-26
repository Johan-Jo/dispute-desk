"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Save, Loader2, Globe, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

interface NarrativeSettings {
  pack_id: string;
  store_locale: string;
  include_english: boolean;
  include_store_language: boolean;
  attach_translated_customer_messages: boolean;
}

interface Narrative {
  id: string;
  pack_id: string;
  locale: string;
  content: string;
  source: string;
  updated_at: string;
}

interface Props {
  packId: string;
}

export function PackNarrativeTab({ packId }: Props) {
  const t = useTranslations("packNarrative");

  const [settings, setSettings] = useState<NarrativeSettings | null>(null);
  const [narratives, setNarratives] = useState<Narrative[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [enContent, setEnContent] = useState("");
  const [storeContent, setStoreContent] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [settingsRes, narrativesRes] = await Promise.all([
      fetch(`/api/packs/${packId}/narrative-settings`),
      fetch(`/api/packs/${packId}/narratives`),
    ]);

    if (settingsRes.ok) {
      const data = await settingsRes.json();
      setSettings(data);
    }

    if (narrativesRes.ok) {
      const data = await narrativesRes.json();
      const narrs = (data.narratives ?? []) as Narrative[];
      setNarratives(narrs);

      const en = narrs.find((n) => n.locale === "en-US" || n.locale === "en");
      if (en) setEnContent(en.content);

      const store = narrs.find(
        (n) => n.locale !== "en-US" && n.locale !== "en"
      );
      if (store) setStoreContent(store.content);
    }

    setLoading(false);
  }, [packId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggle = (
    field: keyof Omit<NarrativeSettings, "pack_id" | "store_locale">
  ) => {
    if (!settings) return;
    setSettings({ ...settings, [field]: !settings[field] });
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);

    await fetch(`/api/packs/${packId}/narrative-settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        include_english: settings.include_english,
        include_store_language: settings.include_store_language,
        attach_translated_customer_messages:
          settings.attach_translated_customer_messages,
        store_locale: settings.store_locale,
      }),
    });

    if (settings.include_english && enContent) {
      await fetch(`/api/packs/${packId}/narratives`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: "en-US", content: enContent }),
      });
    }

    if (
      settings.include_store_language &&
      settings.store_locale !== "auto" &&
      settings.store_locale !== "en-US" &&
      storeContent
    ) {
      await fetch(`/api/packs/${packId}/narratives`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale: settings.store_locale,
          content: storeContent,
        }),
      });
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-[#1D4ED8] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="text-center py-12 text-[#667085]">
        {t("noSettings")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="w-5 h-5 text-[#4F46E5]" />
          <h3 className="font-semibold text-[#0B1220]">{t("title")}</h3>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin mr-1" />
          ) : (
            <Save className="w-4 h-4 mr-1" />
          )}
          {saved ? t("saved") : t("save")}
        </Button>
      </div>

      {/* Toggle settings */}
      <div className="bg-[#F7F8FA] rounded-xl border border-[#E5E7EB] p-4 space-y-4">
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <p className="font-medium text-sm text-[#0B1220]">
              {t("includeEnglish")}
            </p>
            <p className="text-xs text-[#667085]">
              {t("includeEnglishDesc")}
            </p>
          </div>
          <input
            type="checkbox"
            checked={settings.include_english}
            onChange={() => handleToggle("include_english")}
            className="w-5 h-5 rounded border-[#E5E7EB] text-[#1D4ED8] focus:ring-[#1D4ED8]"
          />
        </label>

        <div className="border-t border-[#E5E7EB]" />

        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <p className="font-medium text-sm text-[#0B1220]">
              {t("includeStoreLanguage")}
            </p>
            <p className="text-xs text-[#667085]">
              {t("includeStoreLanguageDesc")}
            </p>
          </div>
          <input
            type="checkbox"
            checked={settings.include_store_language}
            onChange={() => handleToggle("include_store_language")}
            className="w-5 h-5 rounded border-[#E5E7EB] text-[#1D4ED8] focus:ring-[#1D4ED8]"
          />
        </label>

        <div className="border-t border-[#E5E7EB]" />

        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <p className="font-medium text-sm text-[#0B1220]">
              {t("attachTranslated")}
            </p>
            <p className="text-xs text-[#667085]">
              {t("attachTranslatedDesc")}
            </p>
          </div>
          <input
            type="checkbox"
            checked={settings.attach_translated_customer_messages}
            onChange={() =>
              handleToggle("attach_translated_customer_messages")
            }
            className="w-5 h-5 rounded border-[#E5E7EB] text-[#1D4ED8] focus:ring-[#1D4ED8]"
          />
        </label>
      </div>

      {/* English narrative */}
      {settings.include_english && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4 text-[#667085]" />
            <label className="block text-sm font-medium text-[#0B1220]">
              {t("englishNarrative")}
            </label>
          </div>
          <textarea
            value={enContent}
            onChange={(e) => setEnContent(e.target.value)}
            placeholder={t("narrativePlaceholder")}
            rows={8}
            className="w-full px-4 py-3 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent resize-y text-sm font-mono"
          />
          {narratives.find((n) => n.locale === "en-US")?.source ===
            "GENERATED" && (
            <p className="text-xs text-[#94A3B8] mt-1">{t("autoGenerated")}</p>
          )}
        </div>
      )}

      {/* Store language narrative */}
      {settings.include_store_language &&
        settings.store_locale !== "auto" &&
        settings.store_locale !== "en-US" && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Globe className="w-4 h-4 text-[#667085]" />
              <label className="block text-sm font-medium text-[#0B1220]">
                {t("storeNarrative", { locale: settings.store_locale })}
              </label>
            </div>
            <textarea
              value={storeContent}
              onChange={(e) => setStoreContent(e.target.value)}
              placeholder={t("narrativePlaceholder")}
              rows={8}
              className="w-full px-4 py-3 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent resize-y text-sm font-mono"
            />
          </div>
        )}
    </div>
  );
}
