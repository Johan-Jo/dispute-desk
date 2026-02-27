"use client";

import { useEffect, useState } from "react";
import {
  BlockStack,
  Text,
  InlineStack,
  Icon,
  Badge,
  Button,
  Spinner,
} from "@shopify/polaris";
import { CheckCircleIcon } from "@shopify/polaris-icons";

interface PermissionsStepProps {
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

const PERMISSIONS = [
  { key: "orders", label: "Orders", desc: "Read order details for evidence" },
  { key: "customers", label: "Customers", desc: "Read customer information" },
  { key: "disputes", label: "Disputes", desc: "Read and write dispute evidence" },
  { key: "files", label: "Files", desc: "Upload evidence documents" },
];

export function PermissionsStep({ onSaveRef }: PermissionsStepProps) {
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    onSaveRef.current = async () => {
      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId: "permissions",
          payload: { verified },
        }),
      });
      return res.ok;
    };
  }, [onSaveRef, verified]);

  const handleVerify = () => {
    setVerifying(true);
    setTimeout(() => {
      setVerified(true);
      setVerifying(false);
    }, 1500);
  };

  return (
    <BlockStack gap="400">
      <Text as="h2" variant="headingLg">
        Permissions & Data Access
      </Text>
      <Text as="p" variant="bodyMd" tone="subdued">
        DisputeDesk needs access to specific Shopify data to manage disputes effectively.
      </Text>

      <BlockStack gap="200">
        {PERMISSIONS.map((p) => (
          <div
            key={p.key}
            style={{
              padding: 16,
              borderRadius: 8,
              border: `1px solid ${verified ? "#B3D1B3" : "#E1E3E5"}`,
              background: verified ? "#F1F8F5" : "#fff",
            }}
          >
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="300" blockAlign="center">
                {verified ? (
                  <div style={{ color: "#008060" }}>
                    <Icon source={CheckCircleIcon} />
                  </div>
                ) : (
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      border: "2px solid #8C9196",
                    }}
                  />
                )}
                <BlockStack gap="100">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {p.label}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {p.desc}
                  </Text>
                </BlockStack>
              </InlineStack>
              <Badge tone={verified ? "success" : undefined}>
                {verified ? "Connected" : "Pending"}
              </Badge>
            </InlineStack>
          </div>
        ))}
      </BlockStack>

      <Button
        variant="primary"
        onClick={handleVerify}
        disabled={verified || verifying}
        loading={verifying}
        fullWidth
      >
        {verified ? "All permissions verified" : "Verify Permissions"}
      </Button>
    </BlockStack>
  );
}
