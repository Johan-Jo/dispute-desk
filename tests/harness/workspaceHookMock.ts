/**
 * Stand-in for `useDisputeWorkspace` in the render harness (single-source plan
 * 3.0.2). It is the real hook minus its network and state: the payload is fixed,
 * `derived` comes from the REAL `deriveWorkspace` with real `useTranslations`
 * translators, and every action is a no-op.
 *
 * Test files install it with
 *   vi.mock("@/app/(embedded)/app/disputes/[id]/hooks/useDisputeWorkspace", async (orig) => ({
 *     ...(await orig<object>()),
 *     useDisputeWorkspace: (await import("../harness/workspaceHookMock")).useDisputeWorkspaceMock,
 *   }));
 */
import { useTranslations } from "next-intl";
import { deriveWorkspace } from "@/app/(embedded)/app/disputes/[id]/hooks/deriveWorkspace";
import type { WorkspaceClientState } from "@/app/(embedded)/app/disputes/[id]/hooks/useDisputeWorkspace";
import type { WorkspaceData } from "@/app/(embedded)/app/disputes/[id]/workspace-components/types";

export type HarnessTab = "overview" | "evidence";
export const TAB_NUMBER: Record<HarnessTab, 0 | 1> = { overview: 0, evidence: 1 };

interface Current {
  data: WorkspaceData;
  tab: HarnessTab;
}
let current: Current | null = null;

export function setHarnessWorkspace(next: Current | null): void {
  current = next;
}

/** `?section=...` for the render in progress (e.g. `cardholder-ack` opens the acknowledgement card). */
let search = new URLSearchParams();
export function setHarnessSearch(params: Record<string, string>): void {
  search = new URLSearchParams(params);
}

export function defaultClientState(tab: HarnessTab): WorkspaceClientState {
  return {
    activeTab: TAB_NUMBER[tab],
    loading: false,
    uploadingField: null,
    failedFields: new Map(),
    completedFields: new Set(),
    uploadSuccessNotice: null,
    focusField: null,
    focusSection: null,
    expandedCategories: new Set(),
    excludedFields: new Set(),
    showOverrideModal: false,
    saving: false,
    rendering: false,
    retrying: false,
    justSubmitted: false,
    pendingRegeneratePrompt: null,
    regenerateSubmitting: false,
    dismissedRebuildOutcomeAt: null,
    regenerateError: null,
  };
}

/** Every `actions.*` is a no-op that resolves; nothing writes anywhere. */
const noopActions = new Proxy(
  {},
  {
    get: () => () => Promise.resolve(undefined),
  },
) as never;

export function useDisputeWorkspaceMock(_disputeId: string) {
  void _disputeId;
  const tSource = useTranslations("disputes.sourceCaption");
  const tWhy = useTranslations("disputes.whyText");
  const tFieldAction = useTranslations("disputes.fieldAction");
  const tWorkspace = useTranslations("disputes.workspaceHook");
  const tRoot = useTranslations();
  if (!current) throw new Error("render harness: no workspace set (call renderDisputePage)");
  const clientState = defaultClientState(current.tab);
  const derived = deriveWorkspace(current.data, clientState, { tSource, tWhy, tFieldAction, tWorkspace, tRoot });
  return { data: current.data, clientState, derived, actions: noopActions };
}

export const navigationMock = {
  useSearchParams: () => search,
  useParams: () => ({ id: "harness" }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, back: () => undefined, prefetch: () => undefined }),
  usePathname: () => "/app/disputes/harness",
};
