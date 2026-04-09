"use client";

import { useState } from "react";
import {
  GripVertical,
  Trash2,
  ChevronUp,
  ChevronDown,
  FileText,
  Heading,
  AlignLeft,
  List,
  AlertCircle,
  Code,
  Quote,
  Minus,
  ImageIcon,
  CheckCircle,
  HelpCircle,
  AlertTriangle,
  Clock,
} from "lucide-react";
import type { EditorBlock, BlockType } from "@/lib/resources/body-adapter";
import { BLOCK_TYPE_LABELS } from "@/lib/resources/body-adapter";

const BLOCK_ICONS: Record<BlockType, React.ElementType> = {
  html: FileText,
  paragraph: AlignLeft,
  heading: Heading,
  list: List,
  callout: AlertCircle,
  code: Code,
  quote: Quote,
  divider: Minus,
  image: ImageIcon,
  "key-takeaways": CheckCircle,
  faq: HelpCircle,
  disclaimer: AlertTriangle,
  "update-log": Clock,
};

interface BlockRendererProps {
  block: EditorBlock;
  index: number;
  total: number;
  onChange: (block: EditorBlock) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function BlockRenderer({
  block,
  index,
  total,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: BlockRendererProps) {
  const Icon = BLOCK_ICONS[block.type] ?? FileText;

  function updateData(patch: Record<string, unknown>) {
    onChange({ ...block, data: { ...block.data, ...patch } });
  }

  return (
    <div className="group border border-dashed border-[#E1E3E5] rounded-xl bg-white hover:border-[#1D4ED8]/30 transition-colors">
      {/* Block header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[#E2E8F0] bg-[#F8FAFC] rounded-t-xl">
        <GripVertical className="w-4 h-4 text-[#C4C8CD] cursor-grab" />
        <Icon className="w-4 h-4 text-[#64748B]" />
        <span className="text-xs font-medium text-[#64748B] uppercase tracking-wider">
          {BLOCK_TYPE_LABELS[block.type]}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={onMoveUp}
            disabled={index === 0}
            className="p-1 rounded hover:bg-[#E2E8F0] disabled:opacity-30 transition-colors"
            title="Move up"
          >
            <ChevronUp className="w-3.5 h-3.5 text-[#64748B]" />
          </button>
          <button
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="p-1 rounded hover:bg-[#E2E8F0] disabled:opacity-30 transition-colors"
            title="Move down"
          >
            <ChevronDown className="w-3.5 h-3.5 text-[#64748B]" />
          </button>
          <button
            onClick={onRemove}
            className="p-1 rounded hover:bg-[#FEE2E2] text-[#64748B] hover:text-[#EF4444] transition-colors"
            title="Remove block"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Block content */}
      <div className="p-4">
        <BlockContent block={block} updateData={updateData} />
      </div>
    </div>
  );
}

/* ── Rich HTML: code + readable preview (admin trust boundary for innerHTML) ─ */

function HtmlBlockEditor({
  html,
  updateData,
}: {
  html: string;
  updateData: (patch: Record<string, unknown>) => void;
}) {
  const [mode, setMode] = useState<"split" | "code" | "preview">("split");

  const preview =
    html.trim().length > 0 ? (
      <div
        className="prose prose-slate prose-sm max-w-none border border-[#E2E8F0] rounded-lg p-4 bg-white text-[#0F172A] max-h-[min(60vh,560px)] overflow-y-auto prose-headings:text-[#0F172A] prose-p:text-[#0F172A] prose-p:leading-relaxed prose-li:text-[#0F172A] prose-a:text-[#1D4ED8] prose-strong:text-[#0F172A]"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    ) : (
      <div className="border border-dashed border-[#E2E8F0] rounded-lg p-8 text-center text-sm text-[#94A3B8] max-h-[min(60vh,560px)]">
        Nothing to preview yet — add HTML in the editor.
      </div>
    );

  const editor = (
    <textarea
      value={html}
      onChange={(e) => updateData({ html: e.target.value })}
      placeholder="HTML content..."
      className="w-full min-h-[200px] lg:min-h-[280px] p-3 text-sm font-mono bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8] resize-y"
    />
  );

  const modeBtn = (m: typeof mode, label: string) => (
    <button
      key={m}
      type="button"
      onClick={() => setMode(m)}
      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
        mode === m
          ? "bg-[#0F172A] text-white"
          : "bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-[#64748B] mr-1">View:</span>
        {modeBtn("split", "Split")}
        {modeBtn("code", "HTML only")}
        {modeBtn("preview", "Preview only")}
      </div>
      {mode === "split" && (
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 min-w-0 space-y-1">
            <span className="text-xs text-[#64748B]">Source</span>
            {editor}
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <span className="text-xs text-[#64748B]">Preview (read-only)</span>
            {preview}
          </div>
        </div>
      )}
      {mode === "code" && editor}
      {mode === "preview" && preview}
    </div>
  );
}

/* ── Per-type content editors ─────────────────────────────────────── */

function BlockContent({
  block,
  updateData,
}: {
  block: EditorBlock;
  updateData: (patch: Record<string, unknown>) => void;
}) {
  switch (block.type) {
    case "html":
      return (
        <HtmlBlockEditor html={(block.data.html as string) ?? ""} updateData={updateData} />
      );

    case "paragraph":
      return (
        <textarea
          value={(block.data.text as string) ?? ""}
          onChange={(e) => updateData({ text: e.target.value })}
          placeholder="Write paragraph text..."
          className="w-full min-h-[80px] p-3 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8] resize-y"
        />
      );

    case "heading":
      return (
        <div className="space-y-2">
          <select
            value={(block.data.level as number) ?? 2}
            onChange={(e) => updateData({ level: parseInt(e.target.value) })}
            className="text-sm border border-[#E2E8F0] rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
          >
            <option value={2}>H2</option>
            <option value={3}>H3</option>
            <option value={4}>H4</option>
          </select>
          <input
            type="text"
            value={(block.data.text as string) ?? ""}
            onChange={(e) => updateData({ text: e.target.value })}
            placeholder="Heading text..."
            className="w-full px-3 py-2 text-lg font-semibold border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]"
          />
        </div>
      );

    case "list": {
      const items = (block.data.items as string[]) ?? [""];
      return (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!block.data.ordered}
              onChange={(e) => updateData({ ordered: e.target.checked })}
              className="rounded border-[#D1D5DB]"
            />
            Numbered list
          </label>
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-[#64748B] w-6 text-right">
                {block.data.ordered ? `${i + 1}.` : "•"}
              </span>
              <input
                type="text"
                value={item}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = e.target.value;
                  updateData({ items: next });
                }}
                placeholder="List item..."
                className="flex-1 px-3 py-1.5 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
              />
              <button
                onClick={() => updateData({ items: items.filter((_, j) => j !== i) })}
                className="p-1 text-[#64748B] hover:text-[#EF4444]"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button
            onClick={() => updateData({ items: [...items, ""] })}
            className="text-sm text-[#1D4ED8] hover:text-[#1E40AF] font-medium"
          >
            + Add item
          </button>
        </div>
      );
    }

    case "callout":
      return (
        <div className="space-y-2">
          <input
            type="text"
            value={(block.data.label as string) ?? "Note"}
            onChange={(e) => updateData({ label: e.target.value })}
            placeholder="Label (e.g. Note, Tip, Warning)..."
            className="w-full px-3 py-1.5 text-sm font-medium border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
          />
          <textarea
            value={(block.data.text as string) ?? ""}
            onChange={(e) => updateData({ text: e.target.value })}
            placeholder="Callout content..."
            className="w-full min-h-[60px] p-3 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 resize-y"
          />
        </div>
      );

    case "code":
      return (
        <div className="space-y-2">
          <input
            type="text"
            value={(block.data.language as string) ?? ""}
            onChange={(e) => updateData({ language: e.target.value })}
            placeholder="Language (js, python, bash...)"
            className="w-40 px-3 py-1.5 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
          />
          <textarea
            value={(block.data.code as string) ?? ""}
            onChange={(e) => updateData({ code: e.target.value })}
            placeholder="Code snippet..."
            className="w-full min-h-[100px] p-3 text-sm font-mono bg-[#0F172A] text-[#E2E8F0] border border-[#334155] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 resize-y"
          />
        </div>
      );

    case "quote":
      return (
        <div className="space-y-2">
          <textarea
            value={(block.data.text as string) ?? ""}
            onChange={(e) => updateData({ text: e.target.value })}
            placeholder="Quote text..."
            className="w-full min-h-[60px] p-3 text-sm italic border-l-4 border-[#1D4ED8] bg-[#F8FAFC] rounded-r-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 resize-y"
          />
          <input
            type="text"
            value={(block.data.citation as string) ?? ""}
            onChange={(e) => updateData({ citation: e.target.value })}
            placeholder="Citation / source (optional)"
            className="w-full px-3 py-1.5 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
          />
        </div>
      );

    case "divider":
      return (
        <div className="flex items-center justify-center py-2">
          <hr className="w-full border-t-2 border-dashed border-[#E1E3E5]" />
        </div>
      );

    case "image":
      return (
        <div className="space-y-2">
          <input
            type="text"
            value={(block.data.url as string) ?? ""}
            onChange={(e) => updateData({ url: e.target.value })}
            placeholder="Image URL..."
            className="w-full px-3 py-1.5 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
          />
          <input
            type="text"
            value={(block.data.alt as string) ?? ""}
            onChange={(e) => updateData({ alt: e.target.value })}
            placeholder="Alt text..."
            className="w-full px-3 py-1.5 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
          />
          <input
            type="text"
            value={(block.data.caption as string) ?? ""}
            onChange={(e) => updateData({ caption: e.target.value })}
            placeholder="Caption (optional)"
            className="w-full px-3 py-1.5 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
          />
          {typeof block.data.url === "string" && block.data.url && (
            <div className="border border-[#E2E8F0] rounded-lg overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={block.data.url}
                alt={(block.data.alt as string) ?? ""}
                className="max-h-48 w-auto mx-auto"
              />
            </div>
          )}
        </div>
      );

    case "key-takeaways": {
      const items = (block.data.items as string[]) ?? [""];
      return (
        <div className="space-y-2">
          <p className="text-xs text-[#64748B]">Key points readers should remember</p>
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-[#22C55E] shrink-0" />
              <input
                type="text"
                value={item}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = e.target.value;
                  updateData({ items: next });
                }}
                placeholder="Takeaway..."
                className="flex-1 px-3 py-1.5 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
              />
              <button
                onClick={() => updateData({ items: items.filter((_, j) => j !== i) })}
                className="p-1 text-[#64748B] hover:text-[#EF4444]"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button
            onClick={() => updateData({ items: [...items, ""] })}
            className="text-sm text-[#1D4ED8] hover:text-[#1E40AF] font-medium"
          >
            + Add takeaway
          </button>
        </div>
      );
    }

    case "faq": {
      const items = (block.data.items as Array<{ q: string; a: string }>) ?? [{ q: "", a: "" }];
      return (
        <div className="space-y-4">
          <p className="text-xs text-[#64748B]">Frequently asked questions</p>
          {items.map((faq, i) => (
            <div key={i} className="border border-[#E2E8F0] rounded-lg p-3 space-y-2">
              <div className="flex items-start gap-2">
                <span className="text-xs font-bold text-[#64748B] mt-2">Q:</span>
                <input
                  type="text"
                  value={faq.q}
                  onChange={(e) => {
                    const next = [...items];
                    next[i] = { ...faq, q: e.target.value };
                    updateData({ items: next });
                  }}
                  placeholder="Question..."
                  className="flex-1 px-3 py-1.5 text-sm font-medium border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                />
                <button
                  onClick={() => updateData({ items: items.filter((_, j) => j !== i) })}
                  className="p-1 text-[#64748B] hover:text-[#EF4444]"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-xs font-bold text-[#64748B] mt-2">A:</span>
                <textarea
                  value={faq.a}
                  onChange={(e) => {
                    const next = [...items];
                    next[i] = { ...faq, a: e.target.value };
                    updateData({ items: next });
                  }}
                  placeholder="Answer..."
                  className="flex-1 px-3 py-1.5 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 resize-y min-h-[40px]"
                />
              </div>
            </div>
          ))}
          <button
            onClick={() => updateData({ items: [...items, { q: "", a: "" }] })}
            className="text-sm text-[#1D4ED8] hover:text-[#1E40AF] font-medium"
          >
            + Add FAQ item
          </button>
        </div>
      );
    }

    case "disclaimer":
      return (
        <textarea
          value={(block.data.text as string) ?? ""}
          onChange={(e) => updateData({ text: e.target.value })}
          placeholder="Disclaimer text..."
          className="w-full min-h-[60px] p-3 text-sm border-l-4 border-[#EF4444] bg-[#FEF2F2] rounded-r-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 resize-y"
        />
      );

    case "update-log": {
      const entries = (block.data.entries as Array<{ at: string; note: string }>) ?? [];
      return (
        <div className="space-y-2">
          <p className="text-xs text-[#64748B]">Article revision history</p>
          {entries.map((entry, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="date"
                value={entry.at}
                onChange={(e) => {
                  const next = [...entries];
                  next[i] = { ...entry, at: e.target.value };
                  updateData({ entries: next });
                }}
                className="w-36 px-2 py-1.5 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
              />
              <input
                type="text"
                value={entry.note}
                onChange={(e) => {
                  const next = [...entries];
                  next[i] = { ...entry, note: e.target.value };
                  updateData({ entries: next });
                }}
                placeholder="Change note..."
                className="flex-1 px-3 py-1.5 text-sm border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
              />
              <button
                onClick={() => updateData({ entries: entries.filter((_, j) => j !== i) })}
                className="p-1 text-[#64748B] hover:text-[#EF4444]"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              updateData({
                entries: [...entries, { at: new Date().toISOString().split("T")[0], note: "" }],
              })
            }
            className="text-sm text-[#1D4ED8] hover:text-[#1E40AF] font-medium"
          >
            + Add entry
          </button>
        </div>
      );
    }

    default:
      return <p className="text-sm text-[#64748B]">Unknown block type: {block.type}</p>;
  }
}
