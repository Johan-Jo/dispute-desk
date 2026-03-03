"use client";

import { useEffect, useRef } from "react";
import type { StepId } from "./types";

/**
 * Marks a setup step as done when the portal page mounts.
 * Fires once per mount; no-ops if the step is already done.
 */
export function useCompleteSetupStep(stepId: StepId) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    fetch("/api/setup/step", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ stepId }),
    }).catch(() => {});
  }, [stepId]);
}
