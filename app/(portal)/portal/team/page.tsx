"use client";

import { useTranslations } from "next-intl";
import { UserPlus, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DemoNotice } from "@/components/ui/demo-notice";

const TEAM_MEMBERS = [
  { name: "John Doe", email: "john@example.com", role: "owner", status: "active", initials: "JD", color: "bg-[#1D4ED8]" },
  { name: "Jane Smith", email: "jane@example.com", role: "admin", status: "active", initials: "JS", color: "bg-[#7C3AED]" },
  { name: "Mike Johnson", email: "mike@example.com", role: "member", status: "active", initials: "MJ", color: "bg-[#059669]" },
  { name: "Sarah Wilson", email: "sarah@example.com", role: "member", status: "pending", initials: "SW", color: "bg-[#D97706]" },
];

const roleBadgeVariant: Record<string, "primary" | "info" | "default"> = {
  owner: "primary",
  admin: "info",
  member: "default",
};

export default function TeamPage() {
  const t = useTranslations("team");
  const tc = useTranslations("common");
  const tStatus = useTranslations("status");
  const tTable = useTranslations("table");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220]">{t("title")}</h1>
          <p className="text-sm text-[#667085]">{t("subtitle")}</p>
        </div>
        <Button variant="primary" size="sm" disabled title={tc("demoOnly")}>
          <UserPlus className="w-4 h-4 mr-2" />
          {t("inviteMember")}
        </Button>
      </div>

      <DemoNotice />

      <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead className="bg-[#F7F8FA]">
            <tr>
              <th className="text-left px-6 py-3 font-medium text-[#667085]">{t("member")}</th>
              <th className="text-left px-6 py-3 font-medium text-[#667085]">{t("role")}</th>
              <th className="text-left px-6 py-3 font-medium text-[#667085]">{tTable("status")}</th>
              <th className="text-right px-6 py-3 font-medium text-[#667085]">{t("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {TEAM_MEMBERS.map((m) => (
              <tr key={m.email} className="border-t border-[#E5E7EB] hover:bg-[#F7F8FA] transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 ${m.color} rounded-full flex items-center justify-center text-white text-sm font-semibold`}>
                      {m.initials}
                    </div>
                    <div>
                      <p className="font-medium text-[#0B1220]">{m.name}</p>
                      <p className="text-xs text-[#667085]">{m.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <Badge variant={roleBadgeVariant[m.role] ?? "default"}>
                    {t(m.role)}
                  </Badge>
                </td>
                <td className="px-6 py-4">
                  <Badge variant={m.status === "active" ? "success" : "warning"}>
                    {m.status === "active" ? tStatus("active") : tStatus("pending")}
                  </Badge>
                </td>
                <td className="px-6 py-4 text-right">
                  {m.role !== "owner" && (
                    <Button variant="ghost" size="sm" title={tc("demoOnly")}>{tc("remove")}</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pending Invitations */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
        <div className="flex items-center gap-2 mb-4">
          <Mail className="w-5 h-5 text-[#667085]" />
          <h3 className="font-semibold text-[#0B1220]">{t("pendingInvitations")}</h3>
        </div>
        <div className="text-center py-8">
          <div className="w-12 h-12 bg-[#F1F5F9] rounded-full flex items-center justify-center mx-auto mb-3">
            <Mail className="w-6 h-6 text-[#94A3B8]" />
          </div>
          <p className="text-sm text-[#667085] mb-1">{t("noPendingInvitations")}</p>
          <p className="text-xs text-[#94A3B8]">{t("invitePrompt")}</p>
        </div>
      </div>
    </div>
  );
}
