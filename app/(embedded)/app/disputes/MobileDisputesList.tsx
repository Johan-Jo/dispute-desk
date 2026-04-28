"use client";

import { Fragment } from "react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { BlockStack, Card } from "@shopify/polaris";
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
    <Card padding="0">
      <BlockStack gap="0">
        {disputes.map((d) => (
          <Fragment key={d.id}>
            <MobileDisputeCard
              dispute={d}
              activeTab={activeTab}
              searchParams={searchParams}
              dateLocale={dateLocale}
              numberLocale={numberLocale}
              t={t}
            />
          </Fragment>
        ))}
      </BlockStack>
    </Card>
  );
}
