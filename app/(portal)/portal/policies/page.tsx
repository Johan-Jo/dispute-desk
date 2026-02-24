import { Plus, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const SAMPLE_POLICIES = [
  { id: 1, name: "Refund Policy", lastUpdated: "Feb 15, 2026", status: "active" },
  { id: 2, name: "Return Policy", lastUpdated: "Jan 20, 2026", status: "active" },
  { id: 3, name: "Terms of Service", lastUpdated: "Dec 10, 2025", status: "draft" },
];

export default function PoliciesPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220]">Policies</h1>
          <p className="text-sm text-[#667085]">Manage store policies used in evidence packs</p>
        </div>
        <Button variant="primary" size="sm">
          <Plus className="w-4 h-4 mr-1" />
          Add policy
        </Button>
      </div>

      <div className="space-y-3">
        {SAMPLE_POLICIES.map((p) => (
          <div key={p.id} className="bg-white rounded-lg border border-[#E5E7EB] p-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-[#F1F5F9] rounded-lg flex items-center justify-center">
                <FileText className="w-5 h-5 text-[#667085]" />
              </div>
              <div>
                <p className="font-medium text-[#0B1220]">{p.name}</p>
                <p className="text-sm text-[#667085]">Updated {p.lastUpdated}</p>
              </div>
            </div>
            <Badge variant={p.status === "active" ? "success" : "default"}>
              {p.status === "active" ? "Active" : "Draft"}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
