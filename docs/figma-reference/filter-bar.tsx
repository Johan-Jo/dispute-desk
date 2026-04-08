import React from 'react';
import { Search, Filter, X } from 'lucide-react';
import { Button } from './button';

export interface FilterBarProps {
  searchPlaceholder?: string;
  onSearch?: (value: string) => void;
  filters?: Array<{
    label: string;
    value: string;
    active?: boolean;
  }>;
  onFilterChange?: (value: string) => void;
  onClearFilters?: () => void;
}

export function FilterBar({
  searchPlaceholder = 'Search...',
  onSearch,
  filters = [],
  onFilterChange,
  onClearFilters,
}: FilterBarProps) {
  const [searchValue, setSearchValue] = React.useState('');
  const activeFilters = filters.filter((f) => f.active);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value);
    onSearch?.(e.target.value);
  };

  return (
    <div className="bg-white border-b border-[#E5E7EB] p-4">
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#667085]" />
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={handleSearch}
            className="w-full h-10 pl-10 pr-4 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5] focus:border-transparent"
          />
        </div>
        
        {filters.length > 0 && (
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[#667085]" />
            {filters.map((filter) => (
              <button
                key={filter.value}
                onClick={() => onFilterChange?.(filter.value)}
                className={`px-3 h-10 rounded-lg text-sm font-medium transition-colors ${
                  filter.active
                    ? 'bg-[#4F46E5] text-white'
                    : 'bg-[#F7F8FA] text-[#667085] hover:bg-[#E5E7EB]'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        )}

        {activeFilters.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onClearFilters}>
            <X className="w-4 h-4 mr-1" />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
