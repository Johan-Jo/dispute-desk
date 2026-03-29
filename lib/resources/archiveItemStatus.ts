/**
 * `content_archive_items.status` uses snake_case (`brief_ready`).
 * Content workflow (`content_items.workflow_status`) uses kebab-case (`brief-ready`).
 * Do not feed archive statuses into `getStatusDisplay` / WorkflowStatusBadge without mapping.
 */

import type { StatusDisplay } from "@/lib/resources/workflow";
import { getStatusDisplay } from "@/lib/resources/workflow";

export function getArchiveItemStatusDisplay(status: string): StatusDisplay {
  switch (status) {
    case "idea":
      return getStatusDisplay("idea");
    case "backlog":
      return getStatusDisplay("backlog");
    case "brief_ready":
      return getStatusDisplay("brief-ready");
    case "converted":
      return {
        label: "Converted",
        color: "#15803D",
        bgColor: "#F0FDF4",
        borderColor: "#BBF7D0",
      };
    default:
      return {
        label: status?.trim() ? status : "Unknown",
        color: "#991B1B",
        bgColor: "#FEF2F2",
        borderColor: "#FECACA",
      };
  }
}
