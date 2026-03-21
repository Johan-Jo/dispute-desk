"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/** `?dd_debug=1` on the app URL, or `localStorage.setItem('dd_debug','1')` in the iframe console. */
export function useDdDebug(): boolean {
  const searchParams = useSearchParams();
  const q = searchParams.get("dd_debug") === "1";
  const [ls, setLs] = useState(false);
  useEffect(() => {
    try {
      setLs(localStorage.getItem("dd_debug") === "1");
    } catch {
      setLs(false);
    }
  }, []);
  return q || ls;
}
