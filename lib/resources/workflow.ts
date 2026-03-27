/**
 * Workflow state machine for content_items.workflow_status.
 *
 * Statuses progress roughly left-to-right:
 *   idea → backlog → brief-ready → drafting → in-translation →
 *   in-editorial-review → in-legal-review → approved → scheduled → published → archived
 *
 * Some shortcuts exist (e.g. approved → published skipping scheduled).
 */

export const WORKFLOW_STATUSES = [
  "idea",
  "backlog",
  "brief-ready",
  "drafting",
  "in-translation",
  "in-editorial-review",
  "in-legal-review",
  "approved",
  "scheduled",
  "published",
  "archived",
] as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

/**
 * Allowed transitions keyed by current status.
 * If a transition is not listed here it is invalid.
 */
const TRANSITIONS: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
  idea: ["backlog", "brief-ready", "archived"],
  backlog: ["brief-ready", "idea", "archived"],
  "brief-ready": ["drafting", "backlog", "archived"],
  drafting: ["in-translation", "in-editorial-review", "brief-ready", "archived"],
  "in-translation": ["in-editorial-review", "drafting", "archived"],
  "in-editorial-review": ["in-legal-review", "approved", "drafting", "archived"],
  "in-legal-review": ["approved", "in-editorial-review", "archived"],
  approved: ["scheduled", "published", "in-editorial-review", "archived"],
  scheduled: ["published", "approved", "archived"],
  published: ["archived", "drafting"],
  archived: ["idea", "backlog", "drafting"],
};

export function canTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function getAllowedTransitions(from: WorkflowStatus): readonly WorkflowStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function assertTransition(from: WorkflowStatus, to: WorkflowStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `Invalid workflow transition: "${from}" → "${to}". Allowed from "${from}": ${getAllowedTransitions(from).join(", ") || "none"}`
    );
  }
}

export function isWorkflowStatus(value: unknown): value is WorkflowStatus {
  return typeof value === "string" && WORKFLOW_STATUSES.includes(value as WorkflowStatus);
}

/* ── Display helpers ────────────────────────────────────────────────── */

export interface StatusDisplay {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

const STATUS_DISPLAY: Record<WorkflowStatus, StatusDisplay> = {
  idea: { label: "Idea", color: "#667085", bgColor: "#F6F8FB", borderColor: "#E1E3E5" },
  backlog: { label: "Backlog", color: "#1D4ED8", bgColor: "#EFF6FF", borderColor: "#BFDBFE" },
  "brief-ready": { label: "Brief Ready", color: "#15803D", bgColor: "#F0FDF4", borderColor: "#BBF7D0" },
  drafting: { label: "Draft", color: "#667085", bgColor: "#F6F8FB", borderColor: "#E1E3E5" },
  "in-translation": { label: "In Translation", color: "#1D4ED8", bgColor: "#EFF6FF", borderColor: "#BFDBFE" },
  "in-editorial-review": { label: "In Review", color: "#92400E", bgColor: "#FEF3C7", borderColor: "#FDE68A" },
  "in-legal-review": { label: "Legal Review", color: "#92400E", bgColor: "#FEF3C7", borderColor: "#FDE68A" },
  approved: { label: "Approved", color: "#15803D", bgColor: "#F0FDF4", borderColor: "#BBF7D0" },
  scheduled: { label: "Scheduled", color: "#1D4ED8", bgColor: "#EFF6FF", borderColor: "#BFDBFE" },
  published: { label: "Published", color: "#15803D", bgColor: "#F0FDF4", borderColor: "#BBF7D0" },
  archived: { label: "Archived", color: "#667085", bgColor: "#F6F8FB", borderColor: "#E1E3E5" },
};

export function getStatusDisplay(status: WorkflowStatus): StatusDisplay {
  return STATUS_DISPLAY[status] ?? STATUS_DISPLAY.idea;
}

/* ── Content type helpers ───────────────────────────────────────────── */

export const CONTENT_TYPES = [
  "pillar_page",
  "cluster_article",
  "template",
  "case_study",
  "legal_update",
  "glossary_entry",
  "faq_entry",
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  pillar_page: "Pillar Page",
  cluster_article: "Article",
  template: "Template",
  case_study: "Case Study",
  legal_update: "Legal Update",
  glossary_entry: "Glossary",
  faq_entry: "FAQ",
};

export function getContentTypeLabel(type: ContentType): string {
  return CONTENT_TYPE_LABELS[type] ?? type;
}

/* ── Priority helpers ───────────────────────────────────────────────── */

export type Priority = "high" | "medium" | "low";

export interface PriorityDisplay {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

const PRIORITY_DISPLAY: Record<Priority, PriorityDisplay> = {
  high: { label: "High", color: "#991B1B", bgColor: "#FEE2E2", borderColor: "#FECACA" },
  medium: { label: "Medium", color: "#92400E", bgColor: "#FEF3C7", borderColor: "#FDE68A" },
  low: { label: "Low", color: "#667085", bgColor: "#F6F8FB", borderColor: "#E1E3E5" },
};

export function getPriorityDisplay(priority: Priority): PriorityDisplay {
  return PRIORITY_DISPLAY[priority] ?? PRIORITY_DISPLAY.medium;
}

/* ── Locale helpers (admin context) ─────────────────────────────────── */

export const ADMIN_LOCALES = [
  { code: "en", dbLocale: "en-US", label: "English", flag: "🇬🇧", nativeName: "English" },
  { code: "de", dbLocale: "de-DE", label: "Deutsch", flag: "🇩🇪", nativeName: "Deutsch" },
  { code: "fr", dbLocale: "fr-FR", label: "Français", flag: "🇫🇷", nativeName: "Français" },
  { code: "es", dbLocale: "es-ES", label: "Español", flag: "🇪🇸", nativeName: "Español" },
  { code: "pt", dbLocale: "pt-PT", label: "Português", flag: "🇵🇹", nativeName: "Português" },
  { code: "sv", dbLocale: "sv-SE", label: "Svenska", flag: "🇸🇪", nativeName: "Svenska" },
] as const;

export function getLocaleFlag(code: string): string {
  const locale = ADMIN_LOCALES.find((l) => l.code === code || l.dbLocale === code);
  return locale?.flag ?? "🌐";
}
