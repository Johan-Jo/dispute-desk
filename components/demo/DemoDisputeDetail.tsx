"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Clock,
  AlertTriangle,
  Shield,
  CheckCircle2,
  FileText,
  Eye,
  Sparkles,
  TrendingUp,
  XCircle,
} from "lucide-react";
import type { DemoDispute } from "@/lib/demo/fixtures/types";
import { InstallCTA } from "./InstallCTA";
import { ReviewEvidencePanel } from "./panels/ReviewEvidencePanel";
import { DefensePackagePreview } from "./panels/DefensePackagePreview";
import { SubmissionSummaryDrawer } from "./panels/SubmissionSummaryDrawer";
import { CaseStrengthDrawer } from "./panels/CaseStrengthDrawer";
import { MerchantInputChecklist } from "./panels/MerchantInputChecklist";

const STRENGTH_STYLES = {
  strong: { bg: "bg-[#DCFCE7]", text: "text-[#166534]", border: "border-[#BBF7D0]", label: "Strong" },
  moderate: { bg: "bg-[#FEF3C7]", text: "text-[#92400E]", border: "border-[#FDE68A]", label: "Moderate" },
  weak: { bg: "bg-[#FEE2E2]", text: "text-[#991B1B]", border: "border-[#FECACA]", label: "Weak" },
  covered: { bg: "bg-[#EDE9FE]", text: "text-[#5B21B6]", border: "border-[#DDD6FE]", label: "Covered" },
  fatal_loss: { bg: "bg-[#FEF3C7]", text: "text-[#92400E]", border: "border-[#FDE68A]", label: "Blocked" },
} as const;

const BANNER_STYLES = {
  purple: { bg: "bg-[#EDE9FE]", border: "border-[#DDD6FE]", title: "text-[#5B21B6]", body: "text-[#6D28D9]", Icon: Shield },
  amber: { bg: "bg-[#FEF3C7]", border: "border-[#FDE68A]", title: "text-[#92400E]", body: "text-[#B45309]", Icon: AlertTriangle },
  blue: { bg: "bg-[#EFF6FF]", border: "border-[#BFDBFE]", title: "text-[#1E3A8A]", body: "text-[#1E40AF]", Icon: Eye },
  red: { bg: "bg-[#FEE2E2]", border: "border-[#FECACA]", title: "text-[#991B1B]", body: "text-[#B91C1C]", Icon: XCircle },
} as const;

interface Props {
  dispute: DemoDispute;
  isHero?: boolean;
}

export function DemoDisputeDetail({ dispute, isHero = false }: Props) {
  const [showPackage, setShowPackage] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [showStrength, setShowStrength] = useState(false);
  const [showInput, setShowInput] = useState(false);

  const strength = STRENGTH_STYLES[dispute.strength];
  const banner = dispute.banner ? BANNER_STYLES[dispute.banner.tone] : null;
  const dueIn = Math.round((new Date(dispute.dueAt).getTime() - new Date("2026-01-15T10:00:00Z").getTime()) / 86_400_000);

  const isBlocked = dispute.status === "covered" || dispute.status === "blocked";
  const showsInputCta = Boolean(dispute.merchantInputChecklist?.length);

  return (
    <div className="space-y-5">
      {/* Back + breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[#6B7280]">
        <Link href="/demo/disputes" className="inline-flex items-center gap-1 hover:text-[#0B1220] transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" />
          All disputes
        </Link>
      </div>

      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-semibold text-[#0B1220]">Dispute {dispute.id.toUpperCase()}</h1>
            <span className={`text-xs font-semibold uppercase tracking-wider px-2 py-1 rounded border ${strength.bg} ${strength.text} ${strength.border}`}>
              {strength.label}
            </span>
          </div>
          <div className="text-sm text-[#6B7280]">
            Order {dispute.orderName} · {dispute.customerName} · ${dispute.amount.toFixed(2)} {dispute.currency} · {dispute.reasonLabel}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#F9FAFB] border border-[#E5E7EB] text-xs text-[#4B5563]">
            <Clock className="w-3.5 h-3.5" />
            Due in {dueIn} {dueIn === 1 ? "day" : "days"}
          </div>
        </div>
      </div>

      {/* Gate banner (covered / fatal-loss / parked-for-review) */}
      {dispute.banner && banner && (
        <div className={`flex items-start gap-3 p-4 rounded-xl border ${banner.bg} ${banner.border}`}>
          <banner.Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${banner.title}`} />
          <div>
            <div className={`text-sm font-semibold ${banner.title}`}>{dispute.banner.title}</div>
            <div className={`text-sm mt-1 ${banner.body}`}>{dispute.banner.body}</div>
          </div>
        </div>
      )}

      {/* HERO CARD — strength + auto-built caption + primary CTAs */}
      {!isBlocked && (
        <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
          <div className={`px-5 py-4 border-b border-[#E5E7EB] flex items-start gap-3 ${dispute.strength === "strong" ? "bg-[#F0FDF4]" : "bg-[#FFFBEB]"}`}>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${dispute.strength === "strong" ? "bg-[#10B981]" : "bg-[#F59E0B]"}`}>
              {dispute.strength === "strong" ? (
                <Sparkles className="w-5 h-5 text-white" />
              ) : (
                <Eye className="w-5 h-5 text-white" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-[#0B1220]">{dispute.heroLine}</div>
              <div className="text-xs text-[#4B5563] mt-1">{dispute.strengthCaption}</div>
            </div>
            <div className={`text-2xl font-bold ${strength.text}`}>{dispute.strengthScore}%</div>
          </div>

          {/* Action buttons — these are the fake-interactivity entry points */}
          <div className="p-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <button
              type="button"
              onClick={() => setShowStrength(true)}
              className="inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-medium rounded-md bg-white border border-[#E5E7EB] text-[#0B1220] hover:bg-[#F9FAFB] transition-colors"
            >
              <TrendingUp className="w-3.5 h-3.5 text-[#7C3AED]" />
              See why this is {strength.label.toLowerCase()}
            </button>
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById("evidence-panel");
                el?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-medium rounded-md bg-white border border-[#E5E7EB] text-[#0B1220] hover:bg-[#F9FAFB] transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" />
              Review evidence
            </button>
            <button
              type="button"
              onClick={() => setShowSummary(true)}
              className="inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-medium rounded-md bg-white border border-[#E5E7EB] text-[#0B1220] hover:bg-[#F9FAFB] transition-colors"
            >
              <FileText className="w-3.5 h-3.5 text-[#3B82F6]" />
              View submission summary
            </button>
            <button
              type="button"
              onClick={() => setShowPackage(true)}
              className="inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-medium rounded-md bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              Preview defence package
            </button>
          </div>
        </div>
      )}

      {/* "Needs merchant input" prompt — only on weak dispute */}
      {showsInputCta && (
        <div className="rounded-xl border-2 border-dashed border-[#BFDBFE] bg-[#EFF6FF] p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-[#1D4ED8] flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-[#1E3A8A]">Two items needed to strengthen this case</div>
              <div className="text-xs text-[#1E40AF] mt-0.5">DisputeDesk will assemble and submit once you add them.</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowInput(true)}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium rounded-md bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition-colors"
          >
            Show me what&apos;s missing
          </button>
        </div>
      )}

      {/* Evidence panel — always visible underneath */}
      {!isBlocked && (
        <div id="evidence-panel">
          <ReviewEvidencePanel dispute={dispute} />
        </div>
      )}

      {/* Timeline */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white">
        <div className="px-5 py-4 border-b border-[#E5E7EB]">
          <h3 className="text-sm font-semibold text-[#0B1220]">Activity timeline</h3>
        </div>
        <ol className="p-5 space-y-3">
          {dispute.timeline.map((e) => (
            <li key={e.id} className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[#7C3AED] mt-1.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[#0B1220] font-medium">{e.label}</div>
                {e.detail && <div className="text-xs text-[#6B7280] mt-0.5">{e.detail}</div>}
                <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] mt-1">
                  {new Date(e.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Inline conversion card — only on the hero page */}
      {isHero && (
        <InstallCTA
          variant="inline"
          label="Want DisputeDesk to prepare cases like this for your store? Install now"
        />
      )}

      {/* Interactive overlays */}
      {showPackage && <DefensePackagePreview dispute={dispute} onClose={() => setShowPackage(false)} />}
      {showSummary && <SubmissionSummaryDrawer dispute={dispute} onClose={() => setShowSummary(false)} />}
      {showStrength && <CaseStrengthDrawer dispute={dispute} onClose={() => setShowStrength(false)} />}
      {showInput && <MerchantInputChecklist dispute={dispute} onClose={() => setShowInput(false)} />}
    </div>
  );
}
