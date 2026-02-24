import { TrendingUp, TrendingDown } from "lucide-react";

export interface KPICardProps {
  label: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon?: React.ReactNode;
}

export function KPICard({
  label,
  value,
  change,
  changeLabel,
  icon,
}: KPICardProps) {
  const isPositive = change !== undefined && change > 0;
  const isNegative = change !== undefined && change < 0;

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-[#667085] mb-1">{label}</p>
          <p className="text-2xl font-semibold text-[#0B1220] mb-2">{value}</p>
          {change !== undefined && (
            <div className="flex items-center gap-1">
              {isPositive && (
                <TrendingUp className="w-4 h-4 text-[#10B981]" />
              )}
              {isNegative && (
                <TrendingDown className="w-4 h-4 text-[#EF4444]" />
              )}
              <span
                className={`text-sm font-medium ${
                  isPositive
                    ? "text-[#10B981]"
                    : isNegative
                      ? "text-[#EF4444]"
                      : "text-[#667085]"
                }`}
              >
                {change > 0 && "+"}
                {change}%
              </span>
              {changeLabel && (
                <span className="text-sm text-[#667085] ml-1">
                  {changeLabel}
                </span>
              )}
            </div>
          )}
        </div>
        {icon && <div className="text-[#4F46E5]">{icon}</div>}
      </div>
    </div>
  );
}
