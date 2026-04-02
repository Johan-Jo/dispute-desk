"use client";

import { useState, useEffect, useCallback } from "react";
import { UserPlus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";

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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[#0B1220]">Admin Team</h1>
        <button
          onClick={() => {
            setShowForm(true);
            setFormError(null);
          }}
          className="flex items-center gap-2 h-9 px-4 bg-[#0B1220] text-white text-sm font-medium rounded-lg hover:bg-[#1E293B]"
        >
          <UserPlus className="w-4 h-4" />
          Add user
        </button>
      </div>

      {error && <p className="text-sm text-[#EF4444] mb-4">{error}</p>}

      {showForm && (
        <div className="bg-white border border-[#E5E7EB] rounded-lg p-6 mb-6">
          <h2 className="font-semibold text-[#0B1220] mb-2">Grant admin access</h2>
          <p className="text-sm text-[#667085] mb-4">
            Enter the email they use to sign in to DisputeDesk (portal). They must already have an
            account — if not, they should sign up first at <code className="text-xs">/auth/sign-up</code>.
          </p>
          <form onSubmit={handleAdd} className="space-y-3 max-w-sm">
            <input
              type="email"
              placeholder="Email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="w-full h-10 px-3 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]"
            />
            {formError && <p className="text-sm text-[#EF4444]">{formError}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={formLoading}
                className="h-9 px-4 bg-[#0B1220] text-white text-sm font-medium rounded-lg hover:bg-[#1E293B] disabled:opacity-50"
              >
                {formLoading ? "Saving..." : "Grant access"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="h-9 px-4 border border-[#E5E7EB] text-[#667085] text-sm rounded-lg hover:bg-[#F9FAFB]"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white border border-[#E5E7EB] rounded-lg overflow-hidden">
        {loading ? (
          <p className="text-[#667085] text-sm p-6">Loading...</p>
        ) : users.length === 0 ? (
          <p className="text-[#667085] text-sm p-6">No admin users yet. Add one above.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-[#374151]">Name / Email</th>
                <th className="text-left px-4 py-3 font-medium text-[#374151]">Status</th>
                <th className="text-left px-4 py-3 font-medium text-[#374151]">Last activity</th>
                <th className="text-left px-4 py-3 font-medium text-[#374151]">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-[#F3F4F6] last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-[#0B1220]">{user.name ?? "—"}</p>
                    <p className="text-[#667085]">{user.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        user.is_active
                          ? "bg-[#ECFDF5] text-[#065F46]"
                          : "bg-[#F3F4F6] text-[#6B7280]"
                      }`}
                    >
                      {user.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#667085]">{formatDate(user.last_login_at)}</td>
                  <td className="px-4 py-3 text-[#667085]">
                    {formatDate(user.created_at)}
                    {user.created_by && (
                      <p className="text-xs text-[#94A3B8]">by {user.created_by}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => toggleActive(user)}
                        title={user.is_active ? "Deactivate" : "Activate"}
                        className="text-[#667085] hover:text-[#0B1220]"
                      >
                        {user.is_active ? (
                          <ToggleRight className="w-5 h-5 text-[#10B981]" />
                        ) : (
                          <ToggleLeft className="w-5 h-5" />
                        )}
                      </button>
                      {confirmDelete === user.id ? (
                        <span className="flex items-center gap-1">
                          <button
                            onClick={() => handleDelete(user.id)}
                            className="text-xs text-[#EF4444] font-medium hover:underline"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="text-xs text-[#667085] hover:underline"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(user.id)}
                          title="Revoke admin"
                          className="text-[#667085] hover:text-[#EF4444]"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
