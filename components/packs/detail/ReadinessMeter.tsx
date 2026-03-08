"use client";

interface ReadinessMeterProps {
  score: number;
  label: string;
  helperText: string;
  stateLabel: string;
}

function barColor(score: number): string {
  if (score >= 90) return "bg-[#22C55E]";
  if (score >= 60) return "bg-[#22C55E]";
  if (score >= 25) return "bg-[#F59E0B]";
  return "bg-[#EF4444]";
}

function textColor(score: number): string {
  if (score >= 90) return "text-[#22C55E]";
  if (score >= 60) return "text-[#22C55E]";
  if (score >= 25) return "text-[#F59E0B]";
  return "text-[#EF4444]";
}

export function ReadinessMeter({
  score,
  label,
  helperText,
  stateLabel,
}: ReadinessMeterProps) {
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 mb-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-[#0B1220]">{label}</h3>
        <span className={`text-xl font-bold ${textColor(score)}`}>{score}%</span>
      </div>
      <p className="text-sm text-[#667085] mb-3">{helperText}</p>
      <div className="w-full h-2.5 bg-[#E5E7EB] rounded-full overflow-hidden mb-2">
        <div
          className={`h-full rounded-full transition-all ${barColor(score)}`}
          style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
        />
      </div>
      <p className="text-sm font-medium text-[#667085]">{stateLabel}</p>
    </div>
  );
}
