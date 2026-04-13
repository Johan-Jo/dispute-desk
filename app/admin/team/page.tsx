"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Users,
  Plus,
  Calendar,
  CheckCircle,
  XCircle,
  Trash2,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatsRow } from "@/components/admin/AdminStatsRow";
import { AdminFilterBar } from "@/components/admin/AdminFilterBar";
import { AdminTable } from "@/components/admin/AdminTable";

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  created_by: string | null;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminTeamPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [showForm, setShowForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/team");
    const data = await res.json();
    setUsers(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormLoading(true);
    const res = await fetch("/api/admin/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: newEmail.trim() }),
    });
    if (res.ok) {
      setNewEmail("");
      setShowForm(false);
      fetchUsers();
    } else {
      const d = await res.json();
      setFormError(d.error ?? "Failed to grant access");
    }
    setFormLoading(false);
  };

  const toggleActive = async (user: AdminUser) => {
    await fetch(`/api/admin/team/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !user.is_active }),
    });
    fetchUsers();
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/admin/team/${id}`, { method: "DELETE" });
    if (res.ok) {
      setConfirmDelete(null);
      fetchUsers();
    } else {
      const d = await res.json();
      setError(d.error ?? "Delete failed");
    }
  };

  const filtered = users.filter((u) => {
    if (search) {
      const q = search.toLowerCase();
      if (!u.email.toLowerCase().includes(q) && !(u.name ?? "").toLowerCase().includes(q))
        return false;
    }
    if (statusFilter === "active" && !u.is_active) return false;
    if (statusFilter === "inactive" && u.is_active) return false;
    return true;
  });

  const activeCount = users.filter((u) => u.is_active).length;
  const inactiveCount = users.filter((u) => !u.is_active).length;

  return (
    <div className="p-8">
      <AdminPageHeader
        title="Team"
        subtitle="Manage internal admin access and permissions"
        icon={Users}
        iconGradient="from-[#F59E0B] to-[#D97706]"
        actions={
          <button
            onClick={() => {
              setShowForm(true);
              setFormError(null);
            }}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#1D4ED8] text-white text-sm font-semibold rounded-lg hover:bg-[#1E40AF] transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Team Member
          </button>
        }
      />

      <AdminStatsRow
        cards={[
          { label: "Total Members", value: users.length },
          { label: "Active", value: activeCount, valueColor: "text-[#22C55E]" },
          { label: "Inactive", value: inactiveCount, valueColor: "text-[#EF4444]" },
        ]}
      />

      {error && <p className="text-sm text-[#EF4444] mb-4">{error}</p>}

      {showForm && (
        <div className="bg-white border border-[#E2E8F0] rounded-lg p-6 mb-6">
          <h2 className="font-semibold text-[#0F172A] mb-2">Grant admin access</h2>
          <p className="text-sm text-[#64748B] mb-4">
            Enter the email they use to sign in to DisputeDesk (portal). They must already have an
            account.
          </p>
          <form onSubmit={handleAdd} className="space-y-3 max-w-sm">
            <input
              type="email"
              placeholder="Email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="w-full py-2.5 px-4 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent"
            />
            {formError && <p className="text-sm text-[#EF4444]">{formError}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={formLoading}
                className="px-5 py-2.5 bg-[#1D4ED8] text-white text-sm font-semibold rounded-lg hover:bg-[#1E40AF] transition-colors disabled:opacity-50"
              >
                {formLoading ? "Saving..." : "Grant access"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-5 py-2.5 bg-[#F8FAFC] text-[#64748B] text-sm font-semibold rounded-lg hover:bg-[#E2E8F0] transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <AdminFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name or email..."
        filters={[
          { label: "All", value: "all" },
          { label: "Active", value: "active" },
          { label: "Inactive", value: "inactive" },
        ]}
        activeFilter={statusFilter}
        onFilterChange={setStatusFilter}
      />

      <AdminTable
        headers={["Member", "Status", "Last Active", "Created", "Created By", "Actions"]}
        headerAlign={{ 5: "right" }}
        loading={loading}
        isEmpty={!loading && filtered.length === 0}
        emptyTitle="No team members found"
        emptyMessage="Try adjusting your search or add a new team member"
      >
        {filtered.map((user) => (
          <tr key={user.id} className="hover:bg-[#F8FAFC] transition-colors">
            <td className="px-6 py-4">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white ${
                    user.is_active
                      ? "bg-gradient-to-br from-[#3B82F6] to-[#1D4ED8]"
                      : "bg-[#94A3B8]"
                  }`}
                >
                  {(user.name ?? user.email)
                    .split(/[\s@]/)
                    .map((n) => n[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2)}
                </div>
                <div>
                  <div className="text-sm font-medium text-[#0F172A]">{user.name ?? "—"}</div>
                  <div className="text-xs text-[#64748B]">{user.email}</div>
                </div>
              </div>
            </td>
            <td className="px-6 py-4">
              {user.is_active ? (
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-[#22C55E]" />
                  <span className="text-sm text-[#22C55E] font-medium">Active</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-[#94A3B8]" />
                  <span className="text-sm text-[#94A3B8] font-medium">Inactive</span>
                </div>
              )}
            </td>
            <td className="px-6 py-4">
              <span className="text-sm text-[#64748B]">{formatDate(user.last_login_at)}</span>
            </td>
            <td className="px-6 py-4">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#64748B]" />
                <span className="text-sm text-[#64748B]">{formatDate(user.created_at)}</span>
              </div>
            </td>
            <td className="px-6 py-4">
              <span className="text-xs text-[#64748B]">{user.created_by ?? "—"}</span>
            </td>
            <td className="px-6 py-4 text-right">
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => toggleActive(user)}
                  title={user.is_active ? "Deactivate" : "Activate"}
                  className="p-2 text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] rounded-lg transition-colors"
                >
                  {user.is_active ? (
                    <ToggleRight className="w-5 h-5 text-[#22C55E]" />
                  ) : (
                    <ToggleLeft className="w-5 h-5" />
                  )}
                </button>
                {confirmDelete === user.id ? (
                  <span className="flex items-center gap-1">
                    <button
                      onClick={() => handleDelete(user.id)}
                      className="text-xs text-[#EF4444] font-semibold hover:underline"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="text-xs text-[#64748B] hover:underline"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(user.id)}
                    title="Revoke admin"
                    className="p-2 text-[#64748B] hover:text-[#EF4444] hover:bg-[#FEE2E2] rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </AdminTable>

      {/* Role Permissions */}
      <div className="mt-8 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-6">
        <h3 className="text-sm font-semibold text-[#0F172A] mb-4">Role Permissions</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 bg-[#6B21A8] rounded-full" />
              <span className="text-sm font-semibold text-[#0F172A]">Admin</span>
            </div>
            <ul className="space-y-1 text-xs text-[#64748B] ml-4">
              <li>Full access to all features</li>
              <li>Manage team members</li>
              <li>Configure templates &amp; mappings</li>
              <li>Access billing &amp; audit logs</li>
            </ul>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 bg-[#1E40AF] rounded-full" />
              <span className="text-sm font-semibold text-[#0F172A]">Editor</span>
            </div>
            <ul className="space-y-1 text-xs text-[#64748B] ml-4">
              <li>Edit templates &amp; content</li>
              <li>Modify reason mappings</li>
              <li>View shops &amp; disputes</li>
              <li>No billing or team access</li>
            </ul>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 bg-[#475569] rounded-full" />
              <span className="text-sm font-semibold text-[#0F172A]">Viewer</span>
            </div>
            <ul className="space-y-1 text-xs text-[#64748B] ml-4">
              <li>Read-only access</li>
              <li>View all data</li>
              <li>Cannot make changes</li>
              <li>Audit log access</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
