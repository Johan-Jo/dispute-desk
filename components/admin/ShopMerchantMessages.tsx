"use client";

/**
 * Admin card: compose and manage in-app messages for one shop.
 *
 * A published message appears as a dismissible banner on that shop's
 * embedded dashboard. With "Ask for contact details" on, the banner
 * carries email/phone inputs and the merchant's answer is emailed to
 * the ops address (ADMIN_NOTIFY_EMAIL) and shown back here.
 *
 * Draft → Publish is deliberate: composing a message doesn't put it in
 * front of a merchant until someone clicks Publish.
 */

import { useCallback, useEffect, useState } from "react";
import { MessageSquare, Send, Trash2, Archive } from "lucide-react";
import type { MerchantMessage } from "@/lib/merchantMessages/types";

const INPUT =
  "w-full py-2.5 px-4 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent";
const LABEL = "block text-sm font-medium text-[#64748B] mb-1";

const TONES = ["critical", "warning", "info", "success"] as const;

export function ShopMerchantMessages({ shopId }: { shopId: string }) {
  const [messages, setMessages] = useState<MerchantMessage[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tone, setTone] = useState<string>("critical");
  const [askForContact, setAskForContact] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/shops/${shopId}/messages`);
      if (!res.ok) return;
      const d = await res.json();
      setMessages(d.messages ?? []);
    } catch {
      /* leaving the list stale is better than blanking the card */
    }
  }, [shopId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (status: "draft" | "published") => {
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/shops/${shopId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, tone, askForContact, status }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not save");
      }
      setTitle("");
      setBody("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, changes: Record<string, unknown>) => {
    setBusy(true);
    try {
      await fetch(`/api/admin/shops/${shopId}/messages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await fetch(`/api/admin/shops/${shopId}/messages/${id}`, {
        method: "DELETE",
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <MessageSquare className="w-5 h-5 text-[#1D4ED8]" />
        <h2 className="text-lg font-semibold text-[#0F172A]">In-app message</h2>
      </div>
      <p className="text-sm text-[#64748B] mb-5">
        Shows as a dismissible banner on this merchant&apos;s dashboard. If you
        ask for contact details, their reply is emailed to you.
      </p>

      <div className="space-y-4 mb-6">
        <div>
          <label className={LABEL}>Title</label>
          <input
            className={INPUT}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="We see strong win potential on your account"
          />
        </div>
        <div>
          <label className={LABEL}>Message</label>
          <textarea
            className={INPUT}
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write in the merchant's language — this text is shown verbatim."
          />
        </div>
        <div className="flex items-end gap-4 flex-wrap">
          <div>
            <label className={LABEL}>Tone</label>
            <select
              className="py-2.5 px-4 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
            >
              {TONES.map((tn) => (
                <option key={tn} value={tn}>
                  {tn}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-[#0F172A] pb-2.5">
            <input
              type="checkbox"
              checked={askForContact}
              onChange={(e) => setAskForContact(e.target.checked)}
            />
            Ask for contact details (email / phone)
          </label>
        </div>
        {error ? <p className="text-sm text-[#DC2626]">{error}</p> : null}
        <div className="flex gap-3">
          <button
            onClick={() => create("published")}
            disabled={busy || !title.trim() || !body.trim()}
            className="px-5 py-2.5 bg-[#1D4ED8] text-white text-sm font-semibold rounded-lg hover:bg-[#1E40AF] transition-colors disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Send className="w-4 h-4" />
            Publish now
          </button>
          <button
            onClick={() => create("draft")}
            disabled={busy || !title.trim() || !body.trim()}
            className="px-5 py-2.5 border border-[#E2E8F0] text-[#0F172A] text-sm font-semibold rounded-lg hover:bg-[#F8FAFC] transition-colors disabled:opacity-50"
          >
            Save draft
          </button>
        </div>
      </div>

      {messages.length > 0 ? (
        <div className="border-t border-[#E2E8F0] pt-5 space-y-3">
          {messages.map((m) => (
            <div
              key={m.id}
              className="border border-[#E2E8F0] rounded-lg p-4 text-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-[#0F172A]">{m.title}</p>
                  <p className="text-[#475569] mt-1 whitespace-pre-wrap">
                    {m.body}
                  </p>
                </div>
                <span className="shrink-0 px-2 py-1 rounded-full text-xs font-medium bg-[#F1F5F9] text-[#475569]">
                  {m.status}
                </span>
              </div>

              {m.respondedAt ? (
                <div className="mt-3 p-3 rounded-lg bg-[#F0FDF4] border border-[#BBF7D0]">
                  <p className="font-medium text-[#166534]">Merchant replied</p>
                  <p className="text-[#166534]">
                    {m.responseEmail ? `Email: ${m.responseEmail}` : null}
                    {m.responseEmail && m.responsePhone ? " · " : null}
                    {m.responsePhone ? `Phone: ${m.responsePhone}` : null}
                  </p>
                </div>
              ) : m.dismissedAt ? (
                <p className="mt-3 text-[#B45309]">Dismissed without replying</p>
              ) : null}

              <div className="flex gap-3 mt-3">
                {m.status !== "published" ? (
                  <button
                    onClick={() => patch(m.id, { status: "published" })}
                    disabled={busy}
                    className="text-[#1D4ED8] font-medium hover:underline disabled:opacity-50"
                  >
                    Publish
                  </button>
                ) : (
                  <button
                    onClick={() => patch(m.id, { status: "archived" })}
                    disabled={busy}
                    className="text-[#64748B] font-medium hover:underline disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    Archive
                  </button>
                )}
                <button
                  onClick={() => remove(m.id)}
                  disabled={busy}
                  className="text-[#DC2626] font-medium hover:underline disabled:opacity-50 inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
