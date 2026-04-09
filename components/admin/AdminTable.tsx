import { Search } from "lucide-react";

interface AdminTableProps {
  headers: string[];
  /** Pass `"right"` to right-align a header (e.g. for Actions columns). Index matches headers array. */
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
                {headers.map((header, i) => (
                  <th
                    key={header}
                    className={`px-6 py-3 text-xs font-semibold text-[#64748B] uppercase tracking-wider ${
                      headerAlign?.[i] === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    {header}
                  </th>
                ))}
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
