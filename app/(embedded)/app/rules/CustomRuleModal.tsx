"use client";

/**
 * Embedded create/edit modal for custom automation rules.
 *
 * Matches the portal /portal/rules form 1:1 — same /api/rules POST and
 * /api/rules/:id PATCH contracts validated by ruleCreateSchema and
 * ruleUpdateSchema in lib/middleware/validate.ts.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Modal,
  TextField,
  Select,
  ChoiceList,
  BlockStack,
  InlineStack,
  Text,
  Banner,
} from "@shopify/polaris";

const REASONS: Array<{ value: string; labelKey: string }> = [
  { value: "FRAUDULENT", labelKey: "reasonFraudulent" },
  { value: "PRODUCT_NOT_RECEIVED", labelKey: "reasonProductNotReceived" },
  { value: "PRODUCT_UNACCEPTABLE", labelKey: "reasonProductUnacceptable" },
  { value: "SUBSCRIPTION_CANCELED", labelKey: "reasonSubscriptionCanceled" },
  { value: "CREDIT_NOT_PROCESSED", labelKey: "reasonCreditNotProcessed" },
  { value: "DUPLICATE", labelKey: "reasonDuplicate" },
  { value: "GENERAL", labelKey: "reasonGeneral" },
];

export interface CustomRuleDraft {
  id?: string;
  name: string | null;
  match: {
    reason?: string[];
    amount_range?: { min?: number; max?: number };
  };
  action: { mode: "auto" | "review" };
  enabled: boolean;
  priority: number;
}

interface Props {
  open: boolean;
  shopId: string | null;
  initial: CustomRuleDraft | null;
  defaultPriority: number;
  tr: (key: string) => string;
  tCommon: (key: string) => string;
  onClose: () => void;
  onSaved: () => void;
}

export function CustomRuleModal({
  open,
  shopId,
  initial,
  defaultPriority,
  tr,
  tCommon,
  onClose,
  onSaved,
}: Props) {
  const isEdit = Boolean(initial?.id);

  const [name, setName] = useState("");
  const [reasons, setReasons] = useState<string[]>([]);
  const [mode, setMode] = useState<"auto" | "review">("review");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate when the modal opens (or `initial` changes).
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    if (initial) {
      setName(initial.name ?? "");
      setReasons(initial.match?.reason ?? []);
      setMode(initial.action?.mode === "auto" ? "auto" : "review");
      setMinAmount(
        initial.match?.amount_range?.min != null
          ? String(initial.match.amount_range.min)
          : "",
      );
      setMaxAmount(
        initial.match?.amount_range?.max != null
          ? String(initial.match.amount_range.max)
          : "",
      );
    } else {
      setName("");
      setReasons([]);
      setMode("review");
      setMinAmount("");
      setMaxAmount("");
    }
  }, [open, initial]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const match: CustomRuleDraft["match"] = {};
      if (reasons.length > 0) match.reason = reasons;
      const min = minAmount ? Number(minAmount) : undefined;
      const max = maxAmount ? Number(maxAmount) : undefined;
      if (min != null || max != null) {
        match.amount_range = {};
        if (min != null && !Number.isNaN(min)) match.amount_range.min = min;
        if (max != null && !Number.isNaN(max)) match.amount_range.max = max;
      }

      if (isEdit && initial?.id) {
        const res = await fetch(`/api/rules/${initial.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim() || null,
            match,
            action: { mode },
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            typeof body?.error === "string" ? body.error : "save_failed",
          );
        }
      } else {
        if (!shopId) throw new Error("missing_shop");
        const res = await fetch("/api/rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shop_id: shopId,
            name: name.trim() || null,
            match,
            action: { mode },
            enabled: true,
            priority: defaultPriority,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            typeof body?.error === "string" ? body.error : "save_failed",
          );
        }
      }

      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save_failed");
    } finally {
      setSaving(false);
    }
  }, [
    isEdit,
    initial?.id,
    shopId,
    name,
    reasons,
    minAmount,
    maxAmount,
    mode,
    defaultPriority,
    onSaved,
  ]);

  const handleDelete = useCallback(async () => {
    if (!isEdit || !initial?.id) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/rules/${initial.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("delete_failed");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete_failed");
    } finally {
      setSaving(false);
    }
  }, [isEdit, initial?.id, onSaved]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? tr("editRule") : tr("createRuleModalTitle")}
      primaryAction={{
        content: tr("saveStarterRules"),
        onAction: handleSave,
        loading: saving,
        disabled: saving || (!isEdit && !shopId),
      }}
      secondaryActions={
        isEdit
          ? [
              {
                content: tCommon("cancel"),
                onAction: onClose,
                disabled: saving,
              },
              {
                content: tCommon("delete"),
                onAction: handleDelete,
                destructive: true,
                disabled: saving,
              },
            ]
          : [{ content: tCommon("cancel"), onAction: onClose, disabled: saving }]
      }
    >
      <Modal.Section>
        <BlockStack gap="400">
          {error && (
            <Banner tone="critical" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          )}

          <TextField
            label={tr("name")}
            value={name}
            onChange={setName}
            placeholder={tr("namePlaceholder")}
            autoComplete="off"
          />

          <ChoiceList
            allowMultiple
            title={tr("matchReasons")}
            choices={REASONS.map((r) => ({
              label: tr(r.labelKey),
              value: r.value,
            }))}
            selected={reasons}
            onChange={setReasons}
          />
          <Text as="p" variant="bodySm" tone="subdued">
            {tr("matchReasonsHelp")}
          </Text>

          <InlineStack gap="300" wrap={false}>
            <div style={{ flex: 1 }}>
              <TextField
                label={tr("minAmount")}
                type="number"
                value={minAmount}
                onChange={(v) => setMinAmount(v.replace(/[^0-9.]/g, ""))}
                prefix="$"
                placeholder={tr("noLimit")}
                autoComplete="off"
              />
            </div>
            <div style={{ flex: 1 }}>
              <TextField
                label={tr("maxAmount")}
                type="number"
                value={maxAmount}
                onChange={(v) => setMaxAmount(v.replace(/[^0-9.]/g, ""))}
                prefix="$"
                placeholder={tr("noLimit")}
                autoComplete="off"
              />
            </div>
          </InlineStack>

          <Select
            label={tr("action")}
            options={[
              { label: tr("review"), value: "review" },
              { label: tr("autoPack"), value: "auto" },
            ]}
            value={mode}
            onChange={(v) => setMode(v as "auto" | "review")}
          />
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
