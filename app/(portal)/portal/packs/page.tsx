import { FileText, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const SAMPLE_PACKS = [
  { id: "PK-001", dispute: "DP-2401", score: 67, status: "in_progress", updated: "Feb 24" },
  { id: "PK-002", dispute: "DP-2402", score: 100, status: "complete", updated: "Feb 22" },
  { id: "PK-003", dispute: "DP-2403", score: 85, status: "complete", updated: "Feb 20" },
];

export default function PacksPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220]">Evidence Packs</h1>
          <p className="text-sm text-[#667085]">View and manage evidence packages</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {SAMPLE_PACKS.map((p) => (
          <div key={p.id} className="bg-white rounded-lg border border-[#E5E7EB] p-6 hover:border-[#4F46E5] transition-colors">
            <div className="flex items-start justify-between mb-4">
              <div className="w-10 h-10 bg-[#EFF6FF] rounded-lg flex items-center justify-center">
                <FileText className="w-5 h-5 text-[#4F46E5]" />
              </div>
              <Badge variant={p.status === "complete" ? "success" : "warning"}>
                {p.status === "complete" ? "Complete" : "In progress"}
              </Badge>
            </div>
            <h3 className="font-semibold text-[#0B1220] mb-1">{p.id}</h3>
            <p className="text-sm text-[#667085] mb-3">Dispute: {p.dispute}</p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-[#667085]">Completeness</p>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-24 h-2 bg-[#E5E7EB] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${p.score === 100 ? "bg-[#22C55E]" : "bg-[#F59E0B]"}`}
                      style={{ width: `${p.score}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-[#0B1220]">{p.score}%</span>
                </div>
              </div>
              {p.status === "complete" && (
                <Button variant="ghost" size="sm">
                  <Download className="w-4 h-4" />
                </Button>
              )}
            </div>
            <p className="text-xs text-[#667085] mt-3">Updated {p.updated}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
