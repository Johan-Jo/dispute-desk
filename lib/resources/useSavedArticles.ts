"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "dd_saved_articles";

/** Stable empty snapshot — `useSyncExternalStore` compares snapshots with `Object.is`; a fresh `[]` each read looks like an endless change. */
const EMPTY_SNAPSHOT: string[] = [];

let cachedRaw: string | null | undefined;
let cachedList: string[] = EMPTY_SNAPSHOT;

function getSnapshot(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === cachedRaw) {
      return cachedList;
    }
    cachedRaw = raw;
    if (!raw) {
      cachedList = EMPTY_SNAPSHOT;
      return cachedList;
    }
    cachedList = JSON.parse(raw) as string[];
    return cachedList;
  } catch {
    cachedRaw = null;
    cachedList = EMPTY_SNAPSHOT;
    return cachedList;
  }
}

function getServerSnapshot(): string[] {
  return EMPTY_SNAPSHOT;
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
  cachedRaw = undefined;
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
