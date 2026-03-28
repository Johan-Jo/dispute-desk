"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "dd_saved_articles";

function getSnapshot(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function getServerSnapshot(): string[] {
  return [];
}

let listeners: Array<() => void> = [];

function emitChange() {
  for (const fn of listeners) fn();
}

function subscribe(cb: () => void) {
  listeners = [...listeners, cb];
  return () => {
    listeners = listeners.filter((fn) => fn !== cb);
  };
}

function persist(slugs: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slugs));
  } catch {
    /* quota exceeded – silent */
  }
  emitChange();
}

export function useSavedArticles() {
  const saved = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const isSaved = useCallback(
    (slug: string) => saved.includes(slug),
    [saved],
  );

  const toggle = useCallback(
    (slug: string): boolean => {
      const current = getSnapshot();
      const exists = current.includes(slug);
      const next = exists
        ? current.filter((s) => s !== slug)
        : [...current, slug];
      persist(next);
      return !exists;
    },
    [],
  );

  return { saved, isSaved, toggle } as const;
}
