"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles, Loader2, Wand2, FileSearch, Link2, HelpCircle } from "lucide-react";

interface AIAssistantPanelProps {
  contentHtml: string;
  onApplyReadability: (html: string) => void;
  onApplyMeta: (meta: string) => void;
}

type AssistAction = "improve_readability" | "generate_meta" | "suggest_related";

const ACTIONS: Array<{
  key: AssistAction;
  label: string;
  description: string;
  icon: React.ElementType;
}> = [
  {
    key: "improve_readability",
    label: "Improve Readability",
    description: "Simplify sentences and improve flow",
    icon: Wand2,
  },
  {
    key: "generate_meta",
    label: "Generate Meta Description",
    description: "Create SEO-optimized description",
    icon: FileSearch,
  },
  {
    key: "suggest_related",
    label: "Suggest Related Topics",
    description: "Recommend complementary articles",
    icon: Link2,
  },
];

export function AIAssistantPanel({
  contentHtml,
  onApplyReadability,
  onApplyMeta,
}: AIAssistantPanelProps) {
  const [loading, setLoading] = useState<AssistAction | null>(null);
  const [result, setResult] = useState<{ action: AssistAction; data: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runAction(action: AssistAction) {
    if (!contentHtml.trim()) {
      setError("Add some content first");
      return;
    }

    setLoading(action);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/admin/resources/ai-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, content: contentHtml }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "AI request failed");
        return;
      }

      setResult({ action, data: data.result });
    } catch {
      setError("Network error");
    } finally {
      setLoading(null);
    }
  }

  function applyResult() {
    if (!result) return;
    if (result.action === "improve_readability") {
      onApplyReadability(result.data);
    } else if (result.action === "generate_meta") {
      onApplyMeta(result.data);
    }
    setResult(null);
  }

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#8B5CF6]" />
          <h3 className="text-sm font-semibold text-[#0B1220]">AI Assistant</h3>
        </div>
        <Link
          href="/admin/help#help-editor"
          className="inline-flex items-center gap-1 text-xs font-medium text-[#1D4ED8] hover:underline shrink-0"
        >
          <HelpCircle className="w-3.5 h-3.5" aria-hidden />
          Editor guide
        </Link>
      </div>

      <div className="space-y-2">
        {ACTIONS.map((action) => {
          const Icon = action.icon;
          const isLoading = loading === action.key;
          return (
            <button
              key={action.key}
              onClick={() => runAction(action.key)}
              disabled={!!loading}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-lg border border-[#E5E7EB] hover:bg-[#F8FAFC] transition-colors disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 text-[#8B5CF6] animate-spin shrink-0" />
              ) : (
                <Icon className="w-4 h-4 text-[#8B5CF6] shrink-0" />
              )}
              <div>
                <p className="text-sm font-medium text-[#0B1220]">{action.label}</p>
                <p className="text-xs text-[#64748B]">{action.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="mt-3 px-3 py-2 bg-[#FEF2F2] border border-[#FECACA] rounded-lg">
          <p className="text-xs text-[#DC2626]">{error}</p>
        </div>
      )}

      {result && (
        <div className="mt-3 border border-[#E5E7EB] rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-[#F8FAFC] border-b border-[#E5E7EB]">
            <p className="text-xs font-medium text-[#64748B]">
              {result.action === "suggest_related" ? "Suggested Topics" : "AI Result"}
            </p>
          </div>
          <div className="px-3 py-2 max-h-40 overflow-y-auto">
            {result.action === "suggest_related" ? (
              <ul className="text-sm text-[#0B1220] space-y-1">
                {(() => {
                  try {
                    const topics = JSON.parse(result.data) as string[];
                    return topics.map((t, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#8B5CF6]" />
                        {t}
                      </li>
                    ));
                  } catch {
                    return <li>{result.data}</li>;
                  }
                })()}
              </ul>
            ) : (
              <p className="text-sm text-[#0B1220] whitespace-pre-wrap">
                {result.data.slice(0, 500)}
                {result.data.length > 500 && "..."}
              </p>
            )}
          </div>
          {(result.action === "improve_readability" || result.action === "generate_meta") && (
            <div className="px-3 py-2 border-t border-[#E5E7EB] flex gap-2">
              <button
                onClick={applyResult}
                className="text-xs font-medium text-[#1D4ED8] hover:text-[#1E40AF]"
              >
                Apply
              </button>
              <button
                onClick={() => setResult(null)}
                className="text-xs text-[#64748B] hover:text-[#0B1220]"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
