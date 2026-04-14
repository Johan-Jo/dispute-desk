"use client";

import { useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Save,
  Eye,
  Calendar as CalendarIcon,
  Send,
  Plus,
  Loader2,
  FileText,
  Settings,
  CheckSquare,
  Globe,
  X,
} from "lucide-react";
import { BlockRenderer } from "@/components/admin/editor/BlockRenderer";
import { AIAssistantPanel } from "@/components/admin/editor/AIAssistantPanel";
import { useToast } from "@/components/admin/Toast";
import {
  WorkflowStatusBadge,
  LocaleCompletenessBadge,
  ValidationChecklist,
  SchedulePicker,
} from "@/components/admin/resources";
import type { ChecklistItem } from "@/components/admin/resources";
import type { EditorBlock, BlockType } from "@/lib/resources/body-adapter";
import {
  bodyJsonToBlocks,
  blocksToBodyJson,
  createBlock,
  BLOCK_TYPE_LABELS,
} from "@/lib/resources/body-adapter";
import {
  ADMIN_LOCALES,
  CONTENT_TYPES,
  getContentTypeLabel,
  canTransition,
  getAllowedTransitions,
} from "@/lib/resources/workflow";
import type { WorkflowStatus, ContentType, Priority } from "@/lib/resources/workflow";

/** Compare hub title/meta strings for “still English” checks (whitespace-insensitive). */
function normalizedHubText(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/* ── Types ─────────────────────────────────────────────────────────── */

interface Localization {
  locale: string;
  title: string;
  excerpt: string;
  slug: string;
  body_json: Record<string, unknown> | null;
  meta_title: string;
  meta_description: string;
  translation_status: string;
  [key: string]: unknown;
}

interface ContentItem {
  id: string;
  content_type: string;
  primary_pillar: string;
  topic: string | null;
  target_keyword: string | null;
  search_intent: string | null;
  priority: string;
  /** Editorial authoring language (hub locale). */
  source_locale?: string | null;
  workflow_status: string;
  published_at: string | null;
  updated_at: string;
  author_id: string | null;
  reviewer_id: string | null;
  [key: string]: unknown;
}

interface EditorProps {
  contentId: string;
  initial: {
    item: ContentItem;
    localizations: Localization[];
    tags: Array<{ content_tags: { id: string; key: string } | Array<{ id: string; key: string }> }>;
    revisions: Array<{ id: string; locale: string; created_at: string }>;
  };
}

/* ── Add Block Menu ───────────────────────────────────────────────── */

const ADD_BLOCK_TYPES: BlockType[] = [
  "paragraph",
  "heading",
  "html",
  "list",
  "callout",
  "code",
  "quote",
  "divider",
  "image",
  "key-takeaways",
  "faq",
  "disclaimer",
  "update-log",
];

/* ── Component ─────────────────────────────────────────────────────── */

export function ContentEditorClient({ contentId, initial }: EditorProps) {
  const [item, setItem] = useState<ContentItem>(initial.item);
  const [localizations, setLocalizations] = useState<Localization[]>(initial.localizations);
  const [activeLocale, setActiveLocale] = useState("en-US");
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showAddBlock, setShowAddBlock] = useState(false);
  const [mobileTab, setMobileTab] = useState<"content" | "metadata" | "checklist">("content");
  const [showLocalePicker, setShowLocalePicker] = useState(false);
  const { toast } = useToast();

  const activeLoc = useMemo(
    () => localizations.find((l) => l.locale === activeLocale),
    [localizations, activeLocale]
  );

  const [blocks, setBlocks] = useState<EditorBlock[]>(() =>
    bodyJsonToBlocks(activeLoc?.body_json ?? null)
  );

  const [title, setTitle] = useState(activeLoc?.title ?? "");
  const [excerpt, setExcerpt] = useState(activeLoc?.excerpt ?? "");
  const [slug, setSlug] = useState(activeLoc?.slug ?? "");
  const [metaTitle, setMetaTitle] = useState(activeLoc?.meta_title ?? "");
  const [metaDesc, setMetaDesc] = useState(activeLoc?.meta_description ?? "");

  /* ── Locale switching ────────────────────────────────────────────── */

  function switchLocale(locale: string) {
    saveLocaleState();
    const loc = localizations.find((l) => l.locale === locale);
    setActiveLocale(locale);
    setTitle(loc?.title ?? "");
    setExcerpt(loc?.excerpt ?? "");
    setSlug(loc?.slug ?? "");
    setMetaTitle(loc?.meta_title ?? "");
    setMetaDesc(loc?.meta_description ?? "");
    setBlocks(bodyJsonToBlocks(loc?.body_json ?? null));
  }

  function saveLocaleState() {
    const bodyJson = blocksToBodyJson(blocks) as Record<string, unknown>;
    setLocalizations((prev) =>
      prev.map((l) =>
        l.locale === activeLocale
          ? { ...l, title, excerpt, slug, meta_title: metaTitle, meta_description: metaDesc, body_json: bodyJson }
          : l
      )
    );
  }

  /* ── Locale completeness ─────────────────────────────────────────── */

  function localeCompleteness(loc: Localization | undefined): number {
    if (!loc) return 0;
    let filled = 0;
    const total = 4;
    if (loc.title) filled++;
    if (loc.excerpt) filled++;
    if (loc.body_json && Object.keys(loc.body_json).length > 0) filled++;
    if (loc.slug) filled++;
    return Math.round((filled / total) * 100);
  }

  /* ── Validation checklist ────────────────────────────────────────── */

  const checklist: ChecklistItem[] = useMemo(() => {
    const loc = localizations.find((l) => l.locale === "en-US");
    return [
      { id: "title", label: "English title", completed: !!loc?.title, required: true },
      { id: "excerpt", label: "English excerpt", completed: !!loc?.excerpt, required: true },
      { id: "content", label: "English content", completed: !!(loc?.body_json && Object.keys(loc.body_json).length), required: true },
      { id: "slug", label: "Slug set", completed: !!loc?.slug, required: true },
      { id: "type", label: "Content type set", completed: !!item.content_type, required: true },
      { id: "author", label: "Author assigned", completed: !!item.author_id, required: false },
      { id: "meta-title", label: "Meta title", completed: !!loc?.meta_title, required: false },
      { id: "meta-desc", label: "Meta description", completed: !!loc?.meta_description, required: false },
    ];
  }, [localizations, item]);

  /* ── Block operations ────────────────────────────────────────────── */

  const updateBlock = useCallback((index: number, updated: EditorBlock) => {
    setBlocks((prev) => prev.map((b, i) => (i === index ? updated : b)));
  }, []);

  const removeBlock = useCallback((index: number) => {
    setBlocks((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const moveBlock = useCallback((from: number, direction: -1 | 1) => {
    setBlocks((prev) => {
      const next = [...prev];
      const to = from + direction;
      if (to < 0 || to >= next.length) return prev;
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }, []);

  function addBlock(type: BlockType) {
    setBlocks((prev) => [...prev, createBlock(type)]);
    setShowAddBlock(false);
  }

  /* ── Save ────────────────────────────────────────────────────────── */

  async function handleSave() {
    setSaving(true);
    saveLocaleState();
    const bodyJson = blocksToBodyJson(blocks);

    if (activeLocale !== "en-US") {
      const enLoc = localizations.find((l) => l.locale === "en-US");
      if (enLoc) {
        const titleMatch =
          title.trim() !== "" &&
          normalizedHubText(title) === normalizedHubText(enLoc.title ?? "");
        const enMeta = (enLoc.meta_title ?? "").trim();
        const metaMatch =
          metaTitle.trim() !== "" &&
          enMeta !== "" &&
          normalizedHubText(metaTitle) === normalizedHubText(enMeta);
        if (titleMatch || metaMatch) {
          const parts: string[] = [];
          if (titleMatch) parts.push("Title matches the English (en-US) baseline.");
          if (metaMatch) parts.push("Meta title matches the English (en-US) baseline.");
          const ok = window.confirm(`${parts.join(" ")} Save anyway?`);
          if (!ok) {
            setSaving(false);
            return;
          }
        }
      }
    }

    try {
      const res = await fetch(`/api/admin/resources/content/${contentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
          item: {
            content_type: item.content_type,
            primary_pillar: item.primary_pillar,
            topic: item.topic,
            target_keyword: item.target_keyword,
            search_intent: item.search_intent,
            priority: item.priority,
            source_locale: item.source_locale ?? "en-US",
            author_id: item.author_id,
            reviewer_id: item.reviewer_id,
            featured_image_url: (item.featured_image_url as string | null | undefined) ?? null,
            featured_image_alt: (item.featured_image_alt as string | null | undefined) ?? null,
          },
          localization: {
            locale: activeLocale,
            title,
            excerpt,
            slug,
            body_json: bodyJson,
            meta_title: metaTitle,
            meta_description: metaDesc,
          },
        }),
      });

      if (res.ok) {
        setLastSaved(new Date().toLocaleTimeString());
        toast("success", "Draft saved successfully");
      } else {
        toast("error", "Failed to save draft");
      }
    } catch {
      toast("error", "Network error while saving");
    } finally {
      setSaving(false);
    }
  }

  /* ── Workflow transitions ────────────────────────────────────────── */

  async function transitionTo(newStatus: WorkflowStatus) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/resources/content/${contentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowTransition: {
            from: item.workflow_status,
            to: newStatus,
          },
        }),
      });
      if (res.ok) {
        setItem((prev) => ({ ...prev, workflow_status: newStatus }));
        toast("success", `Status changed to ${newStatus.replace(/_/g, " ")}`);
      } else {
        let msg = "Failed to change status";
        try {
          const j = (await res.json()) as { error?: string };
          if (typeof j?.error === "string" && j.error.trim()) msg = j.error.trim();
        } catch {
          /* ignore */
        }
        toast("error", msg);
      }
    } catch {
      toast("error", "Network error during status change");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    await handleSave();
    if (canTransition(item.workflow_status as WorkflowStatus, "published")) {
      await transitionTo("published");
    }
  }

  async function handleSchedule(_date: string, _time: string) {
    await handleSave();
    if (canTransition(item.workflow_status as WorkflowStatus, "scheduled")) {
      await transitionTo("scheduled");
    }
    setShowSchedule(false);
  }

  const allowedTransitions = getAllowedTransitions(item.workflow_status as WorkflowStatus);

  /* ── Slug auto-generation ────────────────────────────────────────── */

  function handleTitleChange(val: string) {
    setTitle(val);
    if (!slug || slug === titleToSlug(title)) {
      setSlug(titleToSlug(val));
    }
  }

  function titleToSlug(t: string) {
    return t
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 80);
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top navigation */}
      <header className="bg-white border-b border-[#E2E8F0] px-4 sm:px-6 py-3 sticky top-0 z-30">
        <div className="flex items-center justify-between max-w-[1400px] mx-auto">
          <div className="flex items-center gap-4">
            <Link
              href="/admin/resources/list"
              className="p-2 hover:bg-[#F1F5F9] rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-[#64748B]" />
            </Link>
            <div>
              <h1 className="text-base font-semibold text-[#0F172A]">Edit Content</h1>
              <p className="text-xs text-[#64748B]">
                {getContentTypeLabel(item.content_type as ContentType)} · {item.primary_pillar}
                {lastSaved && <span className="ml-2">Last saved {lastSaved}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[#64748B] hover:bg-[#F1F5F9] rounded-lg transition-colors"
              title="Preview (not yet implemented)"
            >
              <Eye className="w-4 h-4" />
              <span className="hidden sm:inline">Preview</span>
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border border-[#E2E8F0] rounded-lg hover:bg-[#F8FAFC] transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Draft
            </button>
            {canTransition(item.workflow_status as WorkflowStatus, "scheduled") && (
              <button
                onClick={() => setShowSchedule(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border border-[#E2E8F0] rounded-lg hover:bg-[#F8FAFC] transition-colors"
              >
                <CalendarIcon className="w-4 h-4" />
                <span className="hidden sm:inline">Schedule</span>
              </button>
            )}
            {canTransition(item.workflow_status as WorkflowStatus, "published") && (
              <button
                onClick={handlePublish}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-[#1D4ED8] text-white rounded-lg hover:bg-[#1E40AF] transition-colors disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                Publish
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile tab bar */}
      <div className="lg:hidden flex items-center border-b border-[#E2E8F0] bg-white sticky top-[57px] z-20">
        <button
          onClick={() => setShowLocalePicker(true)}
          className="flex items-center gap-1.5 px-4 py-3 border-r border-[#E2E8F0] text-sm"
        >
          <Globe className="w-4 h-4 text-[#64748B]" />
          <span className="font-medium text-[#0F172A]">
            {ADMIN_LOCALES.find((l) => l.dbLocale === activeLocale)?.flag ?? "🌐"}
          </span>
          <span className="text-xs text-[#64748B]">
            {Math.round(localeCompleteness(localizations.find((l) => l.locale === activeLocale)))}%
          </span>
        </button>
        {([
          { key: "content" as const, label: "Content", icon: FileText },
          { key: "metadata" as const, label: "Metadata", icon: Settings },
          { key: "checklist" as const, label: "Checklist", icon: CheckSquare, dot: checklist.some((c) => c.required && !c.completed) },
        ]).map((tab) => {
          const TabIcon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setMobileTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-3 text-sm font-medium transition-colors relative ${
                mobileTab === tab.key ? "text-[#1D4ED8] border-b-2 border-[#1D4ED8]" : "text-[#64748B]"
              }`}
            >
              <TabIcon className="w-4 h-4" />
              <span className="hidden sm:inline">{tab.label}</span>
              {tab.dot && (
                <span className="w-2 h-2 rounded-full bg-[#EF4444] absolute top-2 right-1/4" />
              )}
            </button>
          );
        })}
      </div>

      {/* Main content */}
      <div className="flex-1 p-4 sm:p-6 max-w-[1400px] mx-auto w-full pb-20 lg:pb-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column — editor (2/3) */}
          <div className={`lg:col-span-2 space-y-6 ${mobileTab !== "content" ? "hidden lg:block" : ""}`}>
            {/* Locale tabs (desktop) */}
            <div className="hidden lg:flex gap-3 overflow-x-auto pb-1">
              {ADMIN_LOCALES.map((loc) => {
                const locData = localizations.find((l) => l.locale === loc.dbLocale);
                const pct = localeCompleteness(locData);
                return (
                  <LocaleCompletenessBadge
                    key={loc.dbLocale}
                    locale={loc.dbLocale}
                    percent={pct}
                    isActive={activeLocale === loc.dbLocale}
                    onClick={() => switchLocale(loc.dbLocale)}
                  />
                );
              })}
            </div>

            {/* Title */}
            <div>
              <label className="block text-xs font-medium text-[#64748B] mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="Article title..."
                className="w-full px-4 py-3 text-lg font-semibold border border-[#E2E8F0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]"
              />
            </div>

            {/* Slug */}
            <div>
              <label className="block text-xs font-medium text-[#64748B] mb-1">Slug</label>
              <div className="flex items-center border border-[#E2E8F0] rounded-xl overflow-hidden">
                <span className="px-3 py-2.5 text-sm text-[#64748B] bg-[#F8FAFC] border-r border-[#E2E8F0] whitespace-nowrap">
                  disputedesk.app/resources/
                </span>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="article-slug"
                  className="flex-1 px-3 py-2.5 text-sm focus:outline-none"
                />
              </div>
            </div>

            {/* Excerpt */}
            <div>
              <label className="block text-xs font-medium text-[#64748B] mb-1">
                Excerpt
                <span className="ml-2 text-[#94A3B8]">{excerpt.length}/300</span>
              </label>
              <textarea
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value.slice(0, 300))}
                placeholder="Brief summary for listings and SEO..."
                rows={3}
                className="w-full px-4 py-3 text-sm border border-[#E2E8F0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8] resize-y"
              />
            </div>

            {/* Content blocks */}
            <div>
              <label className="block text-xs font-medium text-[#64748B] mb-3">Content Blocks</label>
              <div className="space-y-4">
                {blocks.map((block, index) => (
                  <BlockRenderer
                    key={block.id}
                    block={block}
                    index={index}
                    total={blocks.length}
                    onChange={(b) => updateBlock(index, b)}
                    onRemove={() => removeBlock(index)}
                    onMoveUp={() => moveBlock(index, -1)}
                    onMoveDown={() => moveBlock(index, 1)}
                  />
                ))}
              </div>

              {/* Add block */}
              <div className="mt-4 relative">
                <button
                  onClick={() => setShowAddBlock(!showAddBlock)}
                  className="w-full py-3 border-2 border-dashed border-[#E1E3E5] rounded-xl text-sm font-medium text-[#64748B] hover:text-[#1D4ED8] hover:border-[#1D4ED8]/40 transition-colors flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add Content Block
                </button>
                {showAddBlock && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-[#E2E8F0] rounded-xl shadow-lg z-20 p-2 grid grid-cols-2 sm:grid-cols-3 gap-1 max-h-[300px] overflow-y-auto">
                    {ADD_BLOCK_TYPES.map((type) => (
                      <button
                        key={type}
                        onClick={() => addBlock(type)}
                        className="text-left px-3 py-2 text-sm rounded-lg hover:bg-[#F1F5F9] transition-colors"
                      >
                        {BLOCK_TYPE_LABELS[type]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right column — sidebar (1/3) */}
          <div className={`space-y-6 ${mobileTab === "content" ? "hidden lg:block" : ""}`}>
            {/* Validation Checklist */}
            <div className={mobileTab === "metadata" ? "hidden lg:block" : ""}>
              <ValidationChecklist items={checklist} />
            </div>

            {/* Workflow Status */}
            <div className="bg-white border border-[#E2E8F0] rounded-xl p-5">
              <h3 className="text-sm font-semibold text-[#0F172A] mb-3">Status</h3>
              <div className="space-y-3">
                <WorkflowStatusBadge status={item.workflow_status as WorkflowStatus} />
                {item.published_at && (
                  <p className="text-xs text-[#64748B]">
                    Published:{" "}
                    {new Date(item.published_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                )}
                <p className="text-xs text-[#64748B]">
                  Updated: {new Date(item.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </p>
                {allowedTransitions.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-[#64748B] mb-2">Move to:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {allowedTransitions
                        .filter((s) => s !== "archived")
                        .map((status) => (
                          <button
                            key={status}
                            onClick={() => transitionTo(status)}
                            disabled={saving}
                            className="text-xs px-2.5 py-1 rounded-lg border border-[#E2E8F0] hover:bg-[#F1F5F9] transition-colors disabled:opacity-50"
                          >
                            {status.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Metadata */}
            <div className={`bg-white border border-[#E2E8F0] rounded-xl p-5 ${mobileTab === "checklist" ? "hidden lg:block" : ""}`}>
              <h3 className="text-sm font-semibold text-[#0F172A] mb-3">Metadata</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-[#64748B] mb-1">Content Type</label>
                  <select
                    value={item.content_type}
                    onChange={(e) => setItem((prev) => ({ ...prev, content_type: e.target.value }))}
                    className="w-full text-sm border border-[#E2E8F0] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                  >
                    {CONTENT_TYPES.map((ct) => (
                      <option key={ct} value={ct}>
                        {getContentTypeLabel(ct)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#64748B] mb-1">Article language</label>
                  <select
                    value={item.source_locale ?? "en-US"}
                    onChange={(e) =>
                      setItem((prev) => ({ ...prev, source_locale: e.target.value }))
                    }
                    className="w-full text-sm border border-[#E2E8F0] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                  >
                    {ADMIN_LOCALES.map((loc) => (
                      <option key={loc.dbLocale} value={loc.dbLocale}>
                        {loc.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#64748B] mb-1">Topic</label>
                  <input
                    type="text"
                    value={item.topic ?? ""}
                    onChange={(e) => setItem((prev) => ({ ...prev, topic: e.target.value || null }))}
                    placeholder="e.g. Chargebacks"
                    className="w-full text-sm border border-[#E2E8F0] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#64748B] mb-1">Target Keyword</label>
                  <input
                    type="text"
                    value={item.target_keyword ?? ""}
                    onChange={(e) => setItem((prev) => ({ ...prev, target_keyword: e.target.value || null }))}
                    placeholder="e.g. chargeback prevention"
                    className="w-full text-sm border border-[#E2E8F0] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#64748B] mb-1">Priority</label>
                  <select
                    value={item.priority}
                    onChange={(e) => setItem((prev) => ({ ...prev, priority: e.target.value }))}
                    className="w-full text-sm border border-[#E2E8F0] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                  >
                    {(["high", "medium", "low"] as Priority[]).map((p) => (
                      <option key={p} value={p}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#64748B] mb-1">Featured image URL</label>
                  <input
                    type="url"
                    value={(item.featured_image_url as string | null | undefined) ?? ""}
                    onChange={(e) =>
                      setItem((prev) => ({
                        ...prev,
                        featured_image_url: e.target.value.trim() || null,
                      }))
                    }
                    placeholder="https://… or /images/resources/…"
                    className="w-full text-sm border border-[#E2E8F0] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                  />
                  <p className="text-xs text-[#94A3B8] mt-1">Public hub card and article hero. Use absolute URL or site path.</p>
                </div>
                <div>
                  <label className="block text-xs text-[#64748B] mb-1">Featured image alt</label>
                  <input
                    type="text"
                    value={(item.featured_image_alt as string | null | undefined) ?? ""}
                    onChange={(e) =>
                      setItem((prev) => ({
                        ...prev,
                        featured_image_alt: e.target.value.trim() || null,
                      }))
                    }
                    placeholder="Short description for screen readers"
                    className="w-full text-sm border border-[#E2E8F0] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                  />
                </div>
              </div>
            </div>

            {/* SEO */}
            <div className="bg-white border border-[#E2E8F0] rounded-xl p-5">
              <h3 className="text-sm font-semibold text-[#0F172A] mb-3">SEO</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-[#64748B] mb-1">
                    Meta Title <span className="text-[#94A3B8]">{metaTitle.length}/60</span>
                  </label>
                  <input
                    type="text"
                    value={metaTitle}
                    onChange={(e) => setMetaTitle(e.target.value.slice(0, 60))}
                    placeholder="SEO title..."
                    className="w-full text-sm border border-[#E2E8F0] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#64748B] mb-1">
                    Meta Description <span className="text-[#94A3B8]">{metaDesc.length}/160</span>
                  </label>
                  <textarea
                    value={metaDesc}
                    onChange={(e) => setMetaDesc(e.target.value.slice(0, 160))}
                    placeholder="SEO description..."
                    rows={3}
                    className="w-full text-sm border border-[#E2E8F0] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 resize-y"
                  />
                </div>
              </div>
            </div>

            {/* AI Assistant */}
            <AIAssistantPanel
              contentHtml={blocks.map((b) => (b.data.html as string) ?? (b.data.text as string) ?? "").join(" ")}
              onApplyReadability={(html) => {
                setBlocks((prev) => {
                  const htmlBlock = prev.find((b) => b.type === "html");
                  if (htmlBlock) {
                    return prev.map((b) => b.id === htmlBlock.id ? { ...b, data: { html } } : b);
                  }
                  return prev;
                });
                toast("success", "Readability improvements applied");
              }}
              onApplyMeta={(meta) => {
                setMetaDesc(meta.slice(0, 160));
                toast("success", "Meta description updated");
              }}
            />
          </div>
        </div>
      </div>

      {/* Mobile bottom action bar */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-[#E2E8F0] px-4 py-3 flex items-center gap-3 z-30">
        {canTransition(item.workflow_status as WorkflowStatus, "scheduled") && (
          <button
            onClick={() => setShowSchedule(true)}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium border border-[#E2E8F0] rounded-lg hover:bg-[#F8FAFC]"
          >
            <CalendarIcon className="w-4 h-4" />
            Schedule
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium border border-[#E2E8F0] rounded-lg hover:bg-[#F8FAFC] disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save
        </button>
        {canTransition(item.workflow_status as WorkflowStatus, "published") && (
          <button
            onClick={handlePublish}
            disabled={saving || checklist.some((c) => c.required && !c.completed)}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium bg-[#1D4ED8] text-white rounded-lg hover:bg-[#1E40AF] disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            Publish
          </button>
        )}
      </div>

      {/* Locale picker modal (mobile) */}
      {showLocalePicker && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowLocalePicker(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
              <h3 className="text-base font-semibold text-[#0F172A]">Select Language</h3>
              <button onClick={() => setShowLocalePicker(false)} className="p-1 hover:bg-[#F1F5F9] rounded-lg">
                <X className="w-5 h-5 text-[#64748B]" />
              </button>
            </div>
            <div className="divide-y divide-[#E2E8F0]">
              {ADMIN_LOCALES.map((loc) => {
                const locData = localizations.find((l) => l.locale === loc.dbLocale);
                const pct = localeCompleteness(locData);
                const isActive = activeLocale === loc.dbLocale;
                return (
                  <button
                    key={loc.dbLocale}
                    onClick={() => {
                      switchLocale(loc.dbLocale);
                      setShowLocalePicker(false);
                    }}
                    className={`w-full flex items-center gap-4 px-5 py-4 text-left transition-colors ${
                      isActive ? "bg-[#EFF6FF]" : "hover:bg-[#F8FAFC]"
                    }`}
                  >
                    <span className="text-2xl">{loc.flag}</span>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-[#0F172A]">{loc.nativeName}</p>
                      <p className="text-xs text-[#64748B]">{loc.dbLocale}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-medium ${pct === 100 ? "text-[#22C55E]" : "text-[#64748B]"}`}>
                        {pct}%
                      </p>
                      <div className="w-16 h-1.5 bg-[#E2E8F0] rounded-full mt-1">
                        <div
                          className={`h-full rounded-full ${pct === 100 ? "bg-[#22C55E]" : pct > 50 ? "bg-[#3B82F6]" : "bg-[#F59E0B]"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    {isActive && (
                      <div className="w-2.5 h-2.5 rounded-full bg-[#1D4ED8]" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Schedule modal */}
      {showSchedule && (
        <SchedulePicker
          onSchedule={handleSchedule}
          onClose={() => setShowSchedule(false)}
        />
      )}
    </div>
  );
}
