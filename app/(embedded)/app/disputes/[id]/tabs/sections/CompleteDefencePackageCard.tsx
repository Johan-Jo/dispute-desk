/**
 * CompleteDefencePackageCard — embedded ReviewSubmitTab section.
 *
 * Surfaces the Grounded Defence Package status: latest version, package
 * mode, validation result, generated/finalized/submitted timestamp, and
 * the controls to Preview / Regenerate / Finalize / Submit / Add manual
 * evidence.
 *
 * Hidden entirely when no defence_packages row exists for the pack (the
 * feature flag is off, or the auto-build hasn't run yet).
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  ButtonGroup,
  Card,
  InlineStack,
  Modal,
  Spinner,
  Text,
} from "@shopify/polaris";
import type {
  DefenceNarrativeOutput,
  EvidenceFact,
} from "@/lib/defence/types";
import {
  DefencePackageHtmlView,
  type DisputeContextLike,
} from "./DefencePackageHtmlView";

type Status =
  | "draft"
  | "stale"
  | "final"
  | "submitted"
  | "superseded"
  | "failed"
  | "skipped";

interface DefencePackageRow {
  id: string;
  version: number;
  status: Status;
  package_mode: "full" | "narrow" | null;
  generated_at: string;
  generated_by: "system" | "merchant" | "admin";
  pdf_path: string | null;
  evidence_hash: string;
  llm_model: string | null;
  prompt_family: string | null;
  prompt_version: number | null;
  reason_code_module: string | null;
  validation_status: "ok" | "failed" | "skipped" | null;
  validation_errors: Array<{ section?: string; rule?: string; message?: string }>;
  failure_code: string | null;
  failure_reason: string | null;
  submitted_at: string | null;
  narrative_json: DefenceNarrativeOutput | null;
  facts_json: EvidenceFact[] | null;
}

interface Props {
  packId: string | null;
  /** Used to render the inline HTML defence view + the days-remaining
   *  badge. Optional — when absent the card still works, just without
   *  the case-details / countdown enrichment. */
  dispute?: DisputeContextLike & { dueAt?: string | null };
}

/** Days-remaining math, mirrors lib/disputeListHelpers getUrgency
 *  thresholds (≤48h = critical, ≤7d = warning). */
function daysRemainingFrom(dueAt: string | null | undefined): {
  label: string;
  tone: "critical" | "warning" | "info";
} | null {
  if (!dueAt) return null;
  const hoursLeft = (new Date(dueAt).getTime() - Date.now()) / (1000 * 60 * 60);
  if (Number.isNaN(hoursLeft)) return null;
  if (hoursLeft < 0) {
    return { label: "Deadline passed", tone: "critical" };
  }
  if (hoursLeft <= 24) {
    return { label: "Due today", tone: "critical" };
  }
  if (hoursLeft <= 48) {
    return { label: "Due in 1 day", tone: "critical" };
  }
  const days = Math.round(hoursLeft / 24);
  if (hoursLeft <= 168) {
    return { label: `Due in ${days} day${days === 1 ? "" : "s"}`, tone: "warning" };
  }
  return { label: `Due in ${days} days`, tone: "info" };
}

function StatusBadge({ status }: { status: Status }) {
  const tone =
    status === "final" || status === "submitted"
      ? "success"
      : status === "failed"
        ? "critical"
        : status === "skipped" || status === "superseded"
          ? "subdued"
          : status === "stale"
            ? "warning"
            : "info";
  const label =
    status === "draft"
      ? "Draft"
      : status === "stale"
        ? "Stale"
        : status === "final"
          ? "Ready to submit"
          : status === "submitted"
            ? "Submitted"
            : status === "superseded"
              ? "Superseded"
              : status === "failed"
                ? "Validation failed"
                : "Skipped";
  return (
    <Text as="span" variant="bodySm" tone={tone === "subdued" ? "subdued" : undefined}>
      {label}
    </Text>
  );
}

export function CompleteDefencePackageCard({ packId, dispute }: Props) {
  const countdown = useMemo(() => daysRemainingFrom(dispute?.dueAt), [dispute?.dueAt]);
  const [row, setRow] = useState<DefencePackageRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState<"regen" | "finalize" | "submit" | null>(null);

  const load = useCallback(async () => {
    if (!packId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/packs/${packId}/defence-packages`);
      if (!res.ok) {
        setError(`Could not load defence package (${res.status})`);
        setRow(null);
      } else {
        const json = (await res.json()) as { latest: DefencePackageRow | null };
        setRow(json.latest);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
      setRow(null);
    } finally {
      setLoading(false);
    }
  }, [packId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Defence-in-depth: middleware injects `x-shop-id` from the
  // shopify_shop_id cookie for embedded requests, but we also pass
  // `?shop_id=` so the route works even on edges where the cookie
  // isn't readable (Safari ITP, brand-new install, server-render flows).
  const shopIdQs = dispute?.shopId ? `?shop_id=${encodeURIComponent(dispute.shopId)}` : "";

  const openPreview = useCallback(async () => {
    if (!row) return;
    setError(null);
    setBusy("regen"); // visual placeholder
    try {
      const res = await fetch(`/api/defence-packages/${row.id}/preview${shopIdQs}`);
      if (res.ok) {
        const json = (await res.json()) as { url: string };
        setPreviewUrl(json.url);
        setPreviewOpen(true);
      } else {
        let detail = "";
        try {
          const body = (await res.json()) as { error?: string };
          detail = body.error ?? "";
        } catch {
          /* ignore */
        }
        setError(`Could not generate preview (${res.status}${detail ? ` — ${detail}` : ""})`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Preview request failed: ${message}`);
    } finally {
      setBusy(null);
    }
  }, [row, shopIdQs]);

  const onRegenerate = useCallback(async () => {
    if (!row) return;
    setError(null);
    setBusy("regen");
    try {
      const res = await fetch(`/api/defence-packages/${row.id}/regenerate${shopIdQs}`, { method: "POST" });
      if (!res.ok) {
        setError(`Regenerate failed (${res.status})`);
      }
      await load();
    } finally {
      setBusy(null);
    }
  }, [row, load, shopIdQs]);

  const onFinalize = useCallback(async () => {
    if (!row) return;
    setError(null);
    setBusy("finalize");
    try {
      const res = await fetch(`/api/defence-packages/${row.id}/finalize${shopIdQs}`, { method: "POST" });
      if (!res.ok) {
        setError(`Finalize failed (${res.status})`);
      }
      await load();
    } finally {
      setBusy(null);
    }
  }, [row, load, shopIdQs]);

  const onSubmit = useCallback(async () => {
    if (!row) return;
    setError(null);
    setBusy("submit");
    try {
      const res = await fetch(`/api/defence-packages/${row.id}/submit${shopIdQs}`, { method: "POST" });
      if (!res.ok) {
        setError(`Submit failed (${res.status})`);
      }
      await load();
    } finally {
      setBusy(null);
    }
  }, [row, load, shopIdQs]);

  if (!packId) return null;
  if (loading) {
    return (
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingSm">Complete Defence Package</Text>
          <Spinner accessibilityLabel="Loading defence package" size="small" />
        </BlockStack>
      </Card>
    );
  }
  // Feature flag off OR build hasn't run yet — hide the card entirely.
  if (!row) return null;

  const canFinalize =
    row.status === "draft" && row.validation_status === "ok" && Boolean(row.pdf_path);
  const canSubmit = row.status === "final";
  const canRegenerate = row.status === "draft" || row.status === "stale" || row.status === "failed";

  return (
    <>
      <Card>
        <BlockStack gap="400">
          <BlockStack gap="100">
            <Text as="h2" variant="headingSm">Complete Defence Package</Text>
            <Text as="p" tone="subdued" variant="bodySm">
              DisputeDesk prepares a bank-facing PDF that combines approved Shopify
              evidence, payment signals, fulfilment proof, customer communication,
              policies, and any merchant-supplied documents into one structured
              defence package.
            </Text>
          </BlockStack>

          <InlineStack gap="400" align="space-between">
            <BlockStack gap="050">
              <Text as="span" variant="bodySm" tone="subdued">Status</Text>
              <StatusBadge status={row.status} />
            </BlockStack>
            <BlockStack gap="050">
              <Text as="span" variant="bodySm" tone="subdued">Mode</Text>
              <Text as="span" variant="bodySm">{row.package_mode ?? "—"}</Text>
            </BlockStack>
            <BlockStack gap="050">
              <Text as="span" variant="bodySm" tone="subdued">Generated</Text>
              <Text as="span" variant="bodySm">
                {new Date(row.generated_at).toLocaleString()}
              </Text>
            </BlockStack>
            {countdown && (
              <BlockStack gap="050">
                <Text as="span" variant="bodySm" tone="subdued">Deadline</Text>
                <Badge tone={countdown.tone === "info" ? undefined : countdown.tone}>
                  {countdown.label}
                </Badge>
              </BlockStack>
            )}
          </InlineStack>

          {row.status === "skipped" && row.failure_code === "covered_shopify" && (
            <Banner tone="info" title="Covered by Shopify Protect">
              <p>
                This dispute is covered by Shopify Protect. No bank-facing defence
                package is required.
              </p>
            </Banner>
          )}

          {row.status === "skipped" && row.failure_code === "no_bank_eligible_facts" && (
            <Banner tone="warning" title="Not enough bank-facing evidence">
              <p>
                The classifier did not find any bank-eligible approved facts for
                this dispute. Upload additional supporting documents or wait for
                the next sync to include freshly collected evidence.
              </p>
            </Banner>
          )}

          {row.status === "failed" && (
            <Banner tone="critical" title="Validation failed">
              <BlockStack gap="200">
                <p>{row.failure_reason ?? "Validation found unsupported claims in the generated narrative."}</p>
                {row.validation_errors?.length > 0 && (
                  <ul style={{ marginLeft: 16, fontSize: 12 }}>
                    {row.validation_errors.slice(0, 5).map((e, i) => (
                      <li key={i}>{e.message ?? e.rule}</li>
                    ))}
                  </ul>
                )}
              </BlockStack>
            </Banner>
          )}

          {row.status === "stale" && (
            <Banner tone="warning" title="Stale — new evidence available">
              <p>This draft no longer reflects the latest evidence on file. Regenerate to refresh.</p>
            </Banner>
          )}

          <ButtonGroup>
            <Button
              onClick={openPreview}
              disabled={!row.pdf_path || busy !== null}
              loading={busy === "regen" && previewOpen === false && !!row.pdf_path}
            >
              Preview PDF
            </Button>
            {canRegenerate && (
              <Button
                onClick={onRegenerate}
                disabled={busy !== null}
                loading={busy === "regen"}
              >
                Regenerate
              </Button>
            )}
            {canFinalize && (
              <Button
                variant="primary"
                onClick={onFinalize}
                disabled={busy !== null}
                loading={busy === "finalize"}
              >
                Finalize
              </Button>
            )}
            {canSubmit && (
              <Button
                variant="primary"
                tone="success"
                onClick={onSubmit}
                disabled={busy !== null}
                loading={busy === "submit"}
              >
                Submit to Shopify
              </Button>
            )}
          </ButtonGroup>

          {error && (
            <Banner tone="warning" title="Could not load defence package">
              <p>{error}</p>
            </Banner>
          )}
        </BlockStack>
      </Card>

      {/* Inline HTML defence view — visually mirrors the PDF document
          section-for-section. Hidden when the package has no narrative
          (skipped / failed rows). */}
      {row.narrative_json && row.facts_json && (
        <DefencePackageHtmlView row={row} dispute={dispute} />
      )}

      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={`Defence Package v${row.version}`}
        primaryAction={
          previewUrl
            ? {
                content: "Open in new tab",
                onAction: () => {
                  window.open(previewUrl, "_blank", "noopener,noreferrer");
                },
              }
            : undefined
        }
      >
        <Modal.Section>
          {previewUrl ? (
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">
                If the PDF doesn&apos;t display inline (Shopify Admin may block
                embedded PDF viewers), use &quot;Open in new tab&quot; above.
              </Text>
              <iframe
                src={previewUrl}
                style={{ width: "100%", height: 720, border: 0 }}
                title={`Defence Package v${row.version}`}
              />
            </BlockStack>
          ) : (
            <Spinner accessibilityLabel="Loading PDF" />
          )}
        </Modal.Section>
      </Modal>
    </>
  );
}
