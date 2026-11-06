/**
 * The page model of the dispute account: everything a tab shows that is a
 * FACT about the dispute, read from ONE `DisputeAccount` through the design's
 * `use(key, where)`.
 *
 * Spec: `DecidedWorkspaceMock.dc.html` `renderVals()` — hero account, "What we
 * saw", the checklist pill, the timeline lines, the evidence rows, the missing
 * rows, the explainer and the pack line. The model returns tokens, never
 * strings; the consistency table is `reader.uses()`.
 *
 * Pure and merchant-side only (no English, nothing bank-facing).
 */

import type { I18nToken } from "@/lib/i18n/token";
import { createFactReader, type DisputeAccount, type FactKey, type FactReader } from "@/lib/disputes/disputeAccount";

const NS = "disputes.account";
const tk = (key: string, params?: I18nToken["params"]): I18nToken => ({
  key: `${NS}.${key}`,
  ...(params ? { params } : {}),
});

export type AccountTheme = "won" | "lost" | "open";
export type EvidenceGroupKind = "positive" | "context" | "pack";

export interface AccountEvidenceRowInput {
  field: string;
  /** Already-localized row title (the Evidence tab's own label). */
  title: string;
  /** Used as a decisive argument in a filed response. */
  positive: boolean;
  /** Part of the defence package at all. */
  inPackage: boolean;
}

export interface AccountMissingInput {
  field: string;
  /** Already-localized title / explanation of an existing missing row. */
  title: string;
  whyItMatters: string;
}

export interface AccountEvidenceRow {
  field: string;
  title: string;
  desc: I18nToken | null;
}

export interface AccountEvidenceGroup {
  kind: EvidenceGroupKind;
  rows: AccountEvidenceRow[];
}

export type AccountMissingRow =
  | { kind: "fact"; field: string; prefix: I18nToken | null; fact: I18nToken; suffix: I18nToken | null }
  | { kind: "plain"; field: string; title: string; why: string };

export type AccountStepTone = "done" | "info" | "won" | "lost" | "pending";

export interface AccountStep {
  /** ISO date, or null for the open case's "Now" step. */
  at: string | null;
  title: I18nToken;
  line: I18nToken;
  tone: AccountStepTone;
  /** Which existing decided-timeline step this one replaces, if any. */
  replaces?: "opened" | "outcome" | "gathered";
}

export interface AccountPage {
  theme: AccountTheme;
  hero: {
    title: I18nToken;
    chip: I18nToken;
    amountLabel: I18nToken;
    account: I18nToken[];
    asOf: string | null;
    privateNote: I18nToken;
  };
  /** "What we saw in the record": the return, the refund, the carrier. */
  seen: Array<{ key: FactKey; token: I18nToken; source: I18nToken }>;
  /** The checklist row "Refund record, or why no refund was due" pill. */
  refundPill: { label: I18nToken; fact: I18nToken } | null;
  steps: AccountStep[];
  stepsTitle: I18nToken;
  evidence: {
    explainer: I18nToken | null;
    groups: AccountEvidenceGroup[];
    missing: AccountMissingRow[];
  };
  review: { packLine: I18nToken | null; groups: AccountEvidenceGroup[] };
  /** Where each fact is used — the design's consistency table. */
  reader: FactReader;
}

/** Evidence field -> the fact whose sentence is the row's description. */
const ROW_FACT: Record<string, FactKey> = {
  refund_record: "refund",
  shipping_tracking: "delivery",
  delivery_proof: "delivery",
  order_confirmation: "order",
};

export function groupsFor(
  account: DisputeAccount,
  rows: AccountEvidenceRowInput[],
  reader: FactReader,
  where: string,
): AccountEvidenceGroup[] {
  const mk = (r: AccountEvidenceRowInput, describe: boolean): AccountEvidenceRow => {
    const fact = describe ? ROW_FACT[r.field] : undefined;
    return {
      field: r.field,
      title: r.title,
      desc: fact ? reader.use(fact, `${where} · ${r.title} row`) : null,
    };
  };
  const inPackage = rows.filter((r) => r.inPackage);
  if (inPackage.length === 0) return [];
  // Nothing filed by DisputeDesk: no row was given a role in a response, so
  // there is no "positive argument" and no "context" — only what the pack holds.
  if (account.filedNothing) {
    return [{ kind: "pack", rows: inPackage.map((r) => mk(r, false)) }];
  }
  const groups: AccountEvidenceGroup[] = [];
  const positive = inPackage.filter((r) => r.positive);
  const context = inPackage.filter((r) => !r.positive);
  if (positive.length > 0) groups.push({ kind: "positive", rows: positive.map((r) => mk(r, true)) });
  if (context.length > 0) groups.push({ kind: "context", rows: context.map((r) => mk(r, true)) });
  return groups;
}

export function buildAccountPage(
  account: DisputeAccount,
  opts: {
    evidenceRows: AccountEvidenceRowInput[];
    missing: AccountMissingInput[];
    /** Whether the viewer's refund-record checklist row exists on the page. */
    hasRefundChecklistRow: boolean;
  },
): AccountPage {
  const reader = createFactReader(account);
  const decided = account.lifecycle !== "open";
  const won = account.lifecycle === "won";
  const theme: AccountTheme = account.lifecycle;
  const i = account.inputs;

  const accountTokens = account.sequence
    .map((k) => reader.use(k, "Account (all three tabs)"))
    .filter((x): x is I18nToken => x !== null);

  const title = decided
    ? { key: `disputes.decidedView.outcome.${won ? "titleWon" : "titleLost"}` }
    : tk(`open.title.${account.openStage}`);
  const chip: I18nToken = decided
    ? { key: `disputes.decidedView.hero.${won ? "chipWon" : "chipLost"}` }
    : account.openStage === "response_needed"
      ? i.dueAt
        ? tk("open.chip.due", { date: dateOf(account, "due") })
        : tk("open.chip.open")
      : tk("open.chip.waiting");
  const amountLabel: I18nToken = decided
    ? { key: `disputes.decidedView.outcome.${won ? "amountRecovered" : "amountLost"}` }
    : tk("open.amountLabel");

  // "What we saw in the record" — design: ret, refund, delivery, in that order.
  const seen: AccountPage["seen"] = [];
  if (decided) {
    for (const key of ["ret", "refund", "delivery"] as const) {
      const token = reader.use(key, "Overview · What we saw");
      if (token) {
        seen.push({
          key,
          token,
          source: { key: `disputes.decidedView.facts.source.${key === "delivery" ? "carrier" : "order"}` },
        });
      }
    }
  }

  let refundPill: AccountPage["refundPill"] = null;
  if (decided && opts.hasRefundChecklistRow && account.refundKind && account.refundKind !== "unknown") {
    const fact = reader.use("refund", "Overview · checklist pill");
    if (fact) {
      refundPill = {
        fact,
        label: {
          key: `disputes.refundStatement.pill.${account.refundKind === "none" ? "none" : account.refundKind === "some" ? "some" : "recordedNoAmount"}`,
        },
      };
    }
  }

  // Timeline: the account's own steps (return, refund entry, opening, decision).
  const steps: AccountStep[] = [];
  const line = (k: FactKey, at: string): I18nToken | null => reader.use(k, `Overview · ${decided ? "What happened" : "What happens now"}, ${at}`);
  if (decided) {
    const retAt = i.situation?.returnOpenedAt ?? null;
    const retLine = retAt ? line("ret", "Return created") : null;
    if (retAt && retLine) steps.push({ at: retAt, title: tk("step.returnCreated"), line: retLine, tone: "info" });
    const entryAt = i.refund?.kind === "recorded_no_amount" ? i.refund.entryAt ?? null : null;
    const refundLine = entryAt ? line("refund", "Refund entry recorded") : null;
    if (entryAt && refundLine) steps.push({ at: entryAt, title: tk("step.refundEntry"), line: refundLine, tone: "info" });
    const opened = i.openedAt ? line("claim", "Dispute opened") : null;
    if (i.openedAt && opened) steps.push({ at: i.openedAt, title: tk("step.opened"), line: opened, tone: "done", replaces: "opened" });
    const outcome = i.closedAt ? line("outcome", `Decided${won ? " in your favour" : " against you"}`) : null;
    if (i.closedAt && outcome) {
      steps.push({
        at: i.closedAt,
        title: tk(won ? "step.decidedWon" : "step.decidedLost"),
        line: outcome,
        tone: won ? "won" : "lost",
        replaces: "outcome",
      });
    }
  } else {
    if (i.openedAt) {
      const l = line("claim", "Dispute opened");
      if (l) steps.push({ at: i.openedAt, title: tk("step.opened"), line: l, tone: "done" });
    }
    const packLine = line("pack", "Evidence pack");
    if (packLine) steps.push({ at: null, title: tk("step.pack"), line: packLine, tone: "info" });
    if (i.dueAt) {
      const l = line("due", "Response due");
      if (l) steps.push({ at: i.dueAt, title: tk("step.due"), line: l, tone: "pending" });
    }
  }

  // Evidence tab: explainer, groups, missing.
  const explainer = decided ? reader.use("filed", "Evidence · explainer") : reader.use("pack", "Evidence · explainer");
  const groups = decided ? groupsFor(account, opts.evidenceRows, reader, "Evidence and Review") : [];
  const missing: AccountMissingRow[] = [];
  if (decided) {
    for (const m of opts.missing) {
      if (m.field === "refund_record") {
        const f = reader.use("refund", "Evidence · Missing or weak");
        if (f) {
          missing.push({ kind: "fact", field: m.field, prefix: tk("missing.refundRecordPrefix"), fact: f, suffix: tk("missing.notAFile") });
          continue;
        }
      }
      if ((m.field === "shipping_tracking" || m.field === "delivery_proof") && account.facts.tracking) {
        const f = reader.use("tracking", "Evidence · Missing or weak");
        if (f) {
          missing.push({ kind: "fact", field: m.field, prefix: null, fact: f, suffix: null });
          continue;
        }
      }
      missing.push({ kind: "plain", field: m.field, title: m.title, why: m.whyItMatters });
    }
    // The tracking fact is a record fact even when the checklist has no row for it.
    if (account.facts.tracking && !missing.some((m) => m.kind === "fact" && m.fact === account.facts.tracking)) {
      const f = reader.use("tracking", "Evidence · Missing or weak");
      if (f) missing.push({ kind: "fact", field: "shipping_tracking", prefix: null, fact: f, suffix: null });
    }
  }

  // Review tab: the pack line and the inclusion groups (same rows as Evidence).
  const packLine = decided ? reader.use("filed", "Review · Complete Defence Package") : reader.use("pack", "Review · Complete Defence Package");
  const reviewGroups = decided ? groupsFor(account, opts.evidenceRows, reader, "Evidence and Review") : [];

  return {
    theme,
    hero: {
      title,
      chip,
      amountLabel,
      account: accountTokens,
      asOf: account.asOf,
      privateNote: { key: "disputes.overviewExtra.orderSituation.privateNote" },
    },
    seen,
    refundPill,
    steps,
    stepsTitle: decided ? { key: "disputes.decidedView.timeline.title" } : tk("step.titleOpen"),
    evidence: { explainer, groups, missing },
    review: { packLine, groups: reviewGroups },
    reader,
  };
}

function dateOf(account: DisputeAccount, key: "due"): string {
  // The due token carries the formatted date as its param.
  const p = account.facts[key]?.params?.date;
  return typeof p === "string" ? p : "";
}
