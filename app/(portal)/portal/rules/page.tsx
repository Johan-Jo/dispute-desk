import { Plus, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const SAMPLE_RULES = [
  { id: 1, name: "Auto-attach tracking for 'not received'", type: "auto-evidence", active: true },
  { id: 2, name: "Flag disputes over $500", type: "alert", active: true },
  { id: 3, name: "Include return policy for all disputes", type: "auto-evidence", active: false },
];

export default function RulesPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220]">Rules</h1>
          <p className="text-sm text-[#667085]">Automate evidence collection and dispute handling</p>
        </div>
        <Button variant="primary" size="sm">
          <Plus className="w-4 h-4 mr-1" />
          New rule
        </Button>
      </div>

      <div className="space-y-3">
        {SAMPLE_RULES.map((r) => (
          <div key={r.id} className="bg-white rounded-lg border border-[#E5E7EB] p-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-[#EFF6FF] rounded-lg flex items-center justify-center">
                <Zap className="w-5 h-5 text-[#4F46E5]" />
              </div>
              <div>
                <p className="font-medium text-[#0B1220]">{r.name}</p>
                <p className="text-sm text-[#667085]">{r.type}</p>
              </div>
            </div>
            <Badge variant={r.active ? "success" : "default"}>
              {r.active ? "Active" : "Inactive"}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
