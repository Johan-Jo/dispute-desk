"use client";

import type { ReadonlyURLSearchParams } from "next/navigation";
import { BlockStack } from "@shopify/polaris";
import { MobileDisputeCard } from "./MobileDisputeCard";
import { orderDisputeCounts, type Dispute, type TabId } from "./disputeListHelpers";

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface Props {
  disputes: Dispute[];
  activeTab: TabId;
  searchParams: ReadonlyURLSearchParams | null;
  dateLocale: string;
  numberLocale: string;
  t: Translate;
}

export function MobileDisputesList({
  disputes,
  activeTab,
  searchParams,
  dateLocale,
  numberLocale,
  t,
}: Props) {
  // Same marker as the desktop table — an order with several disputes must not
  // read as a duplicate on either surface.
  const siblings = orderDisputeCounts(disputes);
  return (
    <BlockStack gap="300">
      {disputes.map((d) => (
        <MobileDisputeCard
          key={d.id}
          dispute={d}
          siblingPosition={siblings.get(d.id) ?? null}
          activeTab={activeTab}
          searchParams={searchParams}
          dateLocale={dateLocale}
          numberLocale={numberLocale}
          t={t}
        />
      ))}
    </BlockStack>
  );
}
