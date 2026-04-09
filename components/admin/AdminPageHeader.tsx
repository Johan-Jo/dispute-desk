import type { LucideIcon } from "lucide-react";

interface AdminPageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  iconGradient?: string;
  actions?: React.ReactNode;
}

export function AdminPageHeader({
  title,
  subtitle,
  icon: Icon,
  iconGradient = "from-[#1D4ED8] to-[#3B82F6]",
  actions,
}: AdminPageHeaderProps) {
  return (
    <div className="mb-8 flex items-start justify-between">
      <div>
        <div className="flex items-center gap-3 mb-2">
          {Icon && (
            <div
              className={`w-10 h-10 bg-gradient-to-br ${iconGradient} rounded-lg flex items-center justify-center`}
            >
              <Icon className="w-5 h-5 text-white" />
            </div>
          )}
          <h1 className="text-3xl font-bold text-[#0F172A]">{title}</h1>
        </div>
        {subtitle && <p className="text-base text-[#64748B]">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
