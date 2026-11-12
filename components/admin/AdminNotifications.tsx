"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

interface Item {
  key: string;
  label: string;
  count: number;
  href: string;
}

const REFRESH_MS = 60_000;

/**
 * The top-bar bell. It used to be a decorative button with a hard-coded red dot:
 * clicking did nothing and the dot was always on. It now shows the live count of
 * things that need an operator (see /api/admin/notifications) and opens a list
 * linking to where each is handled. The dot/badge appears only when the count is
 * above zero.
 */
export function AdminNotifications() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/notifications");
      if (!res.ok) throw new Error(`Could not load alerts (${res.status})`);
      const data = (await res.json()) as { total: number; items: Item[] };
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load alerts");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={total > 0 ? `Alerts: ${total} need attention` : "Alerts"}
        onClick={() => {
          setOpen((o) => !o);
          if (!open) load();
        }}
        className="relative p-2 text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] rounded-lg transition-colors"
      >
        <Bell className="w-5 h-5" />
        {total > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-[#EF4444] text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-72 bg-white border border-[#E2E8F0] rounded-lg shadow-lg z-50"
        >
          <div className="px-4 py-3 border-b border-[#E2E8F0] text-sm font-semibold text-[#0F172A]">
            Needs attention
          </div>
          {error ? (
            <div role="alert" className="px-4 py-3 text-sm text-[#991B1B]">{error}</div>
          ) : !loaded ? (
            <div className="px-4 py-3 text-sm text-[#64748B]">Loading…</div>
          ) : items.length === 0 ? (
            <div className="px-4 py-3 text-sm text-[#64748B]">Nothing needs attention.</div>
          ) : (
            <ul className="py-1">
              {items.map((i) => (
                <li key={i.key}>
                  <Link
                    href={i.href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between px-4 py-2 text-sm text-[#0F172A] hover:bg-[#F8FAFC]"
                  >
                    <span>{i.label}</span>
                    <span className="ml-3 px-2 py-0.5 bg-[#FEF2F2] text-[#B91C1C] text-xs font-semibold rounded-full">
                      {i.count}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
