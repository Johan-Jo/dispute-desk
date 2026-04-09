"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatsRow } from "@/components/admin/AdminStatsRow";

interface HealthIssue {
  severity: "critical" | "warning" | "info";
  type: string;
  message: string;
  target_id?: string;
  target_label?: string;
  fix_path?: string;
}

interface HealthData {
  issues: HealthIssue[];
  stats: { total: number; critical: number; warning: number; info: number };
}

const SEVERITY_CONFIG = {
  critical: {
    icon: AlertTriangle,
    bg: "bg-[#FEE2E2]",
    border: "border-[#FECACA]",
    iconColor: "text-[#DC2626]",
    label: "Critical",
    labelBg: "bg-[#FEE2E2] text-[#991B1B]",
  },
  warning: {
    icon: AlertCircle,
    bg: "bg-[#FEF3C7]",
    border: "border-[#FDE68A]",
    iconColor: "text-[#F59E0B]",
    label: "Warning",
    labelBg: "bg-[#FEF3C7] text-[#92400E]",
  },
  info: {
    icon: Info,
    bg: "bg-[#DBEAFE]",
    border: "border-[#BFDBFE]",
    iconColor: "text-[#3B82F6]",
    label: "Info",
    labelBg: "bg-[#DBEAFE] text-[#1E40AF]",
  },
};

export default function TemplateHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/template-health")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-8">
        <div className="text-[#64748B] py-12 text-center">Loading health data...</div>
      </div>
    );
  }

  const issues = data?.issues ?? [];
  const stats = data?.stats ?? { total: 0, critical: 0, warning: 0, info: 0 };

  const grouped = {
    critical: issues.filter((i) => i.severity === "critical"),
    warning: issues.filter((i) => i.severity === "warning"),
    info: issues.filter((i) => i.severity === "info"),
  };

  return (
    <div className="p-8">
      <AdminPageHeader
        title="Template Health"
        subtitle="QA and governance monitoring for templates and mappings"
        icon={Activity}
        iconGradient="from-[#F59E0B] to-[#EF4444]"
      />

      <AdminStatsRow
        cards={[
          { label: "Total Issues", value: stats.total },
          { label: "Critical", value: stats.critical, valueColor: "text-[#EF4444]" },
          { label: "Warning", value: stats.warning, valueColor: "text-[#F59E0B]" },
          { label: "Info", value: stats.info, valueColor: "text-[#3B82F6]" },
        ]}
      />

      {stats.total === 0 ? (
        <div className="bg-white border border-[#E2E8F0] rounded-lg p-12 text-center">
          <div className="w-16 h-16 bg-[#D1FAE5] rounded-full flex items-center justify-center mx-auto mb-4">
            <Activity className="w-8 h-8 text-[#22C55E]" />
          </div>
          <h3 className="text-lg font-semibold text-[#0F172A] mb-2">All clear</h3>
          <p className="text-sm text-[#64748B]">No template health issues detected</p>
        </div>
      ) : (
        <div className="space-y-6">
          {(["critical", "warning", "info"] as const).map((severity) => {
            const items = grouped[severity];
            if (items.length === 0) return null;
            const config = SEVERITY_CONFIG[severity];
            const SeverityIcon = config.icon;

            return (
              <div key={severity} className="bg-white border border-[#E2E8F0] rounded-lg">
                <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <SeverityIcon className={`w-5 h-5 ${config.iconColor}`} />
                    <h2 className="text-lg font-semibold text-[#0F172A]">{config.label}</h2>
                  </div>
                  <span className={`px-3 py-1 text-xs font-semibold rounded-full ${config.labelBg}`}>
                    {items.length} {items.length === 1 ? "issue" : "issues"}
                  </span>
                </div>
                <div className="divide-y divide-[#E2E8F0]">
                  {items.map((issue, idx) => (
                    <div
                      key={idx}
                      className="px-6 py-4 flex items-center justify-between hover:bg-[#F8FAFC] transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-2 h-2 rounded-full ${
                          severity === "critical" ? "bg-[#EF4444]" :
                          severity === "warning" ? "bg-[#F59E0B]" : "bg-[#3B82F6]"
                        }`} />
                        <div>
                          <div className="text-sm font-medium text-[#0F172A]">{issue.message}</div>
                          {issue.target_label && (
                            <div className="text-xs text-[#64748B] font-mono mt-0.5">
                              {issue.target_label}
                            </div>
                          )}
                        </div>
                      </div>
                      {issue.fix_path && (
                        <Link
                          href={issue.fix_path}
                          className="px-4 py-2 bg-[#EFF6FF] text-[#1D4ED8] text-sm font-semibold rounded-lg hover:bg-[#DBEAFE] transition-colors"
                        >
                          Fix
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
