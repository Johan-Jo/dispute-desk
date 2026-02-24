import { Plus, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const SAMPLE_MEMBERS = [
  { name: "You", email: "you@company.com", role: "admin", status: "active" },
  { name: "Alice Johnson", email: "alice@company.com", role: "member", status: "active" },
  { name: "Bob Smith", email: "bob@company.com", role: "read_only", status: "pending" },
];

export default function TeamPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220]">Team</h1>
          <p className="text-sm text-[#667085]">Manage who has access to this store</p>
        </div>
        <Button variant="primary" size="sm">
          <UserPlus className="w-4 h-4 mr-1" />
          Invite member
        </Button>
      </div>

      <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#F7F8FA]">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-[#667085]">Member</th>
              <th className="text-left px-4 py-3 font-medium text-[#667085]">Role</th>
              <th className="text-left px-4 py-3 font-medium text-[#667085]">Status</th>
              <th className="text-right px-4 py-3 font-medium text-[#667085]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_MEMBERS.map((m) => (
              <tr key={m.email} className="border-t border-[#E5E7EB] hover:bg-[#F7F8FA] transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-[#DBEAFE] rounded-full flex items-center justify-center text-[#1D4ED8] text-sm font-medium">
                      {m.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium text-[#0B1220]">{m.name}</p>
                      <p className="text-xs text-[#667085]">{m.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={m.role === "admin" ? "primary" : "default"}>
                    {m.role}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={m.status === "active" ? "success" : "warning"}>
                    {m.status}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  {m.name !== "You" && (
                    <Button variant="ghost" size="sm">Remove</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
