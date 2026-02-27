"use client";

import { useEffect, useState } from "react";
import {
  BlockStack,
  Text,
  Select,
  TextField,
  FormLayout,
} from "@shopify/polaris";

interface BusinessPoliciesStepProps {
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

export function BusinessPoliciesStep({ onSaveRef }: BusinessPoliciesStepProps) {
  const [returnWindow, setReturnWindow] = useState("30");
  const [shippingSLA, setShippingSLA] = useState("48");
  const [cancellation, setCancellation] = useState("");
  const [returnsUrl, setReturnsUrl] = useState("");
  const [shippingUrl, setShippingUrl] = useState("");
  const [termsUrl, setTermsUrl] = useState("");

  useEffect(() => {
    onSaveRef.current = async () => {
      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId: "business_policies",
          payload: {
            returnWindow,
            shippingSLA,
            cancellationPolicy: cancellation,
            returnsUrl,
            shippingUrl,
            termsUrl,
          },
        }),
      });
      return res.ok;
    };
  }, [onSaveRef, returnWindow, shippingSLA, cancellation, returnsUrl, shippingUrl, termsUrl]);

  return (
    <BlockStack gap="400">
      <Text as="h2" variant="headingLg">
        Business Policies
      </Text>
      <Text as="p" variant="bodyMd" tone="subdued">
        These policies will be automatically included in your evidence packs.
      </Text>

      <FormLayout>
        <FormLayout.Group>
          <Select
            label="Return window"
            options={[
              { label: "7 days", value: "7" },
              { label: "14 days", value: "14" },
              { label: "30 days", value: "30" },
              { label: "60 days", value: "60" },
            ]}
            value={returnWindow}
            onChange={setReturnWindow}
          />
          <Select
            label="Shipping SLA"
            options={[
              { label: "24 hours", value: "24" },
              { label: "48 hours", value: "48" },
              { label: "72 hours", value: "72" },
            ]}
            value={shippingSLA}
            onChange={setShippingSLA}
          />
        </FormLayout.Group>

        <TextField
          label="Cancellation policy"
          value={cancellation}
          onChange={setCancellation}
          multiline={3}
          placeholder="Describe your cancellation policy..."
          autoComplete="off"
        />

        <Text as="h3" variant="headingMd">
          Policy URLs
        </Text>

        <TextField
          label="Returns policy URL"
          value={returnsUrl}
          onChange={setReturnsUrl}
          type="url"
          placeholder="https://yourstore.com/returns"
          autoComplete="off"
        />
        <TextField
          label="Shipping policy URL"
          value={shippingUrl}
          onChange={setShippingUrl}
          type="url"
          placeholder="https://yourstore.com/shipping"
          autoComplete="off"
        />
        <TextField
          label="Terms of service URL"
          value={termsUrl}
          onChange={setTermsUrl}
          type="url"
          placeholder="https://yourstore.com/terms"
          autoComplete="off"
        />
      </FormLayout>
    </BlockStack>
  );
}
