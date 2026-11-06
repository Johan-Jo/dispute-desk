/**
 * The dispute account, RENDERED (design: Claude Design project fca59ec9…,
 * "Return Record Banner Design"; consistency table).
 *
 * WHY A RENDER TEST. The lib test proves the record's sentences; this proves
 * the components READ them. It renders the real decided workspace and the real
 * Evidence / Review bodies through the real providers for the design's states
 * A, B, C and E and asserts, on the MARKUP, that every fact sentence appears
 * word for word wherever the design says it is used, and that the old
 * contradictory surfaces (the blue "return received" banner, the unqualified
 * "positive argument" group, a strength verdict on a response never filed) are
 * gone.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("shop=x.myshopify.com"),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/app/disputes/x",
}));
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { AppProvider } from "@shopify/polaris";
import polarisEn from "@shopify/polaris/locales/en.json";
import messages from "@/messages/en.json";
import { resolveToken } from "@/lib/i18n/resolveToken";
import { buildDisputeAccount, type AccountFormat, type AccountInputs } from "@/lib/disputes/disputeAccount";
import { buildAccountPage, type AccountEvidenceRowInput } from "@/lib/disputes/accountPage";
import type { DecidedViewInputs } from "@/lib/disputes/decidedView";
import { AccountContext } from "@/app/(embedded)/app/disputes/[id]/workspace-components/AccountContext";
import { AccountHero } from "@/app/(embedded)/app/disputes/[id]/workspace-components/AccountHero";
import {
  AccountEvidenceBody,
  AccountReviewBody,
} from "@/app/(embedded)/app/disputes/[id]/workspace-components/AccountPanels";
import DecidedWorkspace from "@/app/(embedded)/app/disputes/[id]/DecidedWorkspace";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt: AccountFormat = {
  date: (iso) => {
    const d = new Date(iso);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  },
  money: (a) => `${a.toFixed(2).replace(".", ",")} kr`,
};
const tr = createTranslator({ locale: "en", messages }) as never;
const say = (tok: Parameters<typeof resolveToken>[1]) => resolveToken(tr, tok) as string;

const decode = (html: string) =>
  html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const sit = (returns: "returned" | "in_progress" | "none", opened: string | null) => ({
  returns,
  refund: "none" as const,
  returnOpenedAt: opened,
  asOf: "2026-11-05T09:00:00Z",
});
const stmt = (o: Record<string, unknown>) => ({ asOf: "2026-11-05T09:00:00Z", zeroCurrency: "SEK", ...o }) as never;

const common = {
  currency: "SEK",
  dueAt: null,
  filedAt: null,
  sentAt: null,
  deliveryConfirmed: false,
  order: null,
  pack: { built: true, savedAt: null, forwarded: false, hasTracking: true },
} as const;
const A: AccountInputs = {
  ...common,
  reason: "CREDIT_NOT_PROCESSED",
  lifecycle: "won",
  amount: 618,
  openedAt: "2026-11-04T10:15:00Z",
  closedAt: "2026-11-04T14:38:00Z",
  responder: "none",
  situation: sit("returned", "2026-10-27T09:00:00Z"),
  refund: stmt({ kind: "recorded_no_amount", entryCount: 1 }),
  deliveryConfirmed: true,
};
const B: AccountInputs = {
  ...common,
  reason: "CREDIT_NOT_PROCESSED",
  lifecycle: "won",
  amount: 899,
  openedAt: "2026-11-01T08:00:00Z",
  closedAt: "2026-11-04T09:00:00Z",
  responder: "none",
  situation: sit("in_progress", null),
  refund: stmt({ kind: "none" }),
};
const C: AccountInputs = {
  ...common,
  reason: "CREDIT_NOT_PROCESSED",
  lifecycle: "won",
  amount: 1148,
  openedAt: "2026-10-30T08:00:00Z",
  closedAt: "2026-10-30T15:00:00Z",
  responder: "none",
  situation: sit("none", null),
  refund: stmt({ kind: "recorded_no_amount", entryCount: 1, entryAt: "2026-10-29T12:00:00Z" }),
  pack: { built: true, savedAt: null, forwarded: false, hasTracking: false },
};
const E: AccountInputs = {
  ...common,
  reason: "PRODUCT_NOT_RECEIVED",
  lifecycle: "open",
  openStage: "response_needed",
  amount: 618,
  openedAt: "2026-11-02T08:00:00Z",
  dueAt: "2026-11-20T23:00:00Z",
  closedAt: null,
  responder: null,
  situation: null,
  refund: null,
  pack: { built: false, savedAt: null, forwarded: false, hasTracking: null },
};

const rows: AccountEvidenceRowInput[] = [
  { field: "refund_policy", title: "Refund policy", positive: true, inPackage: true },
  { field: "shipping_tracking", title: "Shipping tracking", positive: false, inPackage: true },
  { field: "refund_record", title: "Refund record", positive: false, inPackage: true },
];

function vmFor(i: AccountInputs, missing = [{ field: "refund_record", title: "Refund record", whyItMatters: "w" }]) {
  const account = buildDisputeAccount(i, fmt);
  const page = buildAccountPage(account, { evidenceRows: rows, missing, hasRefundChecklistRow: true });
  return { account, page, fmt };
}

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <AppProvider i18n={polarisEn}>{children}</AppProvider>
    </NextIntlClientProvider>
  );
}

const html = (node: React.ReactNode) => decode(renderToStaticMarkup(<Providers>{node}</Providers>));

function decidedInputs(i: AccountInputs): DecidedViewInputs {
  return {
    outcome: "won",
    phase: "inquiry",
    reason: i.reason,
    amount: i.amount,
    currency: i.currency,
    openedAt: i.openedAt,
    dueAt: null,
    closedAt: i.closedAt,
    response: { responder: "none", filedAt: null, sentAt: null, closedAt: i.closedAt, decidedBeforeDeadline: false, holdReason: null },
    order: null,
    lineItems: [],
    facts: { refund_policy: { fieldsProvided: ["refund_policy"] }, customer_communication: {} },
    fatalLossReason: null,
    firstPackAt: "2026-11-04T10:20:00Z",
    events: [],
    inapplicable: [],
  };
}

function decidedPage(i: AccountInputs, tab: number) {
  const vm = vmFor(i);
  const dispute = {
    id: "00000000-0000-0000-0000-000000000000",
    reason: i.reason,
    phase: "inquiry",
    amount: i.amount,
    currency: "SEK",
    orderName: "#24612",
    customerName: "",
    openedAt: i.openedAt,
  } as never;
  return html(
    <AccountContext.Provider value={vm}>
      <DecidedWorkspace
        dispute={dispute}
        inputs={decidedInputs(i)}
        reasonLabel="Refund / Credit Not Processed"
        backUrl="/app/disputes"
        orderUrl={null}
        shopifyAdminUrl={null}
        tabs={[
          { id: "overview", label: "Overview", panelId: "o" },
          { id: "evidence", label: "Evidence", panelId: "e" },
          { id: "submit", label: "Review and Forward", panelId: "s" },
        ]}
        activeTab={tab}
        onTabChange={() => {}}
        renderTab={() => <div data-testid="tab-body">TAB-BODY</div>}
      />
    </AccountContext.Provider>,
  );
}

describe("the account in the rendered decided workspace", () => {
  for (const [name, i] of [["A", A], ["B", B], ["C", C]] as const) {
    it(`${name}: Overview opens with the account, and every fact reads the same sentence`, () => {
      const vm = vmFor(i);
      const out = decidedPage(i, 0);
      const paragraph = vm.account.sequence.map((k) => say(vm.account.facts[k]!)).join(" ");
      expect(out).toContain(paragraph);
      // The old duplicate blue banner and its wording are gone.
      expect(out).not.toContain(messages.disputes.overviewExtra.orderSituation.title.returned);
      expect(out).not.toContain(messages.disputes.overviewExtra.orderSituation.title.in_progress);
      // "What we saw": the same sentences again, word for word.
      for (const k of ["ret", "refund"] as const) {
        const s = vm.account.facts[k];
        if (s) expect(out.split(say(s)).length - 1).toBeGreaterThanOrEqual(2); // account + What we saw (+ timeline/pill)
      }
      // The merchant-only note and the as-recorded line.
      expect(out).toContain("This note is for you only. It is not part of anything sent to the bank.");
      expect(out).toContain("As recorded in Shopify when DisputeDesk last collected this order, on");
      // Heading and amount tile.
      expect(out).toContain("Dispute won");
      expect(out).toContain("Recovered");
      expect(out).toContain("Final · the money is yours");
    });
  }

  it("A: refund pill says 'No confirmed amount', the timeline carries the return step", () => {
    const out = decidedPage(A, 0);
    expect(out).toContain("No confirmed amount");
    expect(out).toContain("Return created");
    expect(out).toContain("Decided in your favour");
  });

  it("B: 'No refund recorded' pill; no return-created step (no date on record)", () => {
    const out = decidedPage(B, 0);
    expect(out).toContain("No refund recorded");
    expect(out).not.toContain("Return created");
  });

  it("C: no return text anywhere on the page", () => {
    const out = decidedPage(C, 0);
    expect(out).not.toMatch(/A return on this order|return received|No return initiated/i);
  });

  it("Evidence and Review tabs open with the SAME account (hero at 18px)", () => {
    const vm = vmFor(A);
    const paragraph = vm.account.sequence.map((k) => say(vm.account.facts[k]!)).join(" ");
    expect(decidedPage(A, 1)).toContain(paragraph);
    expect(decidedPage(A, 2)).toContain(paragraph);
    expect(decidedPage(A, 1)).toContain("TAB-BODY");
  });

  it("the Customer fact is shown only when the record has a name", () => {
    // B has no customer name: the strip goes Amount -> Date filed (design).
    expect(decidedPage(B, 0)).toMatch(/Amount 899,00 kr Date filed/);
  });
});

describe("Evidence and Review bodies", () => {
  it("nothing filed: 'In the evidence pack' with the caption; never 'positive argument'", () => {
    const vm = vmFor(B);
    const ev = html(<AccountEvidenceBody page={vm.page} />);
    const rv = html(<AccountReviewBody page={vm.page} />);
    for (const out of [ev, rv]) {
      expect(out).toContain("In the evidence pack");
      expect(out).toContain("The pack was built but not filed, so no item was given a role in a response.");
      expect(out).not.toContain("Used as positive bank argument");
      expect(out).not.toContain("Cited in the PDF as decisive proof.");
    }
    expect(rv).toContain("Not filed");
    // Explainer and pack line are the one 'filed' sentence.
    const filed = say(vm.account.facts.filed!);
    expect(ev).toContain(filed);
    expect(rv).toContain(filed);
    expect(rv).toContain("Complete Defence Package");
    expect(rv).toContain("Inclusion review");
  });

  it("Missing or weak: the refund and tracking rows read the record's sentences", () => {
    const vm = vmFor(C, [
      { field: "refund_record", title: "Refund record", whyItMatters: "w" },
      { field: "shipping_tracking", title: "Shipping tracking", whyItMatters: "w" },
    ]);
    const ev = html(<AccountEvidenceBody page={vm.page} />);
    expect(ev).toContain(`Refund record: ${say(vm.account.facts.refund!)} This is information in Shopify, not a file you can add.`);
    expect(ev).toContain(say(vm.account.facts.tracking!));
  });

  it("DisputeDesk filed: positive and context groups, rows described by the same facts", () => {
    const vm = vmFor({ ...A, responder: "we", filedAt: "2026-11-02T10:00:00Z" });
    const ev = html(<AccountEvidenceBody page={vm.page} />);
    expect(ev).toContain("Used as positive bank argument");
    expect(ev).toContain("Context only");
    expect(ev).toContain(say(vm.account.facts.refund!));
    expect(ev).not.toContain("The pack was built but not filed");
  });
});

describe("the open hero (state E)", () => {
  it("renders the open theme, chip, amount label and the account", () => {
    const vm = vmFor(E);
    const out = html(<AccountHero vm={vm} size={22} />);
    expect(out).toContain("Response needed");
    expect(out).toContain("Open · response due 20 Nov 2026");
    expect(out).toContain("Amount in dispute");
    expect(out).toContain(
      "The customer told their bank the order never arrived. The dispute opened on 2 Nov 2026. A response is due by 20 Nov 2026. No evidence pack has been built yet, and nothing has been saved to Shopify.",
    );
    expect(out).not.toContain("As recorded in Shopify"); // no return/refund record, no as-of line
  });
});
