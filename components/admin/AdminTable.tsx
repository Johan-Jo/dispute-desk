import { Search, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

/** A header cell. Plain string for static columns; the object form
 *  enables sorting (used by the admin shops list "Chargeback rate
 *  (90d)" column). Backward compatible with every existing call
 *  site that still passes `string[]`. */
export type AdminTableHeader =
  | string
  | {
      label: string;
      align?: "left" | "right";
      sortable?: boolean;
      sortDirection?: "asc" | "desc" | null;
      onSort?: () => void;
    };

interface AdminTableProps {
  headers: AdminTableHeader[];
  /** Pass `"right"` to right-align a header (e.g. for Actions columns).
   *  Used only when the corresponding header is a plain string —
   *  object-form headers carry their own `align` property. */
  headerAlign?: Record<number, "left" | "right">;
  children: React.ReactNode;
  loading?: boolean;
  emptyIcon?: React.ReactNode;
  emptyTitle?: string;
  emptyMessage?: string;
  isEmpty?: boolean;
}

export function AdminTable({
  headers,
  headerAlign,
  children,
  loading,
  emptyIcon,
  emptyTitle = "No results found",
  emptyMessage = "Try adjusting your search or filters",
  isEmpty,
}: AdminTableProps) {
  if (loading) {
    return (
      <div className="bg-white border border-[#E2E8F0] rounded-lg p-12 text-center">
        <div className="text-[#64748B]">Loading...</div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
              <tr>
                {headers.map((header, i) => {
                  const isObject = typeof header !== "string";
                  const label = isObject ? header.label : header;
                  const align = isObject
                    ? header.align ?? "left"
                    : headerAlign?.[i] ?? "left";
                  const sortable = isObject && header.sortable === true;
                  const sortDirection = isObject ? header.sortDirection ?? null : null;
                  const baseClass = `px-6 py-3 text-xs font-semibold text-[#64748B] uppercase tracking-wider ${
                    align === "right" ? "text-right" : "text-left"
                  }`;
                  if (!sortable) {
                    return (
                      <th key={`${label}-${i}`} className={baseClass}>
                        {label}
                      </th>
                    );
                  }
                  const SortIcon =
                    sortDirection === "asc"
                      ? ArrowUp
                      : sortDirection === "desc"
                        ? ArrowDown
                        : ArrowUpDown;
                  return (
                    <th key={`${label}-${i}`} className={baseClass}>
                      <button
                        type="button"
                        onClick={isObject ? header.onSort : undefined}
                        aria-sort={
                          sortDirection === "asc"
                            ? "ascending"
                            : sortDirection === "desc"
                              ? "descending"
                              : "none"
                        }
                        className={`inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider transition-colors ${
                          sortDirection
                            ? "text-[#0F172A]"
                            : "text-[#64748B] hover:text-[#0F172A]"
                        }`}
                      >
                        {label}
                        <SortIcon className="w-3 h-3" />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">{children}</tbody>
          </table>
        </div>
      </div>
      {isEmpty && (
        <div className="bg-white border border-[#E2E8F0] rounded-lg p-12 text-center mt-4">
          <div className="w-16 h-16 bg-[#F1F5F9] rounded-full flex items-center justify-center mx-auto mb-4">
            {emptyIcon ?? <Search className="w-8 h-8 text-[#94A3B8]" />}
          </div>
          <h3 className="text-lg font-semibold text-[#0F172A] mb-2">{emptyTitle}</h3>
          <p className="text-sm text-[#64748B]">{emptyMessage}</p>
        </div>
      )}
    </>
  );
}
