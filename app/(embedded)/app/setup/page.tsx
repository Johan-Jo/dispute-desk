"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Page, Layout, Card, BlockStack, Spinner } from "@shopify/polaris";
import { withShopParams } from "@/lib/withShopParams";
import { WIZARD_STEP_IDS } from "@/lib/setup/constants";
import type { SetupStateResponse } from "@/lib/setup/types";

export default function SetupRedirectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    async function redirect() {
      const res = await fetch("/api/setup/state");
      if (res.ok) {
        const data: SetupStateResponse = await res.json();
        const target = (data.nextStepId && WIZARD_STEP_IDS.includes(data.nextStepId)) ? data.nextStepId : "overview";
        router.replace(withShopParams(`/app/setup/${target}`, searchParams));
      } else {
        router.replace(withShopParams("/app/setup/overview", searchParams));
      }
    }
    redirect();
  }, [router, searchParams]);

  return (
    <Page title="Setup Wizard">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400" inlineAlign="center">
              <Spinner />
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
