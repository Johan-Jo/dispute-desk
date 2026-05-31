"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";

interface ToastState {
  message: string;
  id: number;
}

interface DemoToastContextValue {
  show: (message: string) => void;
}

const DemoToastContext = createContext<DemoToastContextValue | null>(null);

export function DemoToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [nextId, setNextId] = useState(1);

  const show = useCallback((message: string) => {
    setToast({ message, id: nextId });
    setNextId((n) => n + 1);
  }, [nextId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <DemoToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-[#0B1220] text-white text-sm px-4 py-3 rounded-lg shadow-lg max-w-md"
        >
          {toast.message}
        </div>
      )}
    </DemoToastContext.Provider>
  );
}

export function useDemoToast(): DemoToastContextValue {
  const ctx = useContext(DemoToastContext);
  if (!ctx) {
    return { show: () => {} };
  }
  return ctx;
}
