import { Search } from "lucide-react";

interface FilterButton {
  label: string;
  value: string;
}

interface AdminFilterBarProps {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: FilterButton[];
  activeFilter?: string;
  onFilterChange?: (value: string) => void;
  children?: React.ReactNode;
}

export function AdminFilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search...",
  filters,
  activeFilter,
  onFilterChange,
  children,
}: AdminFilterBarProps) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-lg p-6 mb-6">
      <div className="flex flex-col md:flex-row gap-4">
        {onSearchChange !== undefined && (
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
              <input
                type="text"
                placeholder={searchPlaceholder}
                value={searchValue ?? ""}
                onChange={(e) => onSearchChange(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent"
              />
            </div>
          </div>
        )}
        {filters && onFilterChange && (
          <div className="flex gap-2">
            {filters.map((f) => (
              <button
                key={f.value}
                onClick={() => onFilterChange(f.value)}
                className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                  activeFilter === f.value
                    ? "bg-[#1D4ED8] text-white"
                    : "bg-[#F8FAFC] text-[#64748B] hover:bg-[#E2E8F0]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
