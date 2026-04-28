"use client";

import type { ReadonlyURLSearchParams } from "next/navigation";
import { BlockStack } from "@shopify/polaris";
import { MobileDisputeCard } from "./MobileDisputeCard";
import type { Dispute, TabId } from "./disputeListHelpers";

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
  return (
    <BlockStack gap="300">
      {disputes.map((d) => (
        <MobileDisputeCard
          key={d.id}
          dispute={d}
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
