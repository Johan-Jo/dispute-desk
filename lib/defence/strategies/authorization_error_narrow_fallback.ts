import type { StrategySubmodule } from "../types";

export const authorization_error_narrow_fallback: StrategySubmodule = {
  key: "authorization_error_narrow_fallback",
  familyKey: "authorization_error",
  displayName: "Narrow fallback",
  predicates: {},
  isFallback: true,
  priority: 0,
  promptBody: [
    "STRATEGY FOCUS — narrow fallback (authorization_error family):",
    "Authorization-error disputes (no auth, declined auth, expired auth) hinge on the captured authorization record. Cite auth ids, timestamps, and outcome (approved/declined) from the approved order/payment facts.",
    "Never assert an authorisation occurred unless an approved fact carries the auth id and approval outcome.",
  ].join("\n"),
  version: 1,
};
