import {
  AlertTriangle,
  TrendingUp,
  FileText,
  CheckCircle,
} from "lucide-react";
import { KPICard } from "@/components/ui/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function DashboardPage() {
  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#0B1220]">Overview</h1>
        <p className="text-sm text-[#667085]">
          Monitor disputes and evidence across your store
        </p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KPICard
          label="Open Disputes"
          value="12"
          change={-8}
          changeLabel="vs last month"
          icon={<AlertTriangle className="w-6 h-6" />}
        />
        <KPICard
          label="Win Rate"
          value="67%"
          change={5}
          changeLabel="vs last month"
          icon={<TrendingUp className="w-6 h-6" />}
        />
        <KPICard
          label="Active Packs"
          value="8"
          icon={<FileText className="w-6 h-6" />}
        />
        <KPICard
          label="Resolved"
          value="34"
          change={12}
          changeLabel="vs last month"
          icon={<CheckCircle className="w-6 h-6" />}
        />
      </div>

      {/* Recent Disputes table */}
      <div className="bg-white rounded-lg border border-[#E5E7EB]">
        <div className="flex items-center justify-between p-4 border-b border-[#E5E7EB]">
          <h2 className="font-semibold text-[#0B1220]">Recent Disputes</h2>
          <a href="/portal/disputes">
            <Button variant="ghost" size="sm">
              View all
            </Button>
          </a>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#F7F8FA]">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">
                  ID
                </th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">
                  Order
                </th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">
                  Amount
                </th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">
                  Reason
                </th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">
                  Status
                </th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">
                  Deadline
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  id: "DP-2401",
                  order: "#1042",
                  amount: "$145.00",
                  reason: "Not received",
                  status: "needs_response",
                  deadline: "Mar 02",
                },
                {
                  id: "DP-2402",
                  order: "#1039",
                  amount: "$89.50",
                  reason: "Fraudulent",
                  status: "under_review",
                  deadline: "Mar 05",
                },
                {
                  id: "DP-2403",
                  order: "#1035",
                  amount: "$234.00",
                  reason: "Not as described",
                  status: "won",
                  deadline: "—",
                },
                {
                  id: "DP-2404",
                  order: "#1028",
                  amount: "$67.00",
                  reason: "Duplicate",
                  status: "needs_response",
                  deadline: "Mar 08",
                },
              ].map((d) => (
                <tr
                  key={d.id}
                  className="border-t border-[#E5E7EB] hover:bg-[#F7F8FA] transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-[#0B1220]">
                    {d.id}
                  </td>
                  <td className="px-4 py-3 text-[#667085]">{d.order}</td>
                  <td className="px-4 py-3 font-medium text-[#0B1220]">
                    {d.amount}
                  </td>
                  <td className="px-4 py-3 text-[#667085]">{d.reason}</td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={
                        d.status === "won"
                          ? "success"
                          : d.status === "under_review"
                            ? "info"
                            : "warning"
                      }
                    >
                      {d.status === "needs_response"
                        ? "Needs response"
                        : d.status === "under_review"
                          ? "Under review"
                          : "Won"}
                    </Badge>
                  </td>
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
