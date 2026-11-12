"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

interface Item {
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  badge?: string | null;
}
interface Group {
  key: string;
  label: string;
  items: Item[];
}

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

/**
 * The top-bar search. It used to be a read-only placeholder. It now searches
 * shops, disputes (order # / dispute id), templates and jobs at once
 * (/api/admin/search), shows the top few per group, and jumps to the match.
 * Keyboard: `/` focuses, Up/Down move, Enter opens, Esc closes.
 */
export function AdminSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const q = value.trim();

  // Debounced query; a late response from an older keystroke is discarded.
  useEffect(() => {
    if (q.length < MIN_CHARS) {
      setGroups([]);
      setError(null);
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const data = (await res.json()) as { groups: Group[] };
        if (mine !== seq.current) return;
        setGroups(data.groups ?? []);
        setActive(0);
        setError(null);
      } catch (e) {
        if (mine !== seq.current) return;
        setGroups([]);
        setError(e instanceof Error ? e.message : "Search failed");
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // "/" focuses the box from anywhere that is not a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const go = useCallback(
    (item: Item) => {
      setOpen(false);
      setValue("");
      router.push(item.href);
    },
    [router],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    } else if (e.key === "ArrowDown" && flat.length > 0) {
      e.preventDefault();
      setActive((a) => (a + 1) % flat.length);
    } else if (e.key === "ArrowUp" && flat.length > 0) {
      e.preventDefault();
      setActive((a) => (a - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter" && flat[active]) {
      e.preventDefault();
      go(flat[active]);
    }
  };

  const showPanel = open && q.length >= MIN_CHARS;
  let index = -1;

  return (
    <div ref={wrapRef} className="relative hidden md:block">
      <div className="flex items-center gap-2 px-3 py-2 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg w-80 focus-within:ring-2 focus-within:ring-[#1D4ED8]">
        <Search className="w-4 h-4 text-[#94A3B8]" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="admin-search-results"
          aria-label="Search shops, disputes, templates and jobs"
          placeholder="Search shops, disputes, templates, jobs...  ( / )"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="flex-1 bg-transparent text-sm text-[#0F172A] placeholder:text-[#94A3B8] outline-none"
        />
      </div>

      {showPanel && (
        <div
          id="admin-search-results"
          role="listbox"
          className="absolute left-0 mt-2 w-[28rem] max-h-[70vh] overflow-auto bg-white border border-[#E2E8F0] rounded-lg shadow-lg z-50"
        >
          {error ? (
            <div role="alert" className="px-4 py-3 text-sm text-[#991B1B]">{error}</div>
          ) : loading && groups.length === 0 ? (
            <div className="px-4 py-3 text-sm text-[#64748B]">Searching...</div>
          ) : groups.length === 0 ? (
            <div className="px-4 py-3 text-sm text-[#64748B]">No matches for &ldquo;{q}&rdquo;.</div>
          ) : (
            groups.map((g) => (
              <div key={g.key}>
                <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">
                  {g.label}
                </div>
                {g.items.map((it) => {
                  index += 1;
                  const i = index;
                  return (
                    <button
                      key={`${g.key}:${it.id}`}
                      type="button"
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(it)}
                      className={`w-full text-left px-4 py-2 flex items-center justify-between gap-3 ${
                        i === active ? "bg-[#EFF6FF]" : "hover:bg-[#F8FAFC]"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-[#0F172A]">{it.title}</span>
                        {it.subtitle && (
                          <span className="block truncate text-xs text-[#94A3B8]">{it.subtitle}</span>
                        )}
                      </span>
                      {it.badge && (
                        <span className="shrink-0 px-2 py-0.5 bg-[#F1F5F9] text-[#475569] text-xs font-medium rounded-full">
                          {it.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
