"use client";

/**
 * The dispute account for the workspace: ONE record of facts per dispute,
 * built from the workspace data the three tabs already share, and the page
 * model every tab reads (lib/disputes/disputeAccount.ts + accountPage.ts).
 *
 * Read-time only and merchant-side: nothing here writes, and nothing here is
 * bank-facing.
 */

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CANONICAL_EVIDENCE } from "@/lib/argument/canonicalEvidence";
import { resolveReasonFamily } from "@/lib/argument/reasonFamily";
import { deliveryConfirmedFromFacts } from "@/lib/disputes/decidedView";
import {
  buildDisputeAccount,
  type AccountFormat,
  type AccountInputs,
  type DisputeAccount,
} from "@/lib/disputes/disputeAccount";
import {
  buildAccountPage,
  type AccountEvidenceRowInput,
  type AccountPage,
} from "@/lib/disputes/accountPage";
import type { useDisputeWorkspace } from "./useDisputeWorkspace";
import { useEvidenceSections } from "../tabs/useEvidenceSections";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

export interface DisputeAccountVm {
  account: DisputeAccount;
  page: AccountPage;
  fmt: AccountFormat;
}

const DELIVERY_FIELDS = new Set(["shipping_tracking", "delivery_proof"]);

export function useDisputeAccount(workspace: Workspace): DisputeAccountVm | null {
  const locale = useLocale();
  const tRoot = useTranslations();
  const sections = useEvidenceSections(workspace);
  const { data, derived } = workspace;

  return useMemo(() => {
    if (!data) return null;
    const d = data.dispute;
    const decidedView = data.decidedView ?? null;

    const fmt: AccountFormat = {
      date: (iso) => {
        try {
          return new Date(iso).toLocaleDateString(locale || undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          });
        } catch {
          return iso.slice(0, 10);
        }
      },
      money: (amount, currency) => {
        try {
          return new Intl.NumberFormat(locale || undefined, { style: "currency", currency }).format(amount);
        } catch {
          return `${currency} ${Number.isFinite(amount) ? amount.toFixed(2) : amount}`;
        }
      },
    };

    const pack = data.pack ?? null;
    const lifecycle = decidedView ? decidedView.outcome : "open";
    const presentationLifecycle = data.presentation?.lifecycle ?? null;
    const forwarded =
      presentationLifecycle === "under_review" || d.submissionState === "submitted_confirmed";
    const hasTracking = pack
      ? pack.evidenceItems.some((it) => {
          const f = (it.payload as { fieldsProvided?: unknown } | null)?.fieldsProvided;
          return Array.isArray(f) && f.some((x) => typeof x === "string" && DELIVERY_FIELDS.has(x));
        })
      : null;
    const building = derived.isBuilding === true || derived.isFailed === true;

    const inputs: AccountInputs = {
      reason: d.reason ?? null,
      lifecycle,
      openStage:
        presentationLifecycle === "under_review"
          ? "under_review"
          : presentationLifecycle === "saved_to_shopify"
            ? "saved_to_shopify"
            : "response_needed",
      amount: decidedView ? decidedView.amount : Number(d.amount),
      currency: decidedView ? decidedView.currency : d.currency,
      openedAt: d.openedAt ?? null,
      dueAt: d.dueAt ?? null,
      closedAt: decidedView ? decidedView.closedAt : null,
      responder: decidedView?.response?.responder ?? null,
      filedAt: decidedView?.response?.filedAt ?? null,
      sentAt: decidedView?.response?.sentAt ?? null,
      situation: d.orderSituation ?? null,
      refund: d.refundStatement ?? null,
      deliveryConfirmed: decidedView ? deliveryConfirmedFromFacts(decidedView.facts) : false,
      order: d.orderTotal
        ? { total: d.orderTotal.amount, currency: d.orderTotal.currency, card: d.paymentFamily === "card" }
        : null,
      pack:
        building && !pack
          ? null
          : pack
            ? { built: !building, savedAt: pack.savedToShopifyAt ?? null, forwarded, hasTracking }
            : { built: false, savedAt: null, forwarded: false, hasTracking: null },
    };

    const account = buildDisputeAccount(inputs, fmt);

    // The evidence rows: the same bucketing the Evidence tab uses
    // (positive = relied on, in package = anywhere in the package), titled by
    // the Evidence tab's own labels.
    const fieldLabel = (field: string, legacy: string): string => {
      const labelKey = CANONICAL_EVIDENCE[field]?.labelKey;
      if (!labelKey) return legacy;
      try {
        const resolved = tRoot(labelKey);
        return resolved === labelKey ? legacy : resolved;
      } catch {
        return legacy;
      }
    };
    const lineItems = data.evidenceLineItems ?? [];
    const survivingDelivery = lineItems.find((li) => DELIVERY_FIELDS.has(li.field))?.field;
    const titleOf = new Map(sections.usedInDefense.map((r) => [r.field, r.title]));
    const evidenceRows: AccountEvidenceRowInput[] = [];
    for (const li of lineItems) {
      if (!li.includedInDefencePackage) continue;
      if (DELIVERY_FIELDS.has(li.field) && survivingDelivery && li.field !== survivingDelivery) continue;
      evidenceRows.push({
        field: li.field,
        title: titleOf.get(li.field) ?? fieldLabel(li.field, li.label),
        positive: li.usedAsPositiveBankEvidence === true,
        inPackage: true,
      });
    }

    const page = buildAccountPage(account, {
      evidenceRows,
      missing: sections.missingOrWeak.map((m) => ({
        field: m.field,
        title: m.title,
        whyItMatters: m.whyItMatters,
      })),
      hasRefundChecklistRow: resolveReasonFamily(d.reason) === "refund",
    });
    return { account, page, fmt };
  }, [data, derived.isBuilding, derived.isFailed, locale, tRoot, sections.usedInDefense, sections.missingOrWeak]);
}
