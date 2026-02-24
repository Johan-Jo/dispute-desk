import { Search, Filter, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const SAMPLE_DISPUTES = [
  { id: "DP-2401", order: "#1042", amount: "$145.00", reason: "Not received", status: "saved_to_shopify", deadline: "Mar 02", customer: "john@example.com" },
  { id: "DP-2402", order: "#1039", amount: "$89.50", reason: "Fraudulent", status: "needs_review", deadline: "Mar 05", customer: "jane@example.com" },
  { id: "DP-2403", order: "#1035", amount: "$234.00", reason: "Not as described", status: "won", deadline: "—", customer: "bob@example.com" },
  { id: "DP-2404", order: "#1028", amount: "$67.00", reason: "Duplicate", status: "blocked", deadline: "Mar 08", customer: "alice@example.com" },
  { id: "DP-2405", order: "#1025", amount: "$312.00", reason: "Not received", status: "building", deadline: "Mar 10", customer: "sarah@example.com" },
];

function statusBadge(status: string) {
  const map: Record<string, { variant: "success" | "warning" | "danger" | "info" | "default"; label: string }> = {
    saved_to_shopify: { variant: "success", label: "Saved to Shopify" },
    needs_review: { variant: "warning", label: "Needs Review" },
    building: { variant: "info", label: "Building..." },
    blocked: { variant: "danger", label: "Blocked" },
    ready: { variant: "primary" as "info", label: "Ready to Save" },
    won: { variant: "success", label: "Won" },
    lost: { variant: "danger", label: "Lost" },
  };
  const cfg = map[status] ?? { variant: "default" as const, label: status };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

export default function DisputesPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220]">Disputes</h1>
          <p className="text-sm text-[#667085]">Manage and respond to chargebacks</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-[50%] -translate-y-[50%] text-[#64748B]" />
          <input
            type="text"
            placeholder="Search disputes..."
            className="w-full h-10 pl-10 pr-3 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
          />
        </div>
        <Button variant="secondary" size="sm">
          <Filter className="w-4 h-4 mr-1" />
          Filter
        </Button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#F7F8FA]">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">ID</th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">Order</th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">Customer</th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">Amount</th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">Reason</th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">Status</th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">Deadline</th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE_DISPUTES.map((d) => (
                <tr key={d.id} className="border-t border-[#E5E7EB] hover:bg-[#F7F8FA] transition-colors">
                  <td className="px-4 py-3">
                    <a href={`/portal/disputes/${d.id}`} className="font-medium text-[#1D4ED8] hover:underline">
                      {d.id}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-[#667085]">{d.order}</td>
                  <td className="px-4 py-3 text-[#667085]">{d.customer}</td>
                  <td className="px-4 py-3 font-medium text-[#0B1220]">{d.amount}</td>
                  <td className="px-4 py-3 text-[#667085]">{d.reason}</td>
                  <td className="px-4 py-3">{statusBadge(d.status)}</td>
                  <td className="px-4 py-3 text-[#667085]">{d.deadline}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
