/** Same-origin debug sink for embedded HTTPS app (no localhost / mixed content). */
export function agentLogClient(payload: {
  hypothesisId: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
}): void {
  // #region agent log
  fetch("/api/debug/agent-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "0d3fe7",
      hypothesisId: payload.hypothesisId,
      location: payload.location,
      message: payload.message,
      data: payload.data ?? {},
      timestamp: Date.now(),
    }),
    credentials: "same-origin",
  }).catch(() => {});
  // #endregion
}
