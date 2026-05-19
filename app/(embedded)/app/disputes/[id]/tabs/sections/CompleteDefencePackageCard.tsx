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
  Link,
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
  /** Pack-level submission timestamp (`evidence_packs.saved_to_shopify_at`).
   *  When set, the card switches to "Submitted to bank" state: the
   *  deadline countdown disappears, the Submit button is disabled, and
   *  an Open-in-Shopify link replaces it. */
  submittedToShopifyAt?: string | null;
  /** Direct deep-link to the dispute in Shopify Admin. Rendered as a
   *  Link in the submitted state. */
  shopifyAdminUrl?: string | null;
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

export function CompleteDefencePackageCard({
  packId,
  dispute,
  submittedToShopifyAt,
  shopifyAdminUrl,
}: Props) {
  // Countdown is only relevant before submission — once the bank has
  // the package, "due in N days" stops being a useful state.
  const countdown = useMemo(
    () => (submittedToShopifyAt ? null : daysRemainingFrom(dispute?.dueAt)),
    [dispute?.dueAt, submittedToShopifyAt],
  );
  const [latest, setLatest] = useState<DefencePackageRow | null>(null);
  const [bankFacing, setBankFacing] = useState<DefencePackageRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
        setLatest(null);
        setBankFacing(null);
      } else {
        const json = (await res.json()) as {
          latest: DefencePackageRow | null;
          bankFacing?: DefencePackageRow | null;
        };
        setLatest(json.latest);
        setBankFacing(json.bankFacing ?? null);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
      setLatest(null);
      setBankFacing(null);
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

  const isSubmittedToBank = Boolean(submittedToShopifyAt);

  // The card distinguishes two rows now:
  //   - `latest`: the most recent version (what the merchant is editing).
  //   - `bankFacing`: the row whose PDF the bank actually has (status=
  //     submitted). Set when `isSubmittedToBank` is true and the workspace
  //     has been saved to Shopify; otherwise null.
  //
  // The body view + Preview button render `bankFacing` when present
  // (truth: what the bank sees). Action buttons (Regenerate / Finalize /
  // Submit) always operate on `latest` (the work-in-progress draft).
  // When the two diverge, a small info banner explains the state.
  const displayRow = isSubmittedToBank && bankFacing ? bankFacing : latest;
  const hasUnsubmittedDraft = Boolean(
    isSubmittedToBank &&
      bankFacing &&
      latest &&
      latest.id !== bankFacing.id,
  );

  // Preview URL is now a server-side redirect: the API route generates
  // the signed Supabase URL and 302s to it. Rendering as `<Button
  // url={previewHref} target="_blank">` keeps the open-in-new-tab inside
  // a real user-gesture context (a link click), instead of an async
  // window.open() from a fetch callback — which Shopify Admin's iframe
  // sandbox blocks.
  const previewHref = displayRow?.pdf_path
    ? `/api/defence-packages/${displayRow.id}/preview${shopIdQs}`
    : null;

  const onRegenerate = useCallback(async () => {
    if (!latest) return;
    setError(null);
    setBusy("regen");
    try {
      const res = await fetch(`/api/defence-packages/${latest.id}/regenerate${shopIdQs}`, { method: "POST" });
      if (!res.ok) {
        setError(`Regenerate failed (${res.status})`);
      }
      await load();
    } finally {
      setBusy(null);
    }
  }, [latest, load, shopIdQs]);

  const onFinalize = useCallback(async () => {
    if (!latest) return;
    setError(null);
    setBusy("finalize");
    try {
      const res = await fetch(`/api/defence-packages/${latest.id}/finalize${shopIdQs}`, { method: "POST" });
      if (!res.ok) {
        setError(`Finalize failed (${res.status})`);
      }
      await load();
    } finally {
      setBusy(null);
    }
  }, [latest, load, shopIdQs]);

  const onSubmit = useCallback(async () => {
    if (!latest) return;
    setError(null);
    setBusy("submit");
    try {
      const res = await fetch(`/api/defence-packages/${latest.id}/submit${shopIdQs}`, { method: "POST" });
      if (!res.ok) {
        setError(`Submit failed (${res.status})`);
      }
      await load();
    } finally {
      setBusy(null);
    }
  }, [latest, load, shopIdQs]);

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
  if (!latest) return null;

  // `row` continues to drive metadata + action gates (status, validation,
  // generated_at, package_mode) — those are properties of the working
  // draft, not the bank-facing snapshot.
  const row = latest;
  // Action gates. The `!isSubmittedToBank` guard is dropped — the
  // status (`draft` / `final` / `stale` / `failed`) is the real
  // correctness check, and the "newer draft v2" flow needs Finalize +
  // Submit to be reachable after the v1 has been saved to Shopify.
  // The submit API enqueues a `save_to_shopify` job that replaces the
  // uncategorizedFile buffer (per Commit 10), so a second submit on
  // the same dispute swaps the PDF on the Shopify dispute cleanly.
  // To avoid surfacing the buttons on a clean "Submitted to bank"
  // view when nothing has changed, we further require that the merchant
  // has an actual draft pending — `hasUnsubmittedDraft` proves the
  // displayed `latest` row diverges from `bankFacing`.
  const hasActionableDraft = !isSubmittedToBank || hasUnsubmittedDraft;
  const canFinalize =
    hasActionableDraft &&
    row.status === "draft" &&
    row.validation_status === "ok" &&
    Boolean(row.pdf_path);
  const canSubmit = hasActionableDraft && row.status === "final";
  const canRegenerate =
    hasActionableDraft &&
    (row.status === "draft" || row.status === "stale" || row.status === "failed");

  const formattedSubmittedAt = submittedToShopifyAt
    ? (() => {
        try {
          return new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(submittedToShopifyAt));
        } catch {
          return submittedToShopifyAt;
        }
      })()
    : null;

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

          {/* Submission state banner — replaces "Ready to submit" + deadline
              once the pack has been saved to Shopify. */}
          {isSubmittedToBank ? (
            <BlockStack gap="200">
              <Banner tone="success" title="Submitted to bank">
                <BlockStack gap="100">
                  {formattedSubmittedAt ? (
                    <Text as="p" variant="bodySm">
                      Submitted on {formattedSubmittedAt}
                      {bankFacing ? ` (v${bankFacing.version})` : ""}.
                    </Text>
                  ) : null}
                  {shopifyAdminUrl ? (
                    <Link url={shopifyAdminUrl} external>
                      Open in Shopify Admin
                    </Link>
                  ) : null}
                </BlockStack>
              </Banner>
              {hasUnsubmittedDraft && latest && bankFacing ? (
                <Banner tone="info" title={`Newer draft v${latest.version} ready to resubmit`}>
                  <p>
                    The bank received v{bankFacing.version}. A newer draft is on
                    file.{" "}
                    {latest.status === "draft"
                      ? "Click Finalize, then Resubmit to Shopify below to replace the PDF on the Shopify dispute."
                      : "Click Resubmit to Shopify below to replace the PDF on the Shopify dispute."}
                  </p>
                </Banner>
              ) : null}
            </BlockStack>
          ) : (
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
          )}

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
              url={previewHref ?? undefined}
              target="_blank"
              external
              disabled={!previewHref || busy !== null}
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
                {isSubmittedToBank ? "Resubmit to Shopify" : "Submit to Shopify"}
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
          (skipped / failed rows).

          Renders `displayRow` — `bankFacing` when the pack is submitted,
          `latest` otherwise. Without this, a regenerate after save_to_
          shopify would display the draft narrative under the "Submitted
          to bank" banner, falsely claiming the bank received content the
          PDF on file does not contain. */}
      {displayRow?.narrative_json && displayRow?.facts_json && (
        <DefencePackageHtmlView row={displayRow} dispute={dispute} />
      )}
    </>
  );
}
