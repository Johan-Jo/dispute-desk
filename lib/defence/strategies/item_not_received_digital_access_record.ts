/**
 * Strategy: digital access record (item_not_received family).
 *
 * Selected when an approved digital_access_log / service_access fact
 * shows the customer actually USED the service. Frames the
 * representment around recorded access events.
 */

import type { StrategySubmodule } from "../types";

export const item_not_received_digital_access_record: StrategySubmodule = {
  key: "item_not_received_digital_access_record",
  familyKey: "item_not_received",
  displayName: "Digital access record",
  predicates: { any: ["digital_access_used", "service_delivered"] },
  isFallback: false,
  priority: 20,
  promptBody: [
    "STRATEGY FOCUS — digital access record:",
    "Build the fulfillmentArgument around the recorded access events. Cite lastAccessAt when present.",
    "Distinguish 'access granted' (digitalAccessGranted=true) from 'access used' (digitalAccessUsed=true) — only claim the one supported by the approved fact.",
    "Never imply the customer accessed the service if only digitalAccessGranted is true; granted access is not the same as used access.",
  ].join("\n"),
  version: 1,
};
