/**
 * Render harness for the dispute page (single-source plan 3.0.2).
 *
 * `renderToStaticMarkup(<WorkspaceShell/>)` inside a next-intl provider (real
 * `en` messages), a Polaris `AppProvider`, with `next/navigation` and the
 * workspace hook mocked by the TEST FILE (see workspaceHookMock.ts) and no-op
 * actions. The component tree, the record builder and the leaf cards are the
 * production ones, so a rendered assertion fails when the page - not a helper -
 * says the wrong thing. Overview or Evidence is selectable.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AppProvider } from "@shopify/polaris";
import polarisEn from "@shopify/polaris/locales/en.json";
import messages from "@/messages/en.json";
import WorkspaceShell from "@/app/(embedded)/app/disputes/[id]/WorkspaceShell";
import type { WorkspaceData } from "@/app/(embedded)/app/disputes/[id]/workspace-components/types";
export { fixtureByCase, loadFixtures, workspaceDataOf, type WorkspaceFixture } from "./fixtures";
import { setHarnessSearch, setHarnessWorkspace, type HarnessTab } from "./workspaceHookMock";

export function renderDisputePage(data: WorkspaceData, tab: HarnessTab, search: Record<string, string> = {}): string {
  setHarnessWorkspace({ data, tab });
  setHarnessSearch(search);
  try {
    return renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={messages as never} timeZone="UTC">
        <AppProvider i18n={polarisEn}>
          <WorkspaceShell disputeId="harness" />
        </AppProvider>
      </NextIntlClientProvider>,
    );
  } finally {
    setHarnessSearch({});
    setHarnessWorkspace(null);
  }
}

/** Visible text of rendered markup: tags dropped, entities decoded, whitespace collapsed. */
export function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** English message text at a dotted key, for asserting what the page must (not) show. */
export function en(key: string): string {
  let cur: unknown = messages;
  for (const seg of key.split(".")) cur = (cur as Record<string, unknown> | undefined)?.[seg];
  if (typeof cur !== "string") throw new Error(`en.json has no string at ${key}`);
  return cur;
}
