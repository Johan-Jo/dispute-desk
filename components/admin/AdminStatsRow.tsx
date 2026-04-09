import type { LucideIcon } from "lucide-react";

interface StatCard {
  label: string;
  value: string | number;
  change?: string;
  changeType?: "up" | "down" | "neutral";
  icon?: LucideIcon;
  iconBg?: string;
  iconColor?: string;
  valueColor?: string;
}

interface AdminStatsRowProps {
  cards: StatCard[];
}

export function AdminStatsRow({ cards }: AdminStatsRowProps) {
  return (
    <div
      className="grid gap-4 mb-8"
      style={{ gridTemplateColumns: `repeat(${Math.min(cards.length, 4)}, minmax(0, 1fr))` }}
    >
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className="bg-white border border-[#E2E8F0] rounded-lg p-5"
          >
            {Icon ? (
              <>
                <div className="flex items-start justify-between mb-4">
                  <div
                    className={`w-10 h-10 ${card.iconBg ?? "bg-[#EFF6FF]"} rounded-lg flex items-center justify-center`}
                  >
                    <Icon className={`w-5 h-5 ${card.iconColor ?? "text-[#1D4ED8]"}`} />
                  </div>
                  {card.change && (
                    <span
                      className={`text-xs font-semibold px-2 py-1 rounded-full ${
                        card.changeType === "down"
                          ? "bg-[#FEE2E2] text-[#991B1B]"
                          : "bg-[#D1FAE5] text-[#065F46]"
                      }`}
                    >
                      {card.change}
                    </span>
                  )}
                </div>
                <div className={`text-2xl font-bold ${card.valueColor ?? "text-[#0F172A]"} mb-1`}>
                  {card.value}
                </div>
                <div className="text-sm text-[#64748B]">{card.label}</div>
              </>
            ) : (
              <>
                <div className="text-sm text-[#64748B] mb-1">{card.label}</div>
                <div className={`text-2xl font-bold ${card.valueColor ?? "text-[#0F172A]"}`}>
                  {card.value}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
