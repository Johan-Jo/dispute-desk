"use client";

import { useCallback, useEffect, useState } from "react";
import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";
import { Fingerprint, Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

interface Passkey {
  id: string;
  friendlyName: string | null;
  transports: string[] | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export default function AdminPasskeysPage() {
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/admin/passkeys");
    if (res.ok) {
      const data = await res.json();
      setPasskeys(Array.isArray(data.passkeys) ? data.passkeys : []);
    } else {
      setError("Could not load passkeys.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addDevice = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const optRes = await fetch("/api/admin/passkeys/register", { method: "POST" });
      if (!optRes.ok) throw new Error("Could not start enrollment.");
      const options = await optRes.json();
      const regResponse = await startRegistration({ optionsJSON: options });
      const verifyRes = await fetch("/api/admin/passkeys/register", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response: regResponse,
          friendlyName:
            typeof navigator !== "undefined" ? navigator.platform : null,
        }),
      });
      if (!verifyRes.ok) {
        const j = await verifyRes.json().catch(() => null);
        throw new Error(j?.error ?? "Enrollment failed.");
      }
      // Re-assert so this session stays valid (also refreshes the cookie).
      const authOpt = await fetch("/api/admin/passkeys/authenticate", { method: "POST" });
      if (authOpt.ok) {
        const authOptions = await authOpt.json();
        const authResp = await startAuthentication({ optionsJSON: authOptions });
        await fetch("/api/admin/passkeys/authenticate", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response: authResp }),
        });
      }
      await load();
    } catch (err) {
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Biometric prompt was dismissed."
          : err instanceof Error
            ? err.message
            : "Enrollment failed.",
      );
    } finally {
      setBusy(false);
    }
  }, [load]);

  const revoke = useCallback(
    async (id: string) => {
      setError(null);
      const res = await fetch(`/api/admin/passkeys/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? "Could not remove passkey.");
        return;
      }
      await load();
    },
    [load],
  );

  const saveRename = useCallback(
    async (id: string) => {
      const name = editName.trim();
      if (!name) return;
      const res = await fetch(`/api/admin/passkeys/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendlyName: name }),
      });
      if (res.ok) {
        setEditing(null);
        await load();
      } else {
        setError("Could not rename passkey.");
      }
    },
    [editName, load],
  );

  return (
    <div className="p-8">
      <AdminPageHeader
        title="Passkeys"
        subtitle="Manage the devices that can unlock your admin access"
        icon={Fingerprint}
        actions={
          <button
            type="button"
            onClick={addDevice}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#1D4ED8] text-white text-sm font-semibold rounded-lg hover:bg-[#1E40AF] transition-colors disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {busy ? "Adding…" : "Add this device"}
          </button>
        }
      />

      {error && (
        <div className="mb-4 px-4 py-3 bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-sm rounded-lg">
          {error}
        </div>
      )}

      <div className="bg-white border border-[#E2E8F0] rounded-lg divide-y divide-[#E2E8F0]">
        {loading ? (
          <div className="p-8 text-center text-sm text-[#64748B]">Loading…</div>
        ) : passkeys.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#64748B]">
            No passkeys yet.
          </div>
        ) : (
          passkeys.map((pk) => (
            <div key={pk.id} className="flex items-center gap-4 px-5 py-4">
              <div className="w-9 h-9 rounded-full bg-[#EFF6FF] flex items-center justify-center flex-shrink-0">
                <Fingerprint className="w-4 h-4 text-[#1D4ED8]" />
              </div>
              <div className="flex-1 min-w-0">
                {editing === pk.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      autoFocus
                      className="text-sm border border-[#CBD5E1] rounded-md px-2 py-1 w-56"
                    />
                    <button
                      onClick={() => saveRename(pk.id)}
                      className="p-1.5 text-[#15803D] hover:bg-[#F0FDF4] rounded"
                      aria-label="Save name"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="p-1.5 text-[#64748B] hover:bg-[#F1F5F9] rounded"
                      aria-label="Cancel"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-[#0F172A] truncate">
                      {pk.friendlyName || "Unnamed passkey"}
                    </p>
                    <p className="text-xs text-[#94A3B8]">
                      Added {new Date(pk.createdAt).toLocaleDateString()}
                      {pk.lastUsedAt
                        ? ` · Last used ${new Date(pk.lastUsedAt).toLocaleDateString()}`
                        : " · Never used"}
                    </p>
                  </>
                )}
              </div>
              {editing !== pk.id && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setEditing(pk.id);
                      setEditName(pk.friendlyName ?? "");
                    }}
                    className="p-2 text-[#64748B] hover:bg-[#F1F5F9] rounded-lg"
                    aria-label="Rename"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => revoke(pk.id)}
                    className="p-2 text-[#B91C1C] hover:bg-[#FEF2F2] rounded-lg"
                    aria-label="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <p className="mt-4 text-xs text-[#94A3B8]">
        Each device (this computer, your phone, another laptop) registers its own
        passkey. Passkeys sync automatically within the same Apple or Google
        account. You can&rsquo;t remove your only passkey — add another device first.
      </p>
    </div>
  );
}
