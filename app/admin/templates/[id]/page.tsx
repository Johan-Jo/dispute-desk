"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { FileText, ArrowLeft, GitBranch } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatsRow } from "@/components/admin/AdminStatsRow";
import { StatusPill } from "@/components/admin/StatusPill";

interface TemplateDetail {
  id: string;
  slug: string;
  name: string;
  short_description: string;
  dispute_type: string;
  is_recommended: boolean;
  min_plan: string;
  status: string;
  created_at: string;
  updated_at: string;
  works_best_for: string | null;
  preview_note: string | null;
  sections: {
    id: string;
    title_default: string;
    sort: number;
    items: {
      id: string;
      item_type: string;
      label_default: string;
      required: boolean;
      guidance_default: string | null;
      sort: number;
    }[];
  }[];
  mappings: { reason_code: string; dispute_phase: string }[];
}

export default function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [tpl, setTpl] = useState<TemplateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/templates/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setTpl(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  const handleStatusChange = async (status: string) => {
    setSaving(true);
    await fetch(`/api/admin/templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    // Refetch
    const res = await fetch(`/api/admin/templates/${id}`);
    setTpl(await res.json());
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="text-[#64748B] py-12 text-center">Loading template...</div>
      </div>
    );
  }

  if (!tpl) {
    return (
      <div className="p-8">
        <div className="text-[#EF4444] py-12 text-center">Template not found</div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl">
      <Link
        href="/admin/templates"
        className="inline-flex items-center gap-2 text-sm text-[#64748B] hover:text-[#0F172A] mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Templates
      </Link>

      <AdminPageHeader
        title={tpl.name}
        subtitle={tpl.short_description}
        icon={FileText}
        actions={
          <div className="flex items-center gap-3">
            <StatusPill status={tpl.status} />
            {tpl.is_recommended && (
              <span className="px-3 py-1 bg-[#DBEAFE] text-[#1E40AF] text-xs font-semibold rounded-full">
                Recommended
              </span>
            )}
          </div>
        }
      />

      {/* Metadata */}
      <AdminStatsRow
        cards={[
          { label: "Dispute Type", value: tpl.dispute_type },
          { label: "Min Plan", value: tpl.min_plan },
          { label: "Sections", value: tpl.sections.length },
          { label: "Mappings", value: tpl.mappings.length },
        ]}
      />

      {/* Status Control */}
      <div className="bg-white border border-[#E2E8F0] rounded-lg p-6 mb-6">
        <h3 className="text-lg font-semibold text-[#0F172A] mb-4">Status Management</h3>
        <div className="flex gap-3">
          {(["active", "draft", "archived"] as const).map((s) => (
            <button
              key={s}
              onClick={() => handleStatusChange(s)}
              disabled={saving || tpl.status === s}
              className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 ${
                tpl.status === s
                  ? "bg-[#1D4ED8] text-white"
                  : "bg-[#F8FAFC] text-[#64748B] hover:bg-[#E2E8F0]"
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Mapping Impact */}
      {tpl.mappings.length > 0 && (
        <div className="bg-white border border-[#E2E8F0] rounded-lg mb-6">
          <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-[#8B5CF6]" />
            <h3 className="text-lg font-semibold text-[#0F172A]">Mapping Impact</h3>
          </div>
          <div className="divide-y divide-[#E2E8F0]">
            {tpl.mappings.map((m) => (
              <div
                key={`${m.reason_code}-${m.dispute_phase}`}
                className="px-6 py-3 flex items-center justify-between"
              >
                <div>
                  <span className="text-sm font-mono text-[#64748B]">{m.reason_code}</span>
                  <span className="mx-2 text-[#94A3B8]">/</span>
                  <span className="text-sm text-[#0F172A]">{m.dispute_phase}</span>
                </div>
                <Link
                  href="/admin/reason-mapping"
                  className="text-sm text-[#1D4ED8] font-semibold hover:text-[#1E40AF]"
                >
                  View mapping
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sections & Items (read-only) */}
      <div className="bg-white border border-[#E2E8F0] rounded-lg">
        <div className="px-6 py-4 border-b border-[#E2E8F0]">
          <h3 className="text-lg font-semibold text-[#0F172A]">Sections &amp; Items</h3>
        </div>
        {tpl.sections.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-[#64748B]">
            No sections defined for this template
          </div>
        ) : (
          <div className="divide-y divide-[#E2E8F0]">
            {tpl.sections.map((sec) => (
              <div key={sec.id} className="px-6 py-4">
                <h4 className="text-sm font-semibold text-[#0F172A] mb-3">{sec.title_default}</h4>
                <div className="space-y-2">
                  {sec.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start gap-3 px-4 py-2 bg-[#F8FAFC] rounded-lg"
                    >
                      <span
                        className={`px-2 py-0.5 text-xs font-semibold rounded ${
                          item.required
                            ? "bg-[#FEE2E2] text-[#991B1B]"
                            : "bg-[#F1F5F9] text-[#475569]"
                        }`}
                      >
                        {item.required ? "Required" : "Optional"}
                      </span>
                      <div className="flex-1">
                        <div className="text-sm text-[#0F172A]">{item.label_default}</div>
                        {item.guidance_default && (
                          <div className="text-xs text-[#64748B] mt-1">{item.guidance_default}</div>
                        )}
                      </div>
                      <span className="text-xs text-[#94A3B8] font-mono">{item.item_type}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
