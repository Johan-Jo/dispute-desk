"use client";

import { useEffect, useState } from "react";
import {
  BlockStack,
  Text,
  Select,
  Checkbox,
  DataTable,
  Button,
  Spinner,
} from "@shopify/polaris";

import type { StepId } from "@/lib/setup/types";

interface SyncDisputesStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

export function SyncDisputesStep({ stepId, onSaveRef }: SyncDisputesStepProps) {
  const [dateRange, setDateRange] = useState("90");
  const [autoSync, setAutoSync] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    onSaveRef.current = async () => {
      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId,
          payload: { dateRange, autoSync },
        }),
      });
      return res.ok;
    };
  }, [stepId, onSaveRef, dateRange, autoSync]);

  const handleSync = () => {
    setSyncing(true);
    setTimeout(() => {
      setSyncing(false);
      setSynced(true);
    }, 2000);
  };

  const previewRows = [
    ["DSP-1234", "Fraudulent", "$149.99", "Mar 15", "Open"],
    ["DSP-1235", "Not received", "$89.50", "Mar 18", "Open"],
    ["DSP-1236", "Not as described", "$249.00", "Mar 20", "Open"],
    ["DSP-1237", "Duplicate", "$59.99", "Mar 22", "Open"],
  ];

  return (
    <BlockStack gap="400">
      <Text as="h2" variant="headingLg">
        Sync Disputes & Timeline
      </Text>
      <Text as="p" variant="bodyMd" tone="subdued">
        Import your recent disputes to get started.
      </Text>

      <Select
        label="Import disputes from"
        options={[
          { label: "Last 30 days", value: "30" },
          { label: "Last 90 days", value: "90" },
          { label: "Last 180 days", value: "180" },
        ]}
        value={dateRange}
        onChange={setDateRange}
      />

      <Checkbox
        label="Auto-sync new disputes daily"
        helpText="Automatically import new disputes as they occur"
        checked={autoSync}
        onChange={setAutoSync}
      />

      <Text as="h3" variant="headingMd">
        Preview: Recent disputes
      </Text>
      <DataTable
        columnContentTypes={["text", "text", "numeric", "text", "text"]}
        headings={["Dispute ID", "Reason", "Amount", "Due Date", "Status"]}
        rows={previewRows}
      />

      {!synced ? (
        <Button variant="primary" onClick={handleSync} loading={syncing} fullWidth>
          {syncing ? "Syncing disputes..." : "Start Sync"}
        </Button>
      ) : (
        <Text as="p" variant="bodyMd" tone="success">
          Disputes synced successfully.
        </Text>
      )}
    </BlockStack>
  );
}
